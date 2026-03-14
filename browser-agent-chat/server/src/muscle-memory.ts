import { supabase, isSupabaseEnabled } from './supabase.js';
import { getGraph, normalizeUrl } from './nav-graph.js';
import type { LearnedPattern, PlaywrightStep, NavNode, NavEdge, NavGraph } from './types.js';

// ─── DB Operations ────────────────────────────────────────────────

/** Load active patterns for a project. */
export async function loadPatterns(projectId: string): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];

  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'active');

  if (error || !data) {
    console.error('[MUSCLE-MEMORY] loadPatterns error:', error);
    return [];
  }
  return data;
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
  await supabase!.rpc('increment_pattern_use_count', { pattern_uuid: patternId }).catch(() => {});
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
  credentials: { username: string; password: string },
): PlaywrightStep[] {
  return steps.map(step => {
    if (!step.value) return step;
    return {
      ...step,
      value: step.value
        .replace('{{username}}', credentials.username)
        .replace('{{password}}', credentials.password),
    };
  });
}

/** Strip action prefix from nav edge labels: "click: Pipelines" → "Pipelines" */
export function stripActionPrefix(label: string): string {
  return label.replace(/^\w+:\s*/, '').trim();
}

/** Find a nav node by page title or URL path segment. */
export function findNodeByUrlOrTitle(nodes: NavNode[], query: string): NavNode | null {
  const q = query.toLowerCase();

  // 1. Exact page_title match (strongest signal)
  const exactTitle = nodes.find(n =>
    n.pageTitle && n.pageTitle.toLowerCase() === q
  );
  if (exactTitle) return exactTitle;

  // 2. Word-boundary match on URL path segments
  const byUrl = nodes.find(n => {
    const segments = n.urlPattern.split('/').filter(Boolean);
    return segments.some(seg => seg.toLowerCase() === q);
  });
  if (byUrl) return byUrl;

  // 3. Substring match on page_title (weakest)
  return nodes.find(n =>
    n.pageTitle && n.pageTitle.toLowerCase().includes(q)
  ) || null;
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
  projectId: string,
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

    await upsertLoginPattern(projectId, loginUrl, steps);
    console.log('[MUSCLE-MEMORY] Login pattern recorded for project:', projectId);
  } catch (err) {
    console.error('[MUSCLE-MEMORY] recordLoginPattern error:', err);
  } finally {
    if (inspectPage) {
      await inspectPage.close().catch(() => {});
    }
  }
}

/** Upsert a login pattern for a project (manual query since partial unique index). */
export async function upsertLoginPattern(
  projectId: string,
  loginUrl: string,
  steps: PlaywrightStep[],
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const urlPattern = normalizeUrl(loginUrl);

  // Check for existing login pattern (partial unique index can't be used with .upsert())
  const { data: existing } = await supabase!
    .from('learned_patterns')
    .select('id')
    .eq('project_id', projectId)
    .eq('pattern_type', 'login')
    .limit(1)
    .maybeSingle();

  const payload = {
    project_id: projectId,
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
      .update(payload)
      .eq('id', existing.id);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern update error:', error);
  } else {
    const { error } = await supabase!
      .from('learned_patterns')
      .insert(payload);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern insert error:', error);
  }
}
