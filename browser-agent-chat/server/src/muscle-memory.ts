import { supabase, isSupabaseEnabled } from './supabase.js';
import { getGraph, normalizeUrl } from './nav-graph.js';
import type { LearnedPattern, PlaywrightStep, PlaintextSecret, NavNode, NavEdge, NavGraph } from './types.js';

// ─── DB Operations ────────────────────────────────────────────────

/** Load active patterns for a project. */
export async function loadPatterns(agentId: string): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];

  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('agent_id', agentId)
    .eq('status', 'active');

  if (error || !data) {
    console.error('[MUSCLE-MEMORY] loadPatterns error:', error);
    return [];
  }
  return data;
}

/** Load active patterns for a specific domain (used by handleLoginDetection). */
export async function getLearnedPatterns(agentId: string, domain: string): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];
  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('agent_id', agentId)
    .eq('domain', domain)
    .eq('status', 'active');
  if (error || !data) return [];
  return data as LearnedPattern[];
}

/** Mark a pattern as stale (stop attempting replay). */
export async function markStale(patternId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('learned_patterns')
    .update({ status: 'stale', updated_at: new Date().toISOString() })
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] markStale error:', error);
}

/** Reset failures and increment use count on successful replay. */
export async function markSuccess(patternId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  // Reset failures and update timestamps; use_count incremented atomically via RPC
  const { error } = await supabase!
    .from('learned_patterns')
    .update({
      consecutive_failures: 0,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] markSuccess error:', error);

  // Atomically increment use_count
  await supabase!.rpc('increment_pattern_use_count', { pattern_uuid: patternId }).then(undefined, () => {});
}

/** Increment consecutive_failures; mark stale if >= 3. */
export async function incrementFailures(patternId: string, currentFailures: number): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const newCount = currentFailures + 1;
  const updates: Record<string, unknown> = {
    consecutive_failures: newCount,
    updated_at: new Date().toISOString(),
  };
  if (newCount >= 3) {
    updates.status = 'stale';
  }

  const { error } = await supabase!
    .from('learned_patterns')
    .update(updates)
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] incrementFailures error:', error);
}

// ─── Pure Helpers ─────────────────────────────────────────────────

/** Inject credential values into placeholder steps. */
export function injectCredentials(
  steps: PlaywrightStep[],
  secret: PlaintextSecret,
  metadata: { username?: string },
): PlaywrightStep[] {
  return steps.map(step => {
    if (!step.value) return step;
    let value = step.value;
    if (metadata.username) value = value.replace('{{username}}', metadata.username);
    if (secret.password) value = value.replace('{{password}}', secret.password);
    return { ...step, value };
  });
}

/** Strip action prefix from nav edge labels: "click: Pipelines" → "Pipelines" */
export function stripActionPrefix(label: string): string {
  return label.replace(/^\w+:\s*/, '').trim();
}

/** Escape special regex characters in a string. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a nav node whose page title or URL path segment appears in the query.
 * Designed to handle both direct queries ("pipelines") and natural language
 * tasks ("go to the pipelines page"). Prefers longer (more specific) matches.
 */
export function findNodeByUrlOrTitle(nodes: NavNode[], query: string): NavNode | null {
  const q = query.toLowerCase();

  // 1. Check if query contains a page title (word-boundary match, longest first)
  const titleMatches = nodes.filter(n => {
    if (!n.pageTitle || n.pageTitle.length < 2) return false;
    const title = escapeRegex(n.pageTitle.toLowerCase());
    return new RegExp(`\\b${title}\\b`).test(q);
  });

  if (titleMatches.length > 0) {
    // Prefer the longest title match (most specific)
    titleMatches.sort((a, b) => (b.pageTitle?.length || 0) - (a.pageTitle?.length || 0));
    return titleMatches[0];
  }

  // 2. Check if query contains a URL path segment (word-boundary match)
  const urlMatches = nodes.filter(n => {
    const segments = n.urlPattern.split('/').filter(s => s.length >= 3);
    return segments.some(seg => {
      const escaped = escapeRegex(seg.toLowerCase());
      return new RegExp(`\\b${escaped}\\b`).test(q);
    });
  });

  if (urlMatches.length > 0) {
    // Prefer the longest URL segment match
    urlMatches.sort((a, b) => b.urlPattern.length - a.urlPattern.length);
    return urlMatches[0];
  }

  return null;
}

/** BFS shortest path through nav edges. Operates on in-memory graph. */
export function findPath(graph: NavGraph, fromId: string, toId: string): NavEdge[] {
  if (fromId === toId) return [];

  // Build adjacency list
  const adj = new Map<string, NavEdge[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.fromNodeId)) adj.set(edge.fromNodeId, []);
    adj.get(edge.fromNodeId)!.push(edge);
  }

  // BFS
  const queue: Array<{ nodeId: string; path: NavEdge[] }> = [{ nodeId: fromId, path: [] }];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    for (const edge of adj.get(nodeId) || []) {
      if (edge.toNodeId === toId) return [...path, edge];
      if (!visited.has(edge.toNodeId)) {
        visited.add(edge.toNodeId);
        queue.push({ nodeId: edge.toNodeId, path: [...path, edge] });
      }
    }
  }
  return [];
}

// ─── DOM Inspection Helpers ───────────────────────────────────────

/** Find the first visible element matching one of the candidate selectors. */
export async function findFirstVisible(
  page: { locator: (selector: string) => { first: () => { isVisible: () => Promise<boolean> } } },
  selectors: string[],
): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const visible = await page.locator(selector).first().isVisible();
      if (visible) return selector;
    } catch {
      // Selector not found or page error — try next
    }
  }
  return null;
}

// ─── Login Recording ──────────────────────────────────────────────

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[type="text"][autocomplete="username"]',
  'input[type="text"]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Submit")',
];

/**
 * Record a login pattern by inspecting the login page DOM in a new tab.
 * Called after successful LLM login to capture the form structure.
 */
export async function recordLoginPattern(
  page: any, // Playwright Page
  agentId: string,
  loginUrl: string,
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  let inspectPage: any = null;
  try {
    // Open a new tab to inspect the login page without disrupting the main view
    const context = page.context();
    inspectPage = await context.newPage();
    await inspectPage.goto(loginUrl, { waitUntil: 'networkidle', timeout: 5000 });

    // Find form elements
    const usernameSelector = await findFirstVisible(inspectPage, USERNAME_SELECTORS);
    const passwordSelector = await findFirstVisible(inspectPage, PASSWORD_SELECTORS);
    const submitSelector = await findFirstVisible(inspectPage, SUBMIT_SELECTORS);

    if (!usernameSelector || !passwordSelector || !submitSelector) {
      console.warn('[MUSCLE-MEMORY] Could not identify all login form elements, skipping recording');
      return;
    }

    const steps: PlaywrightStep[] = [
      { action: 'fill', selector: usernameSelector, value: '{{username}}' },
      { action: 'fill', selector: passwordSelector, value: '{{password}}' },
      { action: 'click', selector: submitSelector },
    ];

    await upsertLoginPattern(agentId, loginUrl, steps);
    console.log('[MUSCLE-MEMORY] Login pattern recorded for project:', agentId);
  } catch (err) {
    console.error('[MUSCLE-MEMORY] recordLoginPattern error:', err);
  } finally {
    if (inspectPage) {
      await inspectPage.close().catch(() => {});
    }
  }
}

/**
 * Record a login pattern with vault credential reference.
 * Called by handleLoginDetection after a successful login to save the pattern for future replays.
 */
export async function recordLoginPatternWithCredential(
  agentId: string,
  domain: string,
  credentialId: string,
  strategy: string,
  selectors: { username: string | null; password: string | null; submit: string | null },
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  const steps: PlaywrightStep[] = [];
  if (selectors.username) {
    steps.push({ action: 'fill', selector: selectors.username, value: '{{username}}' });
  }
  if (selectors.password) {
    steps.push({ action: 'fill', selector: selectors.password, value: '{{password}}' });
  }
  if (selectors.submit) {
    steps.push({ action: 'click', selector: selectors.submit });
  }

  await supabase!
    .from('learned_patterns')
    .upsert({
      agent_id: agentId,
      domain,
      pattern_type: 'login',
      credential_id: credentialId,
      trigger: { type: 'login', url_pattern: domain },
      steps,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_id,domain,pattern_type' });
}

/** Upsert a login pattern for a project (manual query since partial unique index). */
export async function upsertLoginPattern(
  agentId: string,
  loginUrl: string,
  steps: PlaywrightStep[],
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const urlPattern = normalizeUrl(loginUrl);

  // Check for existing login pattern (partial unique index can't be used with .upsert())
  const { data: existing } = await supabase!
    .from('learned_patterns')
    .select('id')
    .eq('agent_id', agentId)
    .eq('pattern_type', 'login')
    .limit(1)
    .maybeSingle();

  const payload = {
    agent_id: agentId,
    pattern_type: 'login' as const,
    trigger: { type: 'login', url_pattern: urlPattern },
    steps,
    consecutive_failures: 0,
    status: 'active' as const,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase!
      .from('learned_patterns')
      .update({ ...payload, use_count: 0 })
      .eq('id', existing.id);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern update error:', error);
  } else {
    const { error } = await supabase!
      .from('learned_patterns')
      .insert(payload);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern insert error:', error);
  }
}

// ─── Login Replay ─────────────────────────────────────────────────

const LOGIN_REPLAY_TIMEOUT = 10_000;

/**
 * Attempt login via a recorded pattern.
 * Returns true if login succeeded, false if failed (caller should fall back to LLM).
 */
export async function replayLogin(
  page: any, // Playwright Page
  patterns: LearnedPattern[],
  secret: PlaintextSecret,
  metadata: { username?: string },
): Promise<boolean> {
  const pattern = patterns.find(
    p => p.pattern_type === 'login' && p.status === 'active'
  );
  if (!pattern) return false;

  try {
    const steps = injectCredentials(pattern.steps, secret, metadata);

    // Race against timeout
    const success = await Promise.race([
      executeSteps(page, steps),
      new Promise<false>(resolve => setTimeout(() => resolve(false), LOGIN_REPLAY_TIMEOUT)),
    ]);

    if (!success) return false;

    // Verify login succeeded
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const onLogin = /\/(login|signin|sign-in|auth)\b/i.test(page.url())
      || await page.locator('input[type="password"]').isVisible().catch(() => false);

    return !onLogin;
  } catch {
    return false;
  }
}

// ─── Navigation Replay ───────────────────────────────────────────

const NAV_HOP_TIMEOUT = 5000;
const NAV_TOTAL_TIMEOUT = 15_000;

/** Try multiple Playwright locator strategies to click an element. */
export async function tryLocators(page: any, label: string, timeout: number): Promise<boolean> {
  // Try text match first (most common for nav items)
  try {
    await page.getByText(label, { exact: false }).first().click({ timeout });
    return true;
  } catch {}

  // Try link role
  try {
    await page.getByRole('link', { name: label }).first().click({ timeout });
    return true;
  } catch {}

  // Try button role
  try {
    await page.getByRole('button', { name: label }).first().click({ timeout });
    return true;
  } catch {}

  // Try menuitem role (for sidebar nav)
  try {
    await page.getByRole('menuitem', { name: label }).first().click({ timeout });
    return true;
  } catch {}

  return false;
}

/**
 * Attempt navigation to a target page via recorded nav graph edges.
 * Uses BFS to find shortest path, then replays each hop with text-based locators.
 */
export async function replayNavigation(
  page: any, // Playwright Page
  agentId: string,
  currentUrl: string,
  targetQuery: string,
): Promise<boolean> {
  try {
    const graph = await getGraph(agentId);
    if (graph.nodes.length === 0) return false;

    // Resolve current node by URL
    const currentPattern = normalizeUrl(currentUrl);
    const currentNode = graph.nodes.find(n => n.urlPattern === currentPattern);
    if (!currentNode) return false;

    // Resolve target node by title/URL
    const targetNode = findNodeByUrlOrTitle(graph.nodes, targetQuery);
    if (!targetNode) return false;
    if (currentNode.id === targetNode.id) return true; // Already there

    // BFS shortest path
    const edges = findPath(graph, currentNode.id, targetNode.id);
    if (edges.length === 0) return false;

    // Race against total timeout
    const success = await Promise.race([
      replayEdges(page, edges),
      new Promise<false>(resolve => setTimeout(() => resolve(false), NAV_TOTAL_TIMEOUT)),
    ]);

    if (!success) return false;

    // Verify we arrived
    const finalPattern = normalizeUrl(page.url());
    return finalPattern === targetNode.urlPattern;
  } catch {
    return false;
  }
}

/** Replay a sequence of nav graph edges by clicking through pages. */
async function replayEdges(page: any, edges: NavEdge[]): Promise<boolean> {
  for (const edge of edges) {
    const textLabel = stripActionPrefix(edge.rawTarget || edge.actionLabel);
    if (!textLabel) return false;

    const clicked = await tryLocators(page, textLabel, NAV_HOP_TIMEOUT);
    if (!clicked) return false;

    try {
      await page.waitForLoadState('networkidle', { timeout: NAV_HOP_TIMEOUT });
    } catch {
      // Timeout waiting for network idle — continue anyway, page might be an SPA
    }
  }
  return true;
}

/** Execute a sequence of Playwright steps on a page. Returns true on success. */
async function executeSteps(page: any, steps: PlaywrightStep[]): Promise<boolean> {
  for (const step of steps) {
    try {
      await page.waitForSelector(step.selector, { timeout: 5000 });

      switch (step.action) {
        case 'fill':
          await page.fill(step.selector, step.value || '');
          break;
        case 'click':
          await page.click(step.selector);
          break;
        case 'type':
          await page.type(step.selector, step.value || '');
          break;
        case 'press':
          await page.keyboard.press(step.value || '');
          break;
      }

      if (step.waitAfter) {
        await page.waitForTimeout(step.waitAfter);
      }
    } catch {
      return false;
    }
  }
  return true;
}
