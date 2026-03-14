# Muscle Memory — Design Spec

## Goal

Make the browser agent progressively faster by recording successful interaction patterns and replaying them via direct Playwright automation, bypassing the LLM for known interactions. V1 covers login flows and navigation shortcuts.

## Scope

**In scope (v1):**
- Login pattern recording and replay via DOM inspection
- Navigation shortcut replay via nav graph edges with text-based locators
- Self-healing: stale pattern detection and automatic re-recording
- Credential safety: LLM never sees passwords during replay
- Client-side feedback ("Replaying saved login..." messages)

**Out of scope (future):**
- Full task replay (requires semantic task matching)
- Cross-project pattern sharing
- Pattern versioning / A/B testing
- Multi-step login forms (email-first → password-second flows). V1 assumes single-page login forms where username, password, and submit are all visible at once. Multi-step support will be added when we encounter it in production.

---

## Key Constraint: Magnitude-core Limitations

Magnitude-core is a vision-based agent. Its `actionDone` events emit:
- `action.variant` — action type ('click', 'type', 'scroll', 'load')
- `action.target` — natural language description ("Login button"), NOT a CSS selector
- `action.content` — typed text or URL
- `action.x, action.y` — screen coordinates (for coord-based actions)

**There are no CSS selectors anywhere in magnitude's event pipeline.** The `stepsHistory` contains `{ order, action, target? }` where `target` is a natural language string.

**However**, the Playwright `page` object IS accessible via `session.connector.getHarness().page`. We can use it directly for DOM inspection and replay.

**Also note:** `nav_edges.action_label` is stored as `"click: Pipelines"` (prefixed with action type), and `action.target` may be natural language like `"the Settings gear icon"` rather than visible UI text. Replay must strip prefixes and use fallback locator strategies.

---

## Data Model

### New table: `learned_patterns`

```sql
CREATE TABLE learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('login', 'navigation')),
  trigger JSONB NOT NULL,
  steps JSONB NOT NULL,
  consecutive_failures INT DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stale')),
  use_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their project patterns"
  ON learned_patterns FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
```

**Unique constraint** — use partial index for stability:

```sql
CREATE UNIQUE INDEX learned_patterns_project_type_login
  ON learned_patterns (project_id, pattern_type)
  WHERE pattern_type = 'login';
```

Only one active login pattern per project. Navigation patterns use the nav_edges table directly (no learned_patterns entry needed).

### TypeScript interface (added to types.ts)

```typescript
interface LearnedPattern {
  id: string;
  project_id: string;
  pattern_type: 'login' | 'navigation';
  trigger: LoginTrigger;
  steps: PlaywrightStep[];
  consecutive_failures: number;
  status: 'active' | 'stale';
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LoginTrigger {
  type: 'login';
  url_pattern: string;
}

interface PlaywrightStep {
  action: 'fill' | 'click' | 'type' | 'press';
  selector: string;         // CSS or Playwright selector from DOM inspection
  value?: string;           // {{username}}, {{password}}, or literal
  waitAfter?: number;       // ms to wait for SPA settling
}
```

Note: `selector` may contain Playwright-specific pseudo-selectors like `button:has-text("Sign in")`. These work with `page.waitForSelector()`, `page.fill()`, `page.click()` but are not standard CSS. This is intentional — Playwright selectors are more robust for automation.

### Steps schema

Login steps use `{{username}}` / `{{password}}` placeholders. Actual credentials injected at replay time from encrypted vault. Never persisted in patterns.

---

## Architecture

### New file: `server/src/muscle-memory.ts`

Single module with clear interface:

```typescript
// Load patterns for a project at session creation
loadPatterns(projectId: string): Promise<LearnedPattern[]>

// Attempt login via recorded pattern, returns success/failure
replayLogin(
  page: Page,
  patterns: LearnedPattern[],
  credentials: { username: string; password: string }
): Promise<boolean>

// Attempt navigation via nav graph, returns success/failure
replayNavigation(
  page: Page,
  projectId: string,
  currentUrl: string,
  targetPageTitle: string
): Promise<boolean>

// Inspect login page DOM after successful LLM login, record pattern
recordLoginPattern(
  page: Page,
  projectId: string,
  loginUrl: string,
  credentials: { username: string; password: string }
): Promise<void>

// Mark pattern as stale after 3 consecutive failures
markStale(patternId: string): Promise<void>

// Reset failures and increment use count on success
markSuccess(patternId: string): Promise<void>
```

**Supabase guard:** Every function starts with `if (!isSupabaseEnabled()) return null/false/[]` following the existing codebase pattern.

### Integration points

**AgentSession** — add `patterns: LearnedPattern[]` field, loaded at creation alongside `memoryContext`.

**executeLogin (agent.ts):**
```
1. Try replayLogin() with loaded patterns
2. If success → markSuccess, broadcast "Logged in via muscle memory (<2s)", done
3. If failure → increment failures, markStale if 3 strikes
4. Fall back to LLM agent.act() (existing path)
5. If LLM succeeds → recordLoginPattern() via DOM inspection in background tab
```

**executeTask (agent.ts):**
```
1. Parse task for target page references (word-boundary match against nav_nodes)
2. If match found → try replayNavigation()
3. If success → broadcast "Navigated to {page} via shortcut", proceed with task
4. If failure or no match → send full task to LLM agent as today
```

---

## Prerequisite: Populate nav_nodes.page_title

Currently `page_title` is always empty. Add to the `nav` event handler in `agent.ts`:

```typescript
agent.events.on('nav', async (url: string) => {
  const page = connector.getHarness().page;
  const title = await page.title().catch(() => '');
  // ... existing recordNavigation call, pass title:
  recordNavigation(session, fromUrl, url, title);
});
```

Update `recordNavigation` and `upsertNode` in `nav-graph.ts` to accept and persist `title`.

---

## Recording

### Login recording — DOM inspection in a new tab

**Why not stepsHistory?** Magnitude's stepsHistory contains natural language targets ("Login button"), not CSS selectors. Coordinate-based replay is fragile across viewport sizes. Instead, we inspect the DOM directly.

**Why a new tab?** After a successful LLM login, the main page has navigated away from the login form. Navigating back on the main page would disrupt the user's browser view (they'd see the login page flash). Instead, we open a new tab, inspect there, and close it. The main page stays untouched.

**Triggered:** After successful `agent.act()` login (LLM path).

**Process:**
1. Open a new tab in the same browser context:
   ```typescript
   const context = connector.getHarness().page.context();
   const inspectPage = await context.newPage();
   ```
2. Navigate to the login URL in the new tab:
   ```typescript
   await inspectPage.goto(loginUrl, { waitUntil: 'networkidle', timeout: 5000 });
   ```
3. Inspect the DOM for common login form patterns:
   ```typescript
   // Find username field — try selectors in priority order
   const usernameSelector = await findFirstVisible(inspectPage, [
     'input[type="email"]',
     'input[name="email"]',
     'input[name="username"]',
     'input[type="text"][autocomplete="username"]',
     'input[type="text"]',  // fallback: first visible text input
   ]);

   // Find password field
   const passwordSelector = await findFirstVisible(inspectPage, [
     'input[type="password"]',
     'input[name="password"]',
   ]);

   // Find submit button
   const submitSelector = await findFirstVisible(inspectPage, [
     'button[type="submit"]',
     'input[type="submit"]',
     'button:has-text("Sign in")',
     'button:has-text("Log in")',
     'button:has-text("Login")',
     'button:has-text("Submit")',
   ]);
   ```
4. If all three found, build `PlaywrightStep[]`:
   ```json
   [
     { "action": "fill", "selector": "input[type=\"email\"]", "value": "{{username}}" },
     { "action": "fill", "selector": "input[type=\"password\"]", "value": "{{password}}" },
     { "action": "click", "selector": "button[type=\"submit\"]" }
   ]
   ```
5. Verify by dry-running on the inspect tab: fill credentials, click submit, check if login succeeds
6. If dry run succeeds → upsert into `learned_patterns`
7. Close the inspect tab:
   ```typescript
   await inspectPage.close();
   ```

**If any selector is not found**, skip recording — the login form is non-standard and will continue using the LLM path. Log a warning for debugging.

### Navigation recording

No new recording needed. Existing `nav-graph.ts` records `nav_edges` with `action_label` on every navigation event.

**Enhancement:** In the `actionDone` handler in `agent.ts`, also store the raw `action.target` (natural language) separately from the prefixed `action_label`. Add a `raw_target` column to `nav_edges`:

```sql
ALTER TABLE nav_edges ADD COLUMN raw_target TEXT;
```

This gives us cleaner text for `getByText()` during replay.

---

## Replay

### Login replay

```
replayLogin(page, patterns, credentials):
  pattern = patterns.find(p => p.pattern_type === 'login' && p.status === 'active')
  if (!pattern) return false

  // Wrap entire replay in 10s timeout
  try with Promise.race(10s):
    for step in pattern.steps:
      value = step.value
        ?.replace('{{username}}', credentials.username)
        ?.replace('{{password}}', credentials.password)
      try:
        await page.waitForSelector(step.selector, { timeout: 5000 })
        if step.action === 'fill': await page.fill(step.selector, value)
        if step.action === 'click': await page.click(step.selector)
        if step.action === 'press': await page.keyboard.press(value)
        if step.waitAfter: await page.waitForTimeout(step.waitAfter)
      catch:
        return false  // selector not found, page changed — abort

    // Verify login succeeded (reuse existing robust check from executeLogin)
    await page.waitForLoadState('networkidle', { timeout: 10000 })
    const onLogin = /\/(login|signin|sign-in|auth)\b/i.test(page.url())
      || await page.locator('input[type="password"]').isVisible().catch(() => false)
    return !onLogin
  catch timeout:
    return false
```

### Navigation replay

```
replayNavigation(page, projectId, currentUrl, targetQuery):
  // Resolve current and target nodes
  currentNode = findNodeByUrl(projectId, normalizeUrl(currentUrl))
  targetNode = findNodeByUrlOrTitle(projectId, targetQuery)
  if (!currentNode || !targetNode) return false
  if (currentNode.id === targetNode.id) return true  // already there

  // BFS shortest path through nav_edges
  edges = findPath(projectId, currentNode.id, targetNode.id)
  if (!edges || edges.length === 0) return false

  // Wrap in 15s total timeout
  try with Promise.race(15s):
    for edge in edges:
      // Strip action prefix: "click: Pipelines" → "Pipelines"
      const textLabel = (edge.raw_target || edge.action_label)
        .replace(/^\w+:\s*/, '')
        .trim()

      try:
        // Locator chain with fallbacks
        const clicked = await tryLocators(page, textLabel, 5000)
        if (!clicked) return false
        await page.waitForLoadState('networkidle', { timeout: 5000 })
      catch:
        return false

    // Verify arrived at target
    return normalizeUrl(page.url()) === targetNode.url_pattern
  catch timeout:
    return false
```

### Helper: tryLocators (fallback chain for navigation clicks)

```typescript
async function tryLocators(page: Page, label: string, timeout: number): Promise<boolean> {
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
```

### Helper: findNodeByUrlOrTitle (tightened matching)

```typescript
async function findNodeByUrlOrTitle(projectId: string, query: string): Promise<NavNode | null> {
  const graph = await getGraph(projectId);
  if (!graph) return null;
  const q = query.toLowerCase();

  // 1. Exact page_title match (strongest signal)
  const exactTitle = graph.nodes.find(n =>
    n.page_title && n.page_title.toLowerCase() === q
  );
  if (exactTitle) return exactTitle;

  // 2. Word-boundary match on URL path segments
  //    "pipelines" matches /ai-studio/pipelines but not /ai-studio/pipeline-config
  const byUrl = graph.nodes.find(n => {
    const segments = n.url_pattern.split('/').filter(Boolean);
    return segments.some(seg => {
      const regex = new RegExp(`\\b${escapeRegex(seg)}\\b`, 'i');
      return regex.test(q);
    });
  });
  if (byUrl) return byUrl;

  // 3. Substring match on page_title (weakest signal)
  return graph.nodes.find(n =>
    n.page_title && q.includes(n.page_title.toLowerCase())
  ) || null;
}
```

### Helper: findPath (BFS)

```typescript
// Load all edges for project, BFS in-memory (graph is small, <50 nodes)
async function findPath(projectId: string, fromId: string, toId: string): Promise<NavEdge[]> {
  const graph = await getGraph(projectId);
  if (!graph) return [];

  // Build adjacency list
  const adj = new Map<string, NavEdge[]>();
  for (const edge of graph.edges) {
    if (!adj.has(edge.from_node_id)) adj.set(edge.from_node_id, []);
    adj.get(edge.from_node_id)!.push(edge);
  }

  // BFS
  const queue: Array<{ nodeId: string; path: NavEdge[] }> = [{ nodeId: fromId, path: [] }];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    for (const edge of adj.get(nodeId) || []) {
      if (edge.to_node_id === toId) return [...path, edge];
      if (!visited.has(edge.to_node_id)) {
        visited.add(edge.to_node_id);
        queue.push({ nodeId: edge.to_node_id, path: [...path, edge] });
      }
    }
  }
  return []; // no path found
}
```

---

## Self-Healing

**Strike counter:**
- Each pattern has `consecutive_failures` (default 0)
- On replay failure: increment `consecutive_failures`
- On `consecutive_failures >= 3`: set `status = 'stale'`, stop attempting replay
- On successful LLM completion of the same flow: record new pattern, overwriting the stale one
- On successful replay: reset `consecutive_failures` to 0, increment `use_count`

**Why 3 strikes:** One failure could be a transient issue (slow load, modal popup). Three consecutive failures means the UI has changed. Simple, no statistics needed.

**Concurrent recording:** The unique partial index on `(project_id, pattern_type) WHERE pattern_type = 'login'` ensures only one login pattern per project. `ON CONFLICT DO UPDATE` handles concurrent upserts — last writer wins, which is fine since both would have discovered the same login form.

---

## Credential Safety

| Path | LLM sees credentials? | Credentials in DB? |
|------|----------------------|-------------------|
| Replay (muscle memory) | No — pure Playwright | No — only `{{placeholders}}` stored |
| LLM fallback | Yes — current behavior via agent.act() | No — only in encrypted `projects.credentials` |
| Recording (DOM inspect) | No — only used for dry-run verification | No |

Future improvement: blind injection for LLM path too (requires Magnitude API support).

---

## Client Feedback

Broadcast muscle memory events to the client so users understand why the agent is fast:

```typescript
broadcast({ type: 'thought', content: 'Replaying saved login pattern...' });
// on success:
broadcast({ type: 'thought', content: 'Logged in via muscle memory (1.2s)' });
// on failure + fallback:
broadcast({ type: 'thought', content: 'Saved login pattern failed, using AI agent...' });
```

Same pattern for navigation shortcuts:
```typescript
broadcast({ type: 'thought', content: 'Navigating to Pipelines via shortcut...' });
```

---

## Performance Expectations

| Flow | Current (LLM) | With Muscle Memory |
|------|---------------|-------------------|
| Login | ~30s | <2s (replay) or ~30s (fallback) |
| Navigate to known page | ~5-10s | <1s (replay) or ~5-10s (fallback) |
| Navigate to unknown page | ~5-10s | ~5-10s (no pattern, LLM only) |
| First login (record) | ~30s | ~34s (login + new tab inspect + dry run) |

---

## Timeouts

- Login replay: **10s total** — abort if any step or verification exceeds this
- Navigation replay: **5s per hop, 15s total** — abort on timeout
- DOM inspection during recording: **5s** for selector discovery
- Dry run login verification: **10s**
- All timeouts trigger graceful fallback to LLM agent, never block the session

---

## Testing Strategy

- Unit tests for `muscle-memory.ts`:
  - `findFirstVisible` selector priority
  - Placeholder injection with credential values
  - Stale marking after 3 failures, reset on success
  - `findPath` BFS on small graphs
  - `findNodeByUrlOrTitle` word-boundary matching
  - `tryLocators` fallback chain
- Integration test: mock Playwright page → record login DOM → replay → verify
- Integration test: nav graph BFS path finding with real nav_edges data
- Edge cases: stale pattern recovery, missing selectors, partial replay failure, concurrent recording, Supabase disabled fallback, multi-tab inspect page lifecycle
