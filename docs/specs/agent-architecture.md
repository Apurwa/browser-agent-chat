# Agent Architecture Spec

**Status:** FINAL — ready for implementation
**Date:** 2026-03-16
**Framework:** Mastra (workflow runtime, not core agent logic)

---

## 1. Current Architecture

### Orchestration Model

```
index.ts (WebSocket router)
    ↓ dispatches on msg.type
    ↓
executeExplore()              executeTask()
    ↓                             ↓
sequential loop               agent.act(prompt)
extract → click → extract         ↓
    ↓                         Magnitude internal loop
Magnitude handles              (screenshot → LLM → action)
perception → action cycle
```

No orchestration framework. Flat imperative TypeScript. No planner, verifier, state machine, or backtracking.

### Current Explore Flow (`executeExplore`)

1. **Scan nav** — `agent.extract()` → identifies top-level nav items
2. **Analyze home page** — `agent.extract()` → features + flows on current page
3. **Visit sections** — for each nav item (max 5):
   - `agent.act("Click on X")` → navigate
   - `agent.extract()` → features + flows on that page
4. **Save suggestions** — features/flows stored for user review

### Limitations

- Hardcoded max 5 sections, one level deep
- No sub-pages, modals, dropdowns, or expandable sections
- No prioritization — visits nav items in DOM order
- No interaction testing — only reads, never clicks buttons or fills forms
- No verification — doesn't confirm extraction accuracy
- No backtracking — can't recover from navigation errors
- No memory of previous explorations — rediscovers everything each time
- Generic extraction prompt — no domain awareness

---

## 2. Framework Decision

**Decision: Use Mastra as workflow runtime.**

Mastra is the orchestration layer, NOT the core agent logic. The architecture must work without it.

Rationale:
- TypeScript-native — matches our entire stack
- Built-in evals — measure agent efficacy without paid dependencies
- Mastra Studio — visual workflow graph, execution traces, agent playground
- Langfuse integration — works with our existing observability
- 22K GitHub stars, 300K+ weekly npm downloads — largest TS agent community
- Magnitude remains our browser execution layer

---

## 3. Three-Layer Hierarchical Agent Architecture

### 3.1 Design Principles

1. **Three intelligence layers** — Planner (strategy), Policy (action selection), Executor (browser interaction)
2. **Planner produces intents, not clicks** — high-level strategy that the policy interprets against live UI state
3. **Policy is reactive** — selects one action per step from structured action space, guided by planner's current intent
4. **Structured action space** — policy chooses from `{ type, elementId }` schema, not free text
5. **Verification is heuristic-first** — cheap checks before LLM fallback
6. **Perception is compressed** — accessibility tree summary, not full DOM
7. **Budget-controlled** — explicit limits on steps, tokens, cost, time
8. **Intent progress tracking** — each intent has status + confidence, enabling replanning

### 3.2 The Three Layers

```
                     USER GOAL
                         ↓

             ┌─────────────────────┐
             │       PLANNER       │
             │  goal → intent steps │
             │  runs at start +    │
             │  when stuck         │
             └──────────┬──────────┘
                        ↓ strategy (intent list)

             ┌─────────────────────┐
             │       POLICY        │
             │  intent + UI state  │
             │  → next action      │
             │  horizon = 1 step   │
             │  structured actions │
             └──────────┬──────────┘
                        ↓ action

             ┌─────────────────────┐
             │      EXECUTOR       │
             │  magnitude.act()    │
             │  magnitude.extract()│
             │  + login vault      │
             └──────────┬──────────┘
                        ↓

                   environment
```

### 3.3 Planner — Strategic Reasoning

**When it runs:**
- At task start (goal decomposition)
- When policy is stuck (no progress for N steps)
- When unexpected state is reached
- NOT every step — runs maybe every 10-20 steps

**Input:**
- User goal
- World model (known pages, features, skills)
- Current page state (compressed)
- What's been tried so far

**Output:** `StrategyPlan`

```typescript
interface StrategyPlan {
  goal: string;
  intents: Intent[];
}

interface Intent {
  id: string;
  description: string;        // "Find and open application settings"
  successCriteria: string;    // "Settings page visible"
  status: 'pending' | 'active' | 'completed' | 'failed';
  confidence: number;         // 0-1, updated by verification
}
```

**Example:**

```json
{
  "goal": "Create a new webhook in Stripe",
  "intents": [
    {
      "id": "open_settings",
      "description": "Find and open application settings",
      "successCriteria": "Settings page visible",
      "status": "pending",
      "confidence": 0
    },
    {
      "id": "find_developers",
      "description": "Locate developer configuration section",
      "successCriteria": "Developer options visible",
      "status": "pending",
      "confidence": 0
    },
    {
      "id": "open_webhooks",
      "description": "Navigate to webhooks configuration",
      "successCriteria": "Webhook list page visible",
      "status": "pending",
      "confidence": 0
    },
    {
      "id": "create_webhook",
      "description": "Create a new webhook endpoint",
      "successCriteria": "Webhook created confirmation",
      "status": "pending",
      "confidence": 0
    }
  ]
}
```

**Key rule:** Planner produces intent labels, NOT click sequences. The policy interprets intents against live UI.

### 3.4 Policy — Action Selection (The Core Loop)

The policy is the main agent loop. It runs every step.

```
┌──────────────────────────────────────────────┐
│  Policy Loop (Mastra Workflow)                │
│                                               │
│  ┌───────────┐                               │
│  │ PERCEIVE  │                               │
│  │ - screenshot                              │
│  │ - UI elements (accessibility tree)        │
│  │ - current URL + page state                │
│  │ - active intent + progress                │
│  │ - relevant memory (filtered)              │
│  └─────┬─────┘                               │
│        ↓                                     │
│  ┌───────────────────┐                       │
│  │ DECIDE NEXT ACTION │                      │
│  │ structured action from:                   │
│  │ { click, type, scroll, select,            │
│  │   submit, extract, navigate }             │
│  │ against element_id from UI tree           │
│  │ guided by active intent                   │
│  └─────┬─────────────┘                       │
│        ↓                                     │
│  ┌───────────┐                               │
│  │ EXECUTE   │                               │
│  │ magnitude.act()                           │
│  │ + login interception (vault)              │
│  └─────┬─────┘                               │
│        ↓                                     │
│  ┌───────────────┐                           │
│  │ VERIFY_ACTION │                           │
│  │ heuristic checks:                         │
│  │  URL changed? DOM changed?                │
│  │  extraction non-empty? error visible?     │
│  │ LLM fallback only on ambiguity            │
│  └─────┬─────────┘                           │
│        ↓                                     │
│  ┌───────────────────┐                       │
│  │ UPDATE_STATE      │                       │
│  │ nav graph + features + skills + memory    │
│  └─────┬─────────────┘                       │
│        ↓                                     │
│  ┌─────────────────────┐                     │
│  │ EVALUATE_PROGRESS   │                     │
│  │ intent complete? → VERIFY_INTENT          │
│  │ progress detected? → continue             │
│  │ retry possible? → retry_action            │
│  │ stuck? → replan                           │
│  │ replan limit hit? → escalate_to_user      │
│  │ budget exhausted? → done                  │
│  └─────────────────────┘                     │
│        ↓                                     │
│  ┌───────────────┐  (only at intent boundary)│
│  │ VERIFY_INTENT │                           │
│  │ LLM checks successCriteria                │
│  │ updates intent status + confidence        │
│  │ if passed → advance to next intent        │
│  │ if failed → replan                        │
│  └───────────────┘                           │
│                                               │
└──────────────────────────────────────────────┘
```

**Three verification boundaries:**

| Level | What it checks | When | Cost |
|-------|---------------|------|------|
| **VERIFY_ACTION** | Did this single action succeed? | Every step | Cheap (heuristics) |
| **VERIFY_INTENT** | Did we reach the intended milestone? | Intent completion | Moderate (LLM against successCriteria) |
| **PLANNER_CONFIRM** | Is the overall goal achieved? | All intents complete | One LLM call |

**Structured Action Space:**

```typescript
interface AgentAction {
  type: 'click' | 'type' | 'scroll' | 'select' | 'submit' | 'extract' | 'navigate';
  elementId?: string;       // from accessibility tree
  value?: string;           // for type/select
  expectedOutcome: string;  // what should happen
  intentId: string;         // which planner intent this serves
}
```

The policy selects from visible UI elements — no hallucinated selectors.

### 3.5 Executor — Browser Interaction

Deterministic layer. No LLM reasoning.

- Translates `AgentAction` into Magnitude calls
- `click` → `agent.act("click element X")`
- `type` → `agent.act("type 'value' into element X")`
- `extract` → `agent.extract(prompt, schema)`
- Handles login interception (vault flow)
- Captures result: screenshot, URL change, extracted data

### 3.6 Replanning & Escalation

**Stuck Detection Heuristics** (checked in EVALUATE_PROGRESS):

```
STUCK if:
  (
    repeated_action ≥ 3
    OR same_page ≥ 4
    OR failed_execution ≥ 2
  )
  AND
  no_progress ≥ 5 steps (progress_score = 0)
```

Combined rule avoids false positives (e.g., typing into form fields = same page, not stuck). The `failed_execution` signal catches UI interaction failures where clicks/types have no effect.

**Replan Triggers:**

| Trigger | Detection | Response |
|---------|-----------|----------|
| Stuck (heuristic) | Same action/page/no-change repeated | Replan with context of what failed |
| Intent verification failed | VERIFY_INTENT returned `failed` | Replan with new approach |
| Unexpected state | Page URL not in any known intent path | Replan from current state |
| Skill available | Known skill matches active intent | Skip to skill execution |
| All intents complete | Last intent verified | PLANNER_CONFIRM goal, then done |

**Escalation Policy:**

```
EVALUATE_PROGRESS decision logic:

if progress_detected:
    → continue

elif retry_possible (action failed but intent still viable):
    → retry_action

elif replan_attempts < maxReplanAttempts (default: 3):
    → replan (planner generates new intent list, preserving completed intents)

else:
    → escalate_to_user
```

On escalation, the agent:
1. Pauses execution
2. Broadcasts context to user: what was attempted, where it's stuck, what it needs
3. User can: clarify the goal, perform the step manually, or abort

This prevents infinite loops and runaway token cost.

### 3.7 Step Definitions

**PERCEIVE** — Compressed state snapshot
- Screenshot via Magnitude
- Accessibility tree summary: visible elements, clickable targets, forms, nav structure
- Current URL + page title
- Active intent from planner (description + success criteria)
- Relevant memory: filtered by current domain + intent context
- Output: `Perception { screenshot, uiElements, url, activeIntent, relevantMemory }`

**DECIDE NEXT ACTION** — Structured action selection (horizon = 1)
- LLM receives compressed perception + active intent + step history
- Selects ONE structured action from the visible element tree
- Output: `AgentAction { type, elementId, value?, expectedOutcome, intentId }`

**EXECUTE** — Browser interaction (deterministic)
- Translates AgentAction → Magnitude call
- Login interception if login page detected
- Captures result
- Output: `ExecutionResult { success, data, newUrl, error? }`

**VERIFY_ACTION** — Heuristic-first action outcome check (every step)
- Cheap checks (always): URL changed? DOM changed? Extraction non-empty? Error visible?
- LLM fallback (only on ambiguity): Does result match expected outcome?
- Flags findings when actual ≠ expected
- Output: `ActionVerification { passed, confidence, findings[] }`

**UPDATE_STATE** — Persist discoveries
- Nav graph: new pages, edges, page purposes
- World model: semantic understanding of pages and actions
- Features/flows discovered
- Skills: successful sequences formalized
- Failed paths: avoid repeating
- Output: fire-and-forget writes to Supabase

**EVALUATE_PROGRESS** — Control decision (every step)
- Stuck heuristics: same action repeated? same page? no DOM change?
- Intent progress: has active intent's success criteria been met? → trigger VERIFY_INTENT
- Budget: `steps < max && tokens < max && time < max && cost < max`
- Frontier: unexplored high-priority areas? (for explore tasks)
- Replan limit: `replanAttempts < maxReplanAttempts`
- Output: `'continue' | 'retry_action' | 'replan' | 'done' | 'escalate_to_user'`

**VERIFY_INTENT** — Semantic milestone validation (at intent boundary only)
- Triggered by EVALUATE_PROGRESS when intent appears complete
- LLM checks current page state against intent's `successCriteria`
- Updates intent status to `completed` (confidence ≥ threshold) or `failed`
- If completed → advance to next intent
- If failed → trigger replan
- Output: `IntentVerification { intentId, passed, confidence }`

**PLANNER_CONFIRM** — Goal completion (at task boundary only)
- Triggered when all intents are `completed`
- Planner LLM confirms overall goal was achieved
- If confirmed → task done
- If not → generate new intents for remaining work
- Output: `GoalConfirmation { achieved, remainingWork? }`

---

## 4. World Model & Memory Architecture

### 4.1 Three Memory Layers

| Layer | Scope | Persists across | Resets |
|-------|-------|-----------------|--------|
| **World Model** | Per app (`appId`) | All agents on same app | Never (append-only) |
| **Skill Library** | Per app (`appId`) | All agents on same app | Skills decay if `successRate < 0.7` |
| **Task Memory** | Per task execution | Single task only | On task completion |

### 4.2 World Model (App-Level, Shared)

```typescript
interface WorldModel {
  appId: string;

  pages: PageNode[];       // url, title, purpose, available actions, visited
  edges: PageEdge[];       // from → to, action that caused transition
  elements: UIElement[];   // buttons, forms, links per page
  features: Feature[];     // name, description, criticality, expected behaviors
  flows: Flow[];           // multi-step processes with preconditions

  discoveryStats: {
    pagesDiscovered: number;
    flowsDiscovered: number;
    elementsIndexed: number;
  };
}
```

### 4.3 Skill Library (App-Level, Shared)

```typescript
interface Skill {
  id: string;
  appId: string;
  name: string;              // "login", "create_project", "invite_user"
  intent: string;            // what this skill accomplishes
  steps: AgentAction[];      // the action sequence
  anchors: UIAnchor[];       // structural stability indicators
  preconditions: Condition[]; // state requirements before execution
  successCriteria: string;
  successRate: number;       // decays over time, disabled if < 0.7
  executionCount: number;
  lastUsed: string;
  learnedFrom: 'auto' | 'user';
}

interface UIAnchor {
  type: 'label' | 'role' | 'selector' | 'placeholder';
  value: string;             // e.g., "Create Project" button label
  pageUrl: string;           // where this anchor was observed
}

interface Condition {
  type: 'ui_state' | 'data_state';
  expression: string;        // e.g., "cart_items > 0"
}
```

**Skill learning rules:**
- Auto-create when same sequence succeeds **≥ 3 times** with confidence **≥ 0.9**
- Sequence must be **≥ 2 steps**
- UI anchors must remain stable across executions
- Skills with `successRate < 0.7` are **auto-disabled**
- Users can create, edit, or delete skills manually

**Skill-first decision:** When DECIDE runs, it checks skills BEFORE falling back to primitive actions:

```
DECIDE:
  1. Does a skill match the active intent?
     → YES: execute skill
     → NO: select primitive action from UI tree
```

### 4.4 Task Memory (Session-Level, Ephemeral)

```typescript
interface TaskMemory {
  taskId: string;
  goal: string;
  intents: Intent[];           // from planner
  visitedPages: string[];      // URLs visited this task
  actionsAttempted: AgentAction[];
  failedActions: AgentAction[];
  replanCount: number;
  progressScore: number;
  stuckSignals: StuckSignals;
}

interface StuckSignals {
  repeatedActionCount: number;   // same action consecutively
  samePageCount: number;         // same URL visited
  failedExecutionCount: number;  // actions that failed
  stepsSinceProgress: number;    // steps with progress_score = 0
}
```

### 4.5 Exploration Frontier (Part of World Model)

```typescript
interface FrontierItem {
  id: string;
  pageId: string;           // page where this item was discovered
  targetUrlHash?: string;   // for deduplication — hash of expected target URL
  element: UIElement;       // the actionable element
  action: AgentAction;      // what to do with it
  priority: number;         // computed score
  intentRelevance?: number; // cached 0-1 score, recomputed only on intent change
  discoveredAtStep: number;
  explored: boolean;
  persistent: boolean;      // true for nav items (sidebar, menus) — never expire
  category: 'navigation' | 'form' | 'modal' | 'button' | 'link';
}
```

**Frontier rules:**

- **Expiration (context-based, NOT time-based):**
  - Expire when parent page revisited and element is gone from DOM
  - Expire when parent page is no longer reachable (auth redirect, deleted resource)
  - Expire when explicitly completed (`explored = true`)
  - Items with `persistent: true` (nav items) never expire

- **Deduplication:** Before adding a frontier item, check `targetUrlHash`. If another item points to the same target page, merge (keep higher priority) or skip. Prevents frontier explosion from multiple paths to the same page (e.g., Settings accessible from sidebar AND top menu).

- **Intent relevance caching:** `intentRelevance` is computed once when the item is created (one LLM call per batch of new items). Recomputed only when the planner changes the active intent. NOT recomputed every step.

---

## 5. Exploration Strategy (Frontier-Based)

### 5.1 How Frontier Expands

```
Dashboard (start)
   │
   ├── discover sidebar: [Settings, Projects, Billing]
   │   → frontier: [Settings:5, Projects:4, Billing:3]
   │
   ├── explore Settings
   │   → discover: [Users, API Keys, Security]
   │   → frontier: [Projects:4, Billing:3, Users:3, API Keys:3, Security:3]
   │
   ├── explore Projects
   │   → discover: [Create, Templates]
   │   → frontier: [Billing:3, Users:3, API Keys:3, Security:3, Create:4, Templates:2]
   │
   └── coverage expands outward like a wave
```

### 5.2 Priority Scoring (Intent-Aware)

Frontier selection is guided by BOTH the base score AND the planner's active intent:

```
priority(item) =
    base_score
  + intent_relevance * 4      (how relevant to active intent, rated 0-1)

base_score =
    unseen_page_bonus     * 3  (never visited)
  + form_presence         * 2  (forms indicate flows)
  + modal_trigger         * 2  (modals hide features)
  + new_elements          * 1  (more interactive)
  - visited_penalty       * 2  (avoid re-exploring)
  - depth_penalty         * 1  (breadth first)
  - failure_penalty       * 3  (deprioritize errored)
```

**Example:** Intent is "find webhook configuration." Frontier has `[Settings:5, Projects:4, API Keys:3]`. Pure base score picks Settings. But intent-aware scoring rates API Keys relevance at 0.8 → `3 + 0.8*4 = 6.2` → API Keys wins.

### 5.3 Frontier in the Policy Loop

Frontier selection happens **inside DECIDE**, not as a separate step. This keeps the loop uniform for all task types:

```
DECIDE strategy:
  1. Skill match for active intent?  → execute skill
  2. Explore task?                   → select from frontier (intent-aware scoring)
  3. User task?                      → select action guided by intent + UI state
```

For explore tasks, the LLM chooses from the frontier list rather than the full UI. This reduces hallucinated actions and ensures systematic coverage. For user tasks, the frontier is irrelevant — the intent drives action selection directly.

New frontier items are added in UPDATE_STATE after each action, as the agent discovers new pages and elements.

---

## 6. Budget Control

```typescript
interface AgentBudget {
  maxSteps: number;           // default: 50 (explore), 20 (task)
  maxStepsPerIntent: number;  // default: 20
  maxTokens: number;          // default: 100K
  maxTimeMs: number;          // default: 300_000 (5 min)
  maxCostUsd: number;         // default: 0.50
  maxRetries: number;         // default: 3 per action
  maxReplanAttempts: number;  // default: 3
}
```

EVALUATE_PROGRESS checks budget every iteration. Broadcasts `budget_warning` at 80% usage.

**Worst-case cost scenario (strictly bounded):**

```
Normal run:    10 policy steps + 1 VERIFY_INTENT           = 11 LLM calls
Stuck run:     10 steps + 1 VERIFY_INTENT + 3 replans     = 14 LLM calls → escalate
Max possible:  50 steps + 5 VERIFY_INTENT + 3 replans + 1 PLANNER_CONFIRM = 59 LLM calls
```

---

## 7. How This Replaces Current Code

| Current | New (Three-Layer) |
|---------|-------------------|
| `executeExplore()` — hardcoded sequential loop | Planner generates explore intents → Policy loop with frontier scoring |
| `executeTask()` — single `agent.act(prompt)` | Planner decomposes goal → Policy loop executes intents |
| `handleLoginDetection()` — separate interceptor | EXECUTE step includes login as sub-flow |
| `buildTaskPrompt()` — static prompt template | PERCEIVE builds context from world model + active intent + memory |
| No verification | VERIFY with heuristic-first, LLM-fallback + intent progress tracking |
| No planning | Planner at start + replan on stuck |
| No structured actions | Policy selects from `{ type, elementId }` schema |
| Nav graph (pages + edges) | World model (pages + purposes + actions + skills + frontier) |
| Muscle memory (raw recordings) | Skills (formalized, preconditions, success rates) |

---

## 8. Mastra Integration

```
Mastra Agent
    ├── Tools
    │   ├── magnitude-act        → agent.act(instruction)
    │   ├── magnitude-extract    → agent.extract(prompt, schema)
    │   ├── get-perception       → screenshot + accessibility tree + URL
    │   ├── world-model-read     → load relevant world context
    │   ├── world-model-update   → persist discoveries
    │   ├── frontier-next        → get highest-priority unexplored target
    │   ├── skill-execute        → run a learned skill
    │   ├── vault-login          → credential injection
    │   └── broadcast            → send updates to client via WebSocket
    │
    ├── Workflow: agent-task
    │   ├── plan-strategy (step) — runs at start
    │   ├── policy-loop (step group, repeating)
    │   │   ├── perceive
    │   │   ├── decide-action
    │   │   ├── execute
    │   │   ├── verify-action
    │   │   ├── update-state
    │   │   ├── evaluate-progress
    │   │   └── verify-intent (conditional — at intent boundary)
    │   ├── replan (step) — triggered by evaluate-progress when stuck
    │   └── planner-confirm (step) — triggered when all intents complete
    │
    ├── Memory
    │   ├── World model (Supabase — pages, features, skills, frontier)
    │   ├── Failed paths (avoid repeating)
    │   └── Task history (what was tried this session)
    │
    └── Evals
        ├── exploration-coverage  → % of frontier explored
        ├── feature-discovery     → features found per step
        ├── task-completion       → did user's goal get achieved
        ├── intent-completion     → % of planner intents achieved
        ├── finding-accuracy      → are reported bugs real
        ├── skill-success-rate    → do learned skills work on replay
        └── budget-efficiency     → useful actions / total actions
```

---

## 9. Resolved Questions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Multi-step plan or single action? | **Planner → intents, Policy → single actions** | Planner gives direction, policy adapts to live UI |
| 2 | LLM verification every step? | **Heuristic-first, LLM fallback** | Cheap checks handle 80% of cases |
| 3 | Full DOM in perception? | **Compressed accessibility tree** | Large prompts degrade LLM quality |
| 4 | How to prioritize exploration? | **Weighted frontier scoring** | `goal_progress * 5 > new_page * 3 > form * 2 > element * 1` |
| 5 | Mastra's role? | **Workflow runtime, not core logic** | Architecture works without it |
| 6 | When does planner run? | **At start + when stuck** | Initial decomposition + reactive replanning |
| 7 | Free text or structured actions? | **Structured action space** | `{ type, elementId }` eliminates hallucination |
| 8 | How should skills be learned? | **Hybrid: auto (≥3 successes, ≥0.9 confidence) + user-created** | Filters noise, captures stable patterns |
| 9 | World model shared across agents? | **Yes, per app (`appId`)** | Prevents redundant exploration |
| 10 | Multi-page flow state setup? | **Flow preconditions as state predicates** | `cart_items > 0` → agent resolves via skill |
| 11 | DECIDE separate from PERCEIVE? | **Yes, separate LLM calls** | Different cognitive tasks, combining causes hallucination |
| 12 | Stuck detection threshold? | **Combined rule: (repeated ≥3 OR same_page ≥4 OR failed ≥2) AND no_progress ≥5** | Single signals produce false positives |
| 13 | Skill-first decision? | **DECIDE checks skills before primitive actions** | Prevents re-learning known flows |
| 14 | Skill decay? | **Disable if successRate < 0.7** | Prevents skill drift |
| 15 | Perception caching? | **Cache only when VERIFY_ACTION confirms no DOM change** | Saves cost without stale state risk |
| 16 | Frontier expiration? | **Context-based (element gone, page unreachable), NOT time-based** | Step TTL incorrectly expires deep pages |
| 17 | Frontier deduplication? | **Dedupe by target URL hash, merge duplicates** | Prevents frontier explosion |
| 18 | Intent relevance cost? | **Cache on creation, recompute only on intent change** | One LLM call per batch, not per step |
| 19 | Frontier selection: separate step? | **No — inside DECIDE as a strategy** | Keeps loop uniform for explore + task |
| 20 | Exploration budget allocation? | **Deferred to post-MVP** | `maxStepsPerIntent` provides rough allocation |

---

## 10. Future Enhancements (Post-MVP)

- **UI State Abstraction (v2 — high priority)** — Replace page-level tracking with state-level tracking. A "state" = page + active tab + modal + visible actions, hashed into a signature. Enables: loop detection on tab-heavy SPAs, state-aware skill triggers, state transition graphs instead of page graphs. Add when evals show revisit/loop problems. Architecture is additive: `WorldModel.pages` → `WorldModel.states`, `PageEdge` → `StateEdge`.
- **Exploration budget allocation** — split step budget per intent (`intent_budget: 40, exploration_budget: 60`) for finer control
- **Frontier categories** — weight `workflow > modal > navigation > minor action` for priority scoring
- **Cross-app skill portability** — skills learned on App A applied to similar App B via `app_fingerprint` matching
- **Parallel frontier exploration** — multiple Magnitude agents exploring different frontier branches simultaneously
- **State similarity** — deduplicate near-identical states (e.g., paginated lists) with similarity threshold ≥ 0.9

---

## 11. Implementation Plan

_To be written next._
