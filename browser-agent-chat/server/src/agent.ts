import { startBrowserAgent, BrowserConnector, type BrowserAgent } from 'magnitude-core';
import { z } from 'zod';
import type { ServerMessage, MetricStep } from './types.js';
import { saveMessage, createSuggestion } from './db.js';
import { loadMemoryContext, buildTaskPrompt } from './memory-engine.js';
import { parseFindingsFromText, processFinding } from './finding-detector.js';
import { parseMemoryUpdates } from './suggestion-detector.js';
import { recordNavigation } from './nav-graph.js';

export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  projectId: string | null;
  memoryContext: string;
  stepsHistory: Array<{ order: number; action: string; target?: string }>;
  /** Resolves when background login finishes (or immediately if no login). */
  loginDone: Promise<void>;
  /** Last action performed — consumed by nav listener for edge labels. */
  lastAction: { label: string; selector?: string } | null;
  /** Current page URL — updated on every nav event. */
  currentUrl: string | null;
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
  broadcast: (msg: ServerMessage) => void,
  cdpEndpoint: string,
  sessionId: string | null = null,
  projectId: string | null = null,
  url?: string,
): Promise<AgentSession> {
  broadcast({ type: 'status', status: 'working' });
  const timer = new StepTimer();

  // Load memory context for prompt injection
  const memoryContext = projectId ? await loadMemoryContext(projectId) : '';
  timer.step('load_memory');

  timer.step('acquire_browser');
  broadcast({ type: 'thought', content: 'Connecting to browser via CDP...' });

  const agent = await startBrowserAgent({
    ...(url ? { url } : {}),
    narrate: false,
    llm: {
      provider: 'claude-code',
      options: {
        model: 'claude-sonnet-4-20250514'
      }
    },
    browser: {
      cdp: cdpEndpoint,
    },
  });

  timer.step('start_browser_agent');
  const connector = agent.require(BrowserConnector);
  const stepsHistory: AgentSession['stepsHistory'] = [];
  let stepOrder = 0;

  // Session-scoped state for nav graph writes
  let lastAction: { label: string; selector?: string } | null = null;

  // Get initial page URL for graph tracking
  const currentPageUrl = connector.getHarness().page.url();
  let previousUrl: string | null = currentPageUrl;

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

    // Update lastAction buffer for nav graph edge labels
    const actionLabel = target ? `${actionName}: ${target}` : actionName;
    lastAction = { label: actionLabel };

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

  // Listen for navigation events — update graph + broadcast
  agent.browserAgentEvents.on('nav', (navUrl: string) => {
    broadcast({ type: 'nav', url: navUrl });

    // Fire-and-forget graph update
    if (projectId) {
      const action = lastAction?.label;
      const selector = lastAction?.selector;
      lastAction = null; // Consume the action
      recordNavigation(projectId, previousUrl, navUrl, action, selector).catch(() => {});
    }
    previousUrl = navUrl;
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
  broadcast({ type: 'nav', url: currentPageUrl });

  return {
    agent,
    connector,
    sessionId,
    projectId,
    memoryContext,
    stepsHistory,
    loginDone: Promise.resolve(),
    lastAction: null,
    currentUrl: currentPageUrl,
    close: async () => {
      agent.events.removeAllListeners();
      agent.browserAgentEvents.removeAllListeners();
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

// Schema for navigation items visible on the page
const NavItemsSchema = z.object({
  items: z.array(z.object({
    label: z.string().describe('The clickable text label of the navigation item'),
    description: z.string().describe('Brief description of what section this leads to'),
  })),
});

export async function executeExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  console.log('[EXPLORE] Starting explore...');
  broadcast({ type: 'status', status: 'working' });

  await session.loginDone;
  console.log('[EXPLORE] Login done, starting exploration...');

  session.stepsHistory.length = 0;

  try {
    // Step 1: Identify navigation items on the current page
    const contextHint = context ? `\nContext about this app: ${context}` : '';
    broadcast({ type: 'thought', content: 'Scanning navigation structure...' });
    const navItems = await session.agent.extract(
      `List the main navigation items visible on this page (sidebar, top menu, tabs). For each, provide the exact clickable text label and a brief description of what section it leads to. Only include top-level navigation — not sub-items or dropdowns.${contextHint}`,
      NavItemsSchema
    );
    console.log('[EXPLORE] Found nav items:', navItems.items.map(i => i.label));

    // Step 2: Extract features from the current page first
    broadcast({ type: 'thought', content: 'Analyzing current page...' });
    const currentFeatures = await session.agent.extract(
      'Look at this application page carefully. Identify ALL features visible in the navigation, sidebar, main content, and any menus. For each feature, describe what it does and list expected behaviors. Also identify any multi-step flows. Be thorough.',
      ExtractedFeatureSchema
    );
    await createSuggestionsFromExtraction(session, currentFeatures, broadcast);

    // Step 3: Navigate to each section and extract features
    const maxSections = Math.min(navItems.items.length, 5);
    for (let i = 0; i < maxSections; i++) {
      const item = navItems.items[i];
      broadcast({ type: 'thought', content: `Navigating to ${item.label}...` });

      try {
        await session.agent.act(`Click on "${item.label}" in the navigation`);

        broadcast({ type: 'thought', content: `Analyzing ${item.label}...` });
        const pageFeatures = await session.agent.extract(
          'Look at this application page carefully. Identify ALL features visible in the navigation, sidebar, main content, and any menus. For each feature, describe what it does and list expected behaviors. Also identify any multi-step flows. Be thorough.',
          ExtractedFeatureSchema
        );
        await createSuggestionsFromExtraction(session, pageFeatures, broadcast);
      } catch (navErr) {
        console.error(`[EXPLORE] Failed to explore "${item.label}":`, navErr);
        broadcast({ type: 'thought', content: `Could not explore ${item.label}, continuing...` });
      }
    }

    const context_str = context ? ` Context: ${context}` : '';
    broadcast({ type: 'thought', content: `Exploration complete.${context_str}` });
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

/**
 * Helper: create feature/flow suggestions from extracted data, including discovered_at_url.
 */
async function createSuggestionsFromExtraction(
  session: AgentSession,
  extracted: z.infer<typeof ExtractedFeatureSchema>,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  if (!session.projectId || !session.sessionId) return;

  for (const feature of extracted.features) {
    const suggestion = await createSuggestion(
      session.projectId,
      'feature',
      {
        name: feature.name,
        description: feature.description,
        criticality: feature.criticality,
        expected_behaviors: feature.expected_behaviors,
        discovered_at_url: session.currentUrl || undefined,
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
  if (total > 0) {
    broadcast({ type: 'thought', content: `Discovered ${extracted.features.length} feature(s) and ${extracted.flows.length} flow(s).` });
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
