import { startBrowserAgent, BrowserConnector, type BrowserAgent } from 'magnitude-core';
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
  credentials: { username: string; password: string } | null = null
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

  // Log in with credentials if provided
  if (credentials) {
    const page = connector.getHarness().page;
    broadcast({ type: 'thought', content: 'Logging in...' });

    // Try Playwright direct login (fast path)
    let playwrightFilled = false;
    try {
      const usernameField = page.getByPlaceholder(/username|email|login/i).first();
      const passwordField = page.getByPlaceholder(/password/i).first();

      await usernameField.waitFor({ state: 'visible', timeout: 3000 });
      await usernameField.fill(credentials.username);
      await passwordField.fill(credentials.password);

      const submitBtn = page.locator(
        'button[type="submit"], input[type="submit"], ' +
        'button:has-text("Sign In"), button:has-text("Log In"), ' +
        'button:has-text("Login"), button:has-text("Submit")'
      ).first();
      await submitBtn.click();
      playwrightFilled = true;
      console.log('[LOGIN] Playwright filled and submitted');

      // Wait for full redirect chain + SPA auth guards to settle
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      // Poll until URL is stable for 2 seconds (catches delayed SPA redirects)
      let lastUrl = page.url();
      let stableMs = 0;
      while (stableMs < 2000) {
        await page.waitForTimeout(500);
        const currentUrl = page.url();
        if (currentUrl === lastUrl) {
          stableMs += 500;
        } else {
          lastUrl = currentUrl;
          stableMs = 0;
        }
        // Safety cap at 10 seconds of polling
        if (stableMs < 0) break;
      }
      console.log('[LOGIN] URL stabilized at:', page.url());
    } catch (err) {
      console.warn('[LOGIN] Playwright fill/submit failed:', (err as Error).message);
    }

    // Check if we're still on a login page after everything settled
    const stillOnLogin = await page.locator('input[type="password"]').isVisible().catch(() => false);
    console.log('[LOGIN] After settle — URL:', page.url(), '| Still on login?', stillOnLogin);

    if (stillOnLogin) {
      // Playwright login didn't stick — use LLM agent as fallback
      broadcast({ type: 'thought', content: 'Retrying login with AI agent...' });
      try {
        await agent.act(`Log in with username "${credentials.username}" and password "${credentials.password}"`);
        // Wait for LLM login to settle
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
        console.log('[LOGIN] LLM agent login done, URL:', page.url());
      } catch (err2) {
        console.error('[LOGIN] LLM agent login also failed:', err2);
        broadcast({ type: 'error', message: 'Auto-login failed. You can log in manually via chat.' });
      }
    }

    // Final screenshot and status — whatever state we ended up in
    try {
      const screenshotBuffer = await page.screenshot({ type: 'png' });
      const base64 = screenshotBuffer.toString('base64');
      broadcast({ type: 'screenshot', data: base64 });
      broadcast({ type: 'nav', url: page.url() });

      const finallyOnLogin = await page.locator('input[type="password"]').isVisible().catch(() => false);
      if (finallyOnLogin) {
        console.log('[LOGIN] FAILED — still on login page after all attempts');
        broadcast({ type: 'thought', content: 'Could not log in automatically. Please log in via chat.' });
      } else {
        console.log('[LOGIN] SUCCESS — logged in, URL:', page.url());
        broadcast({ type: 'thought', content: 'Logged in successfully' });
      }
    } catch (err) {
      console.error('[LOGIN] Failed to capture final screenshot:', err);
    }

    timer.step('auto_login');
  }

  // Emit startup metrics
  const metrics = { total: timer.total, steps: timer.steps };
  console.log('[METRICS] Agent startup:', JSON.stringify(metrics));
  broadcast({ type: 'metrics', metrics });

  broadcast({ type: 'status', status: 'idle' });
  broadcast({ type: 'nav', url });

  return {
    agent,
    connector,
    sessionId,
    projectId,
    memoryContext,
    stepsHistory,
    close: async () => {
      await agent.stop();
    }
  };
}

export async function executeExplore(
  session: AgentSession,
  context: string | null,
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  broadcast({ type: 'status', status: 'working' });

  const prompt = buildExplorePrompt(context);
  session.stepsHistory.length = 0;

  try {
    await session.agent.act(prompt);
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Exploration failed';
    broadcast({ type: 'error', message });
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
