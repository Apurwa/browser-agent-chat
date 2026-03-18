# Agent Test Plan — Comprehensive Spec

## Overview

A 5-layer test strategy covering the entire agent stack: pure function unit tests, Mastra step integration tests, workflow E2E tests with mock agents, E2E against a local test app with real browsers, and smoke tests against real production sites.

## Problem

The agent has 566 tests but significant gaps: `verifyAction`, `verifyIntent`, `plannerConfirm`, `budget.ts` have zero unit tests. The Mastra workflow has only single-shot E2E coverage. There are no tests with a real browser against a controlled app. Real-site testing is ad-hoc.

## Test Layers

### Layer 1: Unit Tests — Pure Functions

Test all decision modules in isolation with no I/O, no mocks, no browser.

| Module | File | Tests Needed |
|--------|------|-------------|
| `verify-action.ts` | `__tests__/verify-action.test.ts` | URL change → confidence boost. Data extracted → confidence boost. Error present → passed=false. No change → baseline confidence. |
| `verify-intent.ts` | `__tests__/verify-intent.test.ts` | Success criteria keyword match → passed. No match → not passed. Fuzzy partial match. Empty criteria. |
| `planner-confirm.ts` | `__tests__/planner-confirm.test.ts` | All intents completed → achieved. Task mode: partial → not achieved. Explore mode: ≥1 completed → achieved. Zero intents. |
| `budget.ts` | `__tests__/budget.test.ts` | Exhaustion by steps. Exhaustion by time. `canReplan()` limits. `snapshot()` shape. `warning()` at 80%. |
| `getCurrentIntent` | `__tests__/agent-loop-helpers.test.ts` | First active. Fallback to first pending. All completed → null. Empty array → null. |
| `advanceIntent` | same file | Marks active as completed. Activates next pending. Returns new array (no mutation). Single intent. All already completed. |
| `checkHeuristicOverride` | same file | Fires at threshold (3 repeated + 3 steps). Returns null below threshold. No nav elements → null. |
| `evaluateProgress` | extend existing | Exact boundary: 3 repeated actions. Exact boundary: 4 same-page. Budget exhausted → 'done'. |
| `updateTaskMemory` | extend existing | Max action history. Duplicate visited URLs not re-added. |

**Execution:** `npx vitest run` — all unit tests run in < 1 second, no setup needed.

### Layer 2: Mastra Step Integration Tests — Mock Sessions

Test each Mastra step with a mock `SessionContext` registered in the registry. The mock provides fake Playwright page and Magnitude agent objects via `vi.fn()`.

| Step | Scenarios |
|------|-----------|
| `agentCycleStep` | **Happy path:** mock perceive returns elements, mock decide returns click, mock execute succeeds, verify passes → returns `taskComplete: false`. **Browser death:** `page.evaluate` throws "Target page closed" → returns `escalated: true`. **Login detected:** mock `detectLoginPage` returns true → calls `suspend()`. **Replan:** evaluateProgress returns 'replan' → planStrategy called with new intents. **All 5 decisions:** test continue (intent completion), retry_action, replan, done, escalate_to_user. |
| `planStrategyStep` | **Happy path:** mock planStrategy returns 3 intents → output has intents + taskMemory. **LLM failure:** planStrategy throws → fallback single-intent plan. |
| `initializeStep` | **Happy path:** loginDone resolves, page.evaluate returns URL. **loginDone timeout:** Promise hangs > 30s → should still proceed (or timeout). **page.evaluate fails:** returns fallback URL. |
| `executeSingleShotStep` | **Happy path:** agent.act succeeds → success: true. **Failure:** agent.act throws → error broadcast. |
| `confirmGoalStep` | **Task mode:** all intents completed → success. Partial → failure. **Explore mode:** ≥1 completed → success. |
| `cleanupStep` | Broadcasts taskComplete + idle. success=false propagates correctly. |

**Mocking strategy:** Each test registers a mock session with `vi.fn()` for all methods. After each test, verify which mocks were called and with what arguments. Clean up with `removeSession()` in `afterEach`.

**Execution:** `npx vitest run` — runs in < 5 seconds with mocked I/O.

### Layer 3: Mastra Workflow E2E Tests — Mock Agent, Real Orchestration

Test the full workflow chain (`.then()`, `.dountil()`, `.commit()`) with the real Mastra runtime but mocked session objects. Validates the workflow orchestration layer.

| Scenario | Setup | Assertion |
|----------|-------|-----------|
| **Multi-step happy path** | Mock: perceive returns 3 elements, policy returns click, execute succeeds, verify passes. After 3 iterations, intent verification passes. | Workflow status = 'success'. `broadcast` called with 'taskComplete'. Budget shows 3 steps used. |
| **Multi-step replan** | Mock: execute fails 5x (stuck), evaluateProgress returns 'replan'. After replan, succeed on next iteration. | Workflow completes. `planStrategy` called twice (initial + replan). |
| **Budget exhaustion** | Mock: every action succeeds but intents never complete. Budget maxSteps = 5. | Workflow exits after 5 iterations. `confirmGoal` reports `success: false`. |
| **Browser death mid-loop** | Mock: `page.evaluate` succeeds for 2 iterations, then throws "Target page closed" on iteration 3. | Workflow exits with `escalated: true`. `broadcast` called with error. No crash/hang. |
| **Credential suspension** | Mock: `detectLoginPage` returns true on iteration 2. Workflow suspends. Resume with credentialId. | Workflow status changes: running → suspended → running → success. Credential injected between suspend and resume. |
| **Single-shot success** | Mock: `agent.act()` resolves. | Workflow status = 'success'. Steps: initialize → execute → cleanup. |
| **Single-shot failure** | Mock: `agent.act()` throws. | Workflow handles error. `broadcast` called with error message. |

**Execution:** `npx vitest run` — runs in < 10 seconds. Requires `InMemoryStore` for suspend tests.

### Layer 4: E2E Against Local Test App — Real Browser

A minimal Express app that simulates common web patterns. Runs in the test process.

#### Test App (`server/__tests__/fixtures/test-app.ts`)

```
Routes:
  GET  /                  → redirect to /login
  GET  /login             → login form (username + password)
  POST /login             → validate, set cookie, redirect to /dashboard
  GET  /dashboard         → nav links + summary cards
  GET  /settings          → form with text inputs, dropdowns, checkbox
  POST /settings          → save and show success message
  GET  /users             → table with 5 users, pagination
  GET  /users/:id         → user detail page
  GET  /404-page          → returns 404
```

All pages share a minimal HTML layout with semantic elements (buttons, links, inputs with labels) so the agent's DOM scanner can find them.

#### Test Cases

| Test | Agent Command | Assertion | Timeout |
|------|--------------|-----------|---------|
| **Navigate** | "Go to the settings page" | URL ends with `/settings` | 30s |
| **Fill form** | "Change the display name to TestUser" | Input value = "TestUser" after action | 30s |
| **Extract data** | "List all users on the page" | Returns array with ≥ 3 names | 30s |
| **Login** | "Log in with admin/password123" | Cookie set, redirected to `/dashboard` | 45s |
| **Handle error** | "Go to the reports page" (doesn't exist) | Agent reports it can't find reports, doesn't hang | 30s |
| **Multi-step explore** | "Explore the app and describe what you find" | Agent visits ≥ 2 pages, returns descriptions | 60s |

#### Setup / Teardown

```ts
let server: Server
let baseUrl: string

beforeAll(async () => {
  // Start test app on random port
  server = createTestApp().listen(0)
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://localhost:${port}`
})

afterAll(async () => {
  server.close()
})
```

Each test creates a fresh Magnitude agent pointed at `baseUrl`, runs the task, then stops the agent.

**Execution:** `npx vitest run __tests__/e2e-local/` — runs in CI. Each test takes 15-60 seconds (real browser + LLM calls). Total: ~5 minutes for the suite.

**CI considerations:** Requires Chromium (Playwright install) and `ANTHROPIC_API_KEY` env var. Tests are tagged with `@e2e` so they can be run separately from unit tests.

### Layer 5: Smoke Tests Against Real Sites

Manual or scheduled tests against real production sites. NOT in CI — too flaky, too slow, rate-limited.

| Site | Task | Success Criteria | Notes |
|------|------|-----------------|-------|
| Langfuse (local instance) | "Go to traces and list the last 3 trace names" | Returns array with ≥ 1 trace name | Requires local Langfuse running |
| Hacker News | "What is the #1 story on the front page?" | Returns a non-empty title string | Public, stable DOM |
| GitHub | "Go to the issues page of Apurwa/browser-agent-chat" | URL contains `/issues` | Requires no auth for public repos |
| Wikipedia | "What is the first paragraph about TypeScript?" | Returns text containing "programming language" | Public, stable |

#### Execution

```bash
# Manual run:
SMOKE_TEST=true npx vitest run __tests__/e2e-smoke/

# Scheduled (cron or CI on schedule):
# Runs weekly, alerts on failure, does NOT block releases
```

Tests use `test.skipIf(!process.env.SMOKE_TEST)` to avoid running in normal CI.

**Flakiness handling:** Each test retries 2x with 5s delay between retries. Timeout per test: 90s. Failures are logged but don't block deployment.

## File Structure

```
server/__tests__/
├── verify-action.test.ts           # Layer 1
├── verify-intent.test.ts           # Layer 1
├── planner-confirm.test.ts         # Layer 1
├── budget.test.ts                  # Layer 1
├── agent-loop-helpers.test.ts      # Layer 1
├── evaluate-progress-pure.test.ts  # Layer 1 (exists, extend)
├── mastra-steps-integration.test.ts # Layer 2 (exists, extend)
├── mastra-workflow-e2e.test.ts     # Layer 3 (exists, extend)
├── fixtures/
│   └── test-app.ts                 # Layer 4 test app
├── e2e-local/
│   ├── navigate.test.ts            # Layer 4
│   ├── form-fill.test.ts           # Layer 4
│   ├── extract-data.test.ts        # Layer 4
│   ├── login-flow.test.ts          # Layer 4
│   ├── error-handling.test.ts      # Layer 4
│   └── explore.test.ts             # Layer 4
└── e2e-smoke/
    ├── langfuse.test.ts            # Layer 5
    ├── hackernews.test.ts          # Layer 5
    ├── github.test.ts              # Layer 5
    └── wikipedia.test.ts           # Layer 5
```

## Test Execution Summary

| Layer | Location | Runs In | Time | Requires |
|-------|----------|---------|------|----------|
| 1. Unit | `__tests__/*.test.ts` | CI (every push) | < 1s | Nothing |
| 2. Step Integration | `__tests__/mastra-steps-*.test.ts` | CI (every push) | < 5s | Nothing |
| 3. Workflow E2E | `__tests__/mastra-workflow-*.test.ts` | CI (every push) | < 10s | InMemoryStore |
| 4. Local E2E | `__tests__/e2e-local/` | CI (every push) | ~5 min | Chromium + ANTHROPIC_API_KEY |
| 5. Real Site Smoke | `__tests__/e2e-smoke/` | Weekly schedule | ~5 min | Chromium + ANTHROPIC_API_KEY + SMOKE_TEST=true |

## Test Count Targets

| Layer | Current | Target |
|-------|---------|--------|
| 1. Unit | ~25 | ~70 |
| 2. Step Integration | 11 | ~35 |
| 3. Workflow E2E | 6 | ~15 |
| 4. Local E2E | 0 | ~6 |
| 5. Smoke | 0 | ~4 |
| **Total** | **~42** | **~130** |

## Priority Order

1. **Layer 1 first** — fills the biggest gap (zero tests for 5 modules), fastest to write, no infrastructure
2. **Layer 2 next** — validates Mastra steps work correctly before wiring into production
3. **Layer 3 next** — validates workflow orchestration (critical for Mastra Phase 2 verification)
4. **Layer 4 after** — requires building the test app fixture, but gives the highest confidence
5. **Layer 5 last** — nice-to-have, periodic validation

## Out of Scope

- Performance/load testing (how many concurrent agents can run)
- Visual regression testing (screenshot comparison)
- Security testing (credential leaks, XSS in chat)
- Client-side component tests (React testing library)
