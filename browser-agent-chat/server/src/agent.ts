import { startBrowserAgent, BrowserConnector, type BrowserAgent } from 'magnitude-core';
import { z } from 'zod';
import type { ServerMessage, MetricStep } from './types.js';
import { saveMessage, createSuggestion } from './db.js';
import { loadMemoryContext, buildTaskPrompt, buildExplorePrompt } from './memory-engine.js';
import { parseFindingsFromText, processFinding } from './finding-detector.js';
import { parseMemoryUpdates } from './suggestion-detector.js';
import * as browserPool from './browserPool.js';

export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  projectId: string | null;
  memoryContext: string;
  stepsHistory: Array<{ order: number; action: string; target?: string }>;
  /** Resolves when background login finishes (or immediately if no login). */
  loginDone: Promise<void>;
  close: () => Promise<void>;
}

/** Simple timing helper — records named steps with cumulative timestamps. */
class StepTimer {
  private t0 = Date.now();
  private last = this.t0;
  readonly steps: MetricStep[] = [];

  step(name: string): void {
    const now = Date.now();
    this.steps.push({ name, duration: now - this.last });
    this.last = now;
  }

  get total(): number { return Date.now() - this.t0; }
}

export async function createAgent(
  url: string,
  broadcast: (msg: ServerMessage) => void,
  sessionId: string | null = null,
  projectId: string | null = null,
): Promise<AgentSession> {
  broadcast({ type: 'status', status: 'working' });
  const timer = new StepTimer();

  // Load memory context for prompt injection
  const memoryContext = projectId ? await loadMemoryContext(projectId) : '';
  timer.step('load_memory');

  // Acquire a pre-warmed browser for fast startup
  const browser = await browserPool.acquire();
  timer.step('acquire_browser');
  broadcast({ type: 'thought', content: 'Browser ready, loading page...' });

  const agent = await startBrowserAgent({
    url,
    narrate: false,
    llm: {
      provider: 'claude-code',
      options: {
        model: 'claude-sonnet-4-20250514'
      }
    },
    browser: {
      instance: browser,
    },
  });

  timer.step('start_browser_agent');
  const connector = agent.require(BrowserConnector);
  const stepsHistory: AgentSession['stepsHistory'] = [];
  let stepOrder = 0;

  // Helper to get screenshot as base64
  const getScreenshotBase64 = async (): Promise<string | null> => {
    try {
      const screenshot = await connector.getLastScreenshot();
      if (screenshot) return await screenshot.toBase64();
    } catch {}
    return null;
  };

  // Listen for agent thoughts — parse for findings and memory updates
  agent.events.on('thought', async (thought: string) => {
    broadcast({ type: 'thought', content: thought });
    if (sessionId) await saveMessage(sessionId, 'thought', thought);

    // Check for findings in thought text
    if (projectId && sessionId) {
      const rawFindings = parseFindingsFromText(thought);
      for (const raw of rawFindings) {
        const finding = await processFinding(
          raw, projectId, sessionId, [...stepsHistory], getScreenshotBase64
        );
        if (finding) {
          broadcast({ type: 'finding', finding });
        }
      }

      // Parse MEMORY_JSON → create suggestions (not direct features)
      const memUpdates = parseMemoryUpdates(thought);
      for (const update of memUpdates) {
        const suggestion = await createSuggestion(
          projectId, update.type, update.data, sessionId
        );
        if (suggestion) {
          broadcast({ type: 'suggestion', suggestion });
        }
      }
    }
  });

  // Listen for completed actions — track steps history
  agent.events.on('actionDone', async (action: { variant: string; target?: string; content?: string; [key: string]: unknown }) => {
    const actionName = action.variant;
    const target = action.target || action.content;
    stepOrder++;
    stepsHistory.push({ order: stepOrder, action: actionName, target: target as string | undefined });

    broadcast({ type: 'action', action: actionName, target: target as string | undefined });
    if (sessionId) {
      const actionContent = target ? `${actionName}: ${target}` : actionName;
      await saveMessage(sessionId, 'action', actionContent);
    }

    // Capture and broadcast screenshot
    try {
      const screenshot = await connector.getLastScreenshot();
      if (screenshot) {
        const base64 = await screenshot.toBase64();
        broadcast({ type: 'screenshot', data: base64 });
        // Live screenshots are ephemeral — not persisted (see spec: Screenshots Strategy)
      }
    } catch (err) {
      console.error('Failed to capture screenshot:', err);
    }
  });

  // Listen for navigation events
  agent.browserAgentEvents.on('nav', (navUrl: string) => {
    broadcast({ type: 'nav', url: navUrl });
  });

  // Send initial screenshot
  try {
    const screenshot = await connector.getLastScreenshot();
    if (screenshot) {
      const base64 = await screenshot.toBase64();
      broadcast({ type: 'screenshot', data: base64 });
    }
  } catch (err) {
    console.error('Failed to capture initial screenshot:', err);
  }
  timer.step('initial_screenshot');

  // Emit startup metrics
  const metrics = { total: timer.total, steps: timer.steps };
  console.log('[METRICS] Agent startup:', JSON.stringify(metrics));
  broadcast({ type: 'metrics', metrics });

  broadcast({ type: 'status', status: 'idle' });
  const currentPageUrl = connector.getHarness().page.url();
  broadcast({ type: 'nav', url: currentPageUrl });

  return {
    agent,
    connector,
    sessionId,
    projectId,
    memoryContext,
    stepsHistory,
    loginDone: Promise.resolve(), // Will be replaced by executeLogin
    close: async () => {
      await agent.stop();
    }
  };
}

export async function executeLogin(
  session: AgentSession,
  credentials: { username: string; password: string },
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  const page = session.connector.getHarness().page;
  broadcast({ type: 'thought', content: 'Logging in...' });

  try {
    await session.agent.act(`Log in with username "${credentials.username}" and password "${credentials.password}"`);
    console.log('[LOGIN] Done, URL:', page.url());
  } catch (err) {
    console.error('[LOGIN] Failed:', err);
    broadcast({ type: 'error', message: 'Auto-login failed. You can log in via chat.' });
    return;
  }

  // Capture post-login state
  try {
    const buf = await page.screenshot({ type: 'png' });
    broadcast({ type: 'screenshot', data: buf.toString('base64') });
    broadcast({ type: 'nav', url: page.url() });

    const onLogin = /\/(login|signin|sign-in|auth)\b/i.test(page.url())
      || await page.locator('input[type="password"]').isVisible().catch(() => false);
    broadcast({ type: 'thought', content: onLogin
      ? 'Could not log in. Please log in via chat.'
      : 'Logged in successfully' });
  } catch {}
}

// Schema for features extracted from the current page
const ExtractedFeatureSchema = z.object({
  features: z.array(z.object({
    name: z.string().describe('Short feature name, e.g. "Login", "User Dashboard", "Settings"'),
    description: z.string().describe('What this feature does'),
    criticality: z.enum(['critical', 'high', 'medium', 'low']).describe('How important this feature is'),
    expected_behaviors: z.array(z.string()).describe('Observable expected behaviors, e.g. "Shows error on invalid password", "Redirects to dashboard after login"'),
  })),
  flows: z.array(z.object({
    feature_name: z.string().describe('Which feature this flow belongs to'),
    name: z.string().describe('Flow name, e.g. "Login Flow", "Password Reset Flow"'),
    steps: z.array(z.string()).describe('Ordered steps in this flow'),
    criticality: z.enum(['critical', 'high', 'medium', 'low']),
  })),
});

export async function executeExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  console.log('[EXPLORE] Starting explore...');
  broadcast({ type: 'status', status: 'working' });

  // Wait for login to finish before using the agent
  console.log('[EXPLORE] Waiting for login to complete...');
  await session.loginDone;
  console.log('[EXPLORE] Login done, starting exploration...');

  const prompt = buildExplorePrompt(context);
  session.stepsHistory.length = 0;

  try {
    // Extract features from the current page using vision
    console.log('[EXPLORE] Extracting features from current page...');
    broadcast({ type: 'thought', content: 'Analyzing the application...' });

    const extracted = await session.agent.extract(
      'Look at this application page carefully. Identify ALL features visible in the navigation, sidebar, main content, and any menus. For each feature, describe what it does and list expected behaviors. Also identify any multi-step flows (like login, signup, settings changes). Be thorough — include features from the navigation/sidebar even if you can only see their names.',
      ExtractedFeatureSchema
    );
    console.log('[EXPLORE] Extracted:', JSON.stringify(extracted, null, 2));

    // Create suggestions for each extracted feature
    if (session.projectId && session.sessionId) {
      for (const feature of extracted.features) {
        const suggestion = await createSuggestion(
          session.projectId,
          'feature',
          {
            name: feature.name,
            description: feature.description,
            criticality: feature.criticality,
            expected_behaviors: feature.expected_behaviors,
          },
          session.sessionId
        );
        if (suggestion) {
          broadcast({ type: 'suggestion', suggestion });
        }
      }

      for (const flow of extracted.flows) {
        const suggestion = await createSuggestion(
          session.projectId,
          'flow',
          {
            feature_name: flow.feature_name,
            name: flow.name,
            steps: flow.steps.map((s, i) => ({ order: i + 1, description: s })),
            checkpoints: [],
            criticality: flow.criticality,
          },
          session.sessionId
        );
        if (suggestion) {
          broadcast({ type: 'suggestion', suggestion });
        }
      }

      const total = extracted.features.length + extracted.flows.length;
      broadcast({ type: 'thought', content: total > 0
        ? `Discovered ${extracted.features.length} feature(s) and ${extracted.flows.length} flow(s).`
        : 'No new features discovered on this page.' });
    }

    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Exploration failed';
    console.error('[EXPLORE] Failed:', errMsg);
    broadcast({ type: 'error', message: errMsg });
    broadcast({ type: 'taskComplete', success: false });
  } finally {
    broadcast({ type: 'status', status: 'idle' });
  }
}

export async function executeTask(
  session: AgentSession,
  task: string,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  broadcast({ type: 'status', status: 'working' });

  // Wait for login to finish before using the agent
  await session.loginDone;

  if (session.sessionId) {
    await saveMessage(session.sessionId, 'user', task);
  }

  // Build prompt with memory context
  const prompt = session.projectId
    ? buildTaskPrompt(task, session.memoryContext)
    : task;

  // Reset step counter for this task
  session.stepsHistory.length = 0;

  try {
    await session.agent.act(prompt);
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
    if (session.sessionId) {
      await saveMessage(session.sessionId, 'system', `Error: ${message}`);
    }
  } finally {
    broadcast({ type: 'status', status: 'idle' });
  }
}
