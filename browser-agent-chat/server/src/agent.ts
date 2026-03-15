import { startBrowserAgent, BrowserConnector, type BrowserAgent } from 'magnitude-core';
import { z } from 'zod';
import type { ServerMessage, MetricStep } from './types.js';
import { saveMessage, createSuggestion } from './db.js';
import { loadMemoryContext, buildTaskPrompt, buildTaskPromptWithPatterns } from './memory-engine.js';
import { parseFindingsFromText, processFinding } from './finding-detector.js';
import { parseMemoryUpdates } from './suggestion-detector.js';
import { recordNavigation, getGraph } from './nav-graph.js';
import type { LearnedPattern } from './types.js';
import { loadPatterns, replayLogin, replayNavigation, recordLoginPattern, markSuccess, incrementFailures, findNodeByUrlOrTitle } from './muscle-memory.js';
import { getLangfuse } from './langfuse.js';
import type { LangfuseTraceClient } from 'langfuse';

export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  agentId: string | null;
  memoryContext: string;
  patterns: LearnedPattern[];
  stepsHistory: Array<{ order: number; action: string; target?: string }>;
  /** Resolves when background login finishes (or immediately if no login). */
  loginDone: Promise<void>;
  /** Last action performed — consumed by nav listener for edge labels. */
  lastAction: { label: string; selector?: string; rawTarget?: string } | null;
  /** Current page URL — updated on every nav event. */
  currentUrl: string | null;
  /** Active Langfuse trace — set during task/explore/login execution. */
  currentTrace: LangfuseTraceClient | null;
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
  agentId: string | null = null,
  url?: string,
): Promise<AgentSession> {
  broadcast({ type: 'status', status: 'working' });
  const timer = new StepTimer();

  // Load memory context for prompt injection
  const memoryContext = agentId ? await loadMemoryContext(agentId) : '';
  timer.step('load_memory');

  const patterns = agentId ? await loadPatterns(agentId) : [];
  timer.step('load_patterns');

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

  // Set a sensible default viewport before any page interaction.
  // The client overrides this with actual panel dimensions via the 'viewport' message.
  try {
    await connector.getHarness().page.setViewportSize({ width: 1440, height: 900 });
    console.log('[AGENT] Default viewport set to 1440x900');
  } catch (err) {
    console.warn('[AGENT] Failed to set default viewport:', err);
  }

  // When reusing a warm-pool browser via CDP, magnitude may not navigate to the
  // target URL. Force navigation if the current page doesn't match.
  if (url) {
    const page = connector.getHarness().page;
    const current = page.url();
    if (current !== url && !current.startsWith(url)) {
      console.log(`[AGENT] Warm browser on ${current}, navigating to ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err) {
        console.warn('[AGENT] Navigation to target URL failed:', err);
      }
    }
  }

  const stepsHistory: AgentSession['stepsHistory'] = [];
  let stepOrder = 0;

  // Session-scoped state for nav graph writes
  let lastAction: { label: string; selector?: string; rawTarget?: string } | null = null;

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

  // Declare session before listeners — listeners reference it via closure
  const session: AgentSession = {
    agent,
    connector,
    sessionId,
    agentId,
    memoryContext,
    patterns,
    stepsHistory,
    loginDone: Promise.resolve(),
    lastAction: null,
    currentUrl: currentPageUrl,
    currentTrace: null,
    close: async () => {
      agent.events.removeAllListeners();
      agent.browserAgentEvents.removeAllListeners();
    }
  };

  // Listen for agent thoughts — parse for findings and memory updates
  agent.events.on('thought', async (thought: string) => {
    broadcast({ type: 'thought', content: thought });
    if (sessionId) await saveMessage(sessionId, 'thought', thought);

    // Log to Langfuse trace
    session.currentTrace?.event({ name: 'thought', input: { content: thought } });

    // Check for findings in thought text
    if (agentId && sessionId) {
      const rawFindings = parseFindingsFromText(thought);
      for (const raw of rawFindings) {
        const finding = await processFinding(
          raw, agentId, sessionId, [...stepsHistory], getScreenshotBase64
        );
        if (finding) {
          broadcast({ type: 'finding', finding });
        }
      }

      // Parse MEMORY_JSON → create suggestions (not direct features)
      const memUpdates = parseMemoryUpdates(thought);
      for (const update of memUpdates) {
        const suggestion = await createSuggestion(
          agentId, update.type, update.data, sessionId
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
    lastAction = { label: actionLabel, rawTarget: target as string | undefined };

    // Log to Langfuse trace
    session.currentTrace?.event({ name: 'action', input: { action: actionName, target } });

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
  agent.browserAgentEvents.on('nav', async (navUrl: string) => {
    broadcast({ type: 'nav', url: navUrl });

    // Fire-and-forget graph update
    if (agentId) {
      const action = lastAction?.label;
      const selector = lastAction?.selector;
      const rawTarget = lastAction?.rawTarget;
      lastAction = null; // Consume the action

      // Get page title for nav node
      let title = '';
      try {
        title = await connector.getHarness().page.title();
      } catch {}

      recordNavigation(agentId, previousUrl, navUrl, action, selector, title, rawTarget).catch(() => {});
    }
    previousUrl = navUrl;
    session.currentUrl = navUrl;
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

  return session;
}

export async function executeLogin(
  session: AgentSession,
  credentials: { username: string; password: string },
  broadcast: (msg: ServerMessage) => void
): Promise<void> {
  const page = session.connector.getHarness().page;
  const loginUrl = page.url(); // Capture login URL before any navigation

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'login',
    sessionId: session.sessionId ?? undefined,
    metadata: { agentId: session.agentId },
    tags: [`agent:${session.agentId}`],
    input: { username: credentials.username },
  }) ?? null;
  session.currentTrace = trace;

  // 1. Try muscle memory replay first
  if (session.patterns.length > 0) {
    broadcast({ type: 'thought', content: 'Replaying saved login pattern...' });
    const replaySpan = trace?.span({ name: 'muscle-memory-login-replay' });

    const startTime = Date.now();
    const success = await replayLogin(page, session.patterns, credentials);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (success) {
      replaySpan?.end({ output: { success: true, elapsed } });
      const pattern = session.patterns.find(p => p.pattern_type === 'login' && p.pattern_state === 'active');
      if (pattern) markSuccess(pattern.id).catch(() => {});

      broadcast({ type: 'thought', content: `Logged in via muscle memory (${elapsed}s)` });
      broadcast({ type: 'screenshot', data: (await page.screenshot({ type: 'png' })).toString('base64') });
      broadcast({ type: 'nav', url: page.url() });
      trace?.update({ output: { success: true, method: 'muscle-memory', elapsed } });
      session.currentTrace = null;
      return;
    }

    // Replay failed — increment failures
    replaySpan?.end({ output: { success: false, elapsed } });
    const pattern = session.patterns.find(p => p.pattern_type === 'login' && p.pattern_state === 'active');
    if (pattern) {
      incrementFailures(pattern.id, pattern.consecutive_failures).catch(() => {});
    }
    broadcast({ type: 'thought', content: 'Saved login pattern failed, using AI agent...' });
  } else {
    broadcast({ type: 'thought', content: 'Logging in...' });
  }

  // 2. Fall back to LLM agent
  try {
    const span = trace?.span({ name: 'agent-act-login' });
    await session.agent.act(`Log in with username "${credentials.username}" and password "${credentials.password}"`);
    span?.end({ output: { success: true } });
    console.log('[LOGIN] Done, URL:', page.url());
  } catch (err) {
    console.error('[LOGIN] Failed:', err);
    trace?.update({ output: { success: false, error: String(err) } });
    session.currentTrace = null;
    broadcast({ type: 'error', message: 'Auto-login failed. You can log in via chat.' });
    return;
  }

  // 3. Capture post-login state
  try {
    const buf = await page.screenshot({ type: 'png' });
    broadcast({ type: 'screenshot', data: buf.toString('base64') });
    broadcast({ type: 'nav', url: page.url() });

    const onLogin = /\/(login|signin|sign-in|auth)\b/i.test(page.url())
      || await page.locator('input[type="password"]').isVisible().catch(() => false);
    broadcast({ type: 'thought', content: onLogin
      ? 'Could not log in. Please log in via chat.'
      : 'Logged in successfully' });
    trace?.update({ output: { success: !onLogin, method: 'llm', url: page.url() } });

    // 4. Record login pattern for next time (background, fire-and-forget)
    if (!onLogin && session.agentId) {
      recordLoginPattern(page, session.agentId, loginUrl).catch(err => {
        console.error('[MUSCLE-MEMORY] Background recording error:', err);
      });
    }
  } catch {}
  session.currentTrace = null;
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

  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'explore',
    sessionId: session.sessionId ?? undefined,
    metadata: { agentId: session.agentId },
    tags: [`agent:${session.agentId}`],
    input: { context },
  }) ?? null;
  session.currentTrace = trace;

  try {
    // Step 1: Identify navigation items on the current page
    const contextHint = context ? `\nContext about this app: ${context}` : '';
    broadcast({ type: 'thought', content: 'Scanning navigation structure...' });
    const navSpan = trace?.span({ name: 'extract-nav-items' });
    const navItems = await session.agent.extract(
      `List the main navigation items visible on this page (sidebar, top menu, tabs). For each, provide the exact clickable text label and a brief description of what section it leads to. Only include top-level navigation — not sub-items or dropdowns.${contextHint}`,
      NavItemsSchema
    );
    navSpan?.end({ output: { items: navItems.items.map(i => i.label) } });
    console.log('[EXPLORE] Found nav items:', navItems.items.map(i => i.label));

    // Step 2: Extract features from the current page first
    broadcast({ type: 'thought', content: 'Analyzing current page...' });
    const homeSpan = trace?.span({ name: 'extract-features-home' });
    const currentFeatures = await session.agent.extract(
      'Look at this application page carefully. Identify ALL features visible in the navigation, sidebar, main content, and any menus. For each feature, describe what it does and list expected behaviors. Also identify any multi-step flows. Be thorough.',
      ExtractedFeatureSchema
    );
    homeSpan?.end({ output: { features: currentFeatures.features.length, flows: currentFeatures.flows.length } });
    await createSuggestionsFromExtraction(session, currentFeatures, broadcast);

    // Step 3: Navigate to each section and extract features
    const maxSections = Math.min(navItems.items.length, 5);
    for (let i = 0; i < maxSections; i++) {
      const item = navItems.items[i];
      broadcast({ type: 'thought', content: `Navigating to ${item.label}...` });

      const sectionSpan = trace?.span({ name: `explore-section-${item.label}` });
      try {
        await session.agent.act(`Click on "${item.label}" in the navigation`);

        broadcast({ type: 'thought', content: `Analyzing ${item.label}...` });
        const pageFeatures = await session.agent.extract(
          'Look at this application page carefully. Identify ALL features visible in the navigation, sidebar, main content, and any menus. For each feature, describe what it does and list expected behaviors. Also identify any multi-step flows. Be thorough.',
          ExtractedFeatureSchema
        );
        sectionSpan?.end({ output: { features: pageFeatures.features.length, flows: pageFeatures.flows.length } });
        await createSuggestionsFromExtraction(session, pageFeatures, broadcast);
      } catch (navErr) {
        sectionSpan?.end({ output: { error: String(navErr) } });
        console.error(`[EXPLORE] Failed to explore "${item.label}":`, navErr);
        broadcast({ type: 'thought', content: `Could not explore ${item.label}, continuing...` });
      }
    }

    const context_str = context ? ` Context: ${context}` : '';
    broadcast({ type: 'thought', content: `Exploration complete.${context_str}` });
    trace?.update({ output: { success: true, steps: session.stepsHistory.length } });
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Exploration failed';
    console.error('[EXPLORE] Failed:', errMsg);
    trace?.update({ output: { success: false, error: errMsg } });
    broadcast({ type: 'error', message: errMsg });
    broadcast({ type: 'taskComplete', success: false });
  } finally {
    session.currentTrace = null;
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
  if (!session.agentId || !session.sessionId) return;

  for (const feature of extracted.features) {
    const suggestion = await createSuggestion(
      session.agentId,
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
      session.agentId,
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

  // Build prompt with memory context + learned patterns
  let prompt: string;
  if (session.agentId) {
    try {
      const result = await buildTaskPromptWithPatterns(session.agentId, task);
      prompt = result.prompt;
    } catch {
      // Fallback to basic prompt if pattern retrieval fails
      prompt = buildTaskPrompt(task, session.memoryContext);
    }
  } else {
    prompt = task;
  }

  // Reset step counter for this task
  session.stepsHistory.length = 0;

  // Create Langfuse trace for this task
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: 'user-task',
    sessionId: session.sessionId ?? undefined,
    metadata: { agentId: session.agentId },
    tags: [`agent:${session.agentId}`],
    input: { task },
  }) ?? null;
  session.currentTrace = trace;

  // Try navigation shortcut if project has nav graph data
  if (session.agentId && session.currentUrl) {
    try {
      const graph = await getGraph(session.agentId);

      if (graph.nodes.length > 0) {
        // Check if task mentions a known page title or URL segment
        const targetNode = findNodeByUrlOrTitle(graph.nodes, task);

        if (targetNode) {
          const navSpan = trace?.span({ name: 'muscle-memory-nav-shortcut' });
          broadcast({ type: 'thought', content: `Navigating to ${targetNode.pageTitle || targetNode.urlPattern} via shortcut...` });

          const navSuccess = await replayNavigation(
            session.connector.getHarness().page,
            session.agentId,
            session.currentUrl,
            task,
          );

          if (navSuccess) {
            navSpan?.end({ output: { success: true, target: targetNode.urlPattern } });
            broadcast({ type: 'thought', content: `Navigated to ${targetNode.pageTitle || targetNode.urlPattern} via shortcut` });

            // Capture screenshot after navigation
            try {
              const buf = await session.connector.getHarness().page.screenshot({ type: 'png' });
              broadcast({ type: 'screenshot', data: buf.toString('base64') });
              broadcast({ type: 'nav', url: session.connector.getHarness().page.url() });
            } catch {}

            // If the task was just navigation, we're done
            const isNavOnly = /^(go to|navigate to|open)\s/i.test(task);
            if (isNavOnly) {
              trace?.update({ output: { success: true, method: 'nav-shortcut' } });
              broadcast({ type: 'taskComplete', success: true });
              session.currentTrace = null;
              broadcast({ type: 'status', status: 'idle' });
              return;
            }
            // Otherwise continue with the task (now on the right page)
          } else {
            navSpan?.end({ output: { success: false } });
          }
        }
      }
    } catch (err) {
      // Nav shortcut failed silently — fall through to LLM
      console.error('[TASK] Nav shortcut error:', err);
    }
  }

  try {
    const span = trace?.span({ name: 'agent-act', input: { prompt } });
    await session.agent.act(prompt);
    span?.end({ output: { success: true, steps: session.stepsHistory.length } });
    trace?.update({ output: { success: true, stepsCount: session.stepsHistory.length } });
    broadcast({ type: 'taskComplete', success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    trace?.update({ output: { success: false, error: message } });
    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
    if (session.sessionId) {
      await saveMessage(session.sessionId, 'system', `Error: ${message}`);
    }
  } finally {
    session.currentTrace = null;
    broadcast({ type: 'status', status: 'idle' });
  }
}
