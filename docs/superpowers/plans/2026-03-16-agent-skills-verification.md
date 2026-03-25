# Agent Architecture — Plan 4: Skills & Verification

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Implement skill library (learn, match, execute reusable patterns), action-level verification (heuristic-first), intent-level verification (LLM), and EVALUATE_PROGRESS with stuck detection.

**Architecture:** Skills extend existing learned_patterns with anchors and preconditions. Verification is two-level: cheap heuristics every step, LLM only at intent boundaries. EVALUATE_PROGRESS controls the loop.

**Tech Stack:** Supabase (existing learned_patterns table), Zod types from Plan 1, existing muscle-memory.ts as foundation

---

### Task 1: Skill Library

**Files:**
- Create: `server/src/skills.ts`
- Test: `server/__tests__/skills.test.ts`

Functions:
- `findSkillForIntent(agentId, intent: Intent)` → match skills by intent description similarity (string matching first, LLM fallback later). Returns Skill | null.
- `executeSkill(page, skill: Skill)` → replay skill steps via Playwright (similar to existing replayLogin). Returns ExecutionResult.
- `recordSkillCandidate(agentId, intent, steps, anchors)` → save to learned_patterns with pattern_type='task', pattern_state='candidate'
- `promoteSkill(patternId)` → if same sequence succeeds ≥3 times with confidence ≥0.9, promote to 'active'
- `decaySkill(patternId)` → if successRate < 0.7, set pattern_state='stale'
- `listSkills(agentId)` → active skills for the agent

Reuses existing learned_patterns table with new columns (intent, anchors, preconditions, success_criteria, learned_from).

Test: mock Supabase, verify skill matching, recording, promotion/decay logic.

### Task 2: VERIFY_ACTION (heuristic-first)

**Files:**
- Create: `server/src/verify-action.ts`
- Modify: `server/src/mastra/workflows/agent-task.ts` (verifyActionStep.execute)
- Test: `server/__tests__/verify-action.test.ts`

Heuristic checks (cheap, every step):
1. URL changed from before action? → action had navigation effect
2. DOM element count changed? → page content changed
3. Extraction returned non-empty data? → extraction succeeded
4. Error message visible on page? → action may have failed

If all heuristics pass → return { passed: true, confidence: 0.8 }
If any heuristic is ambiguous → LLM fallback (compare expected outcome vs actual)
If error visible → return { passed: false } with finding

Output: ActionVerification { passed, confidence, findings[] }

Test: mock page state, verify each heuristic independently.

### Task 3: VERIFY_INTENT (LLM at intent boundary)

**Files:**
- Create: `server/src/verify-intent.ts`
- Test: `server/__tests__/verify-intent.test.ts`

Called when EVALUATE_PROGRESS detects an intent may be complete.
Takes current page screenshot + intent's successCriteria.
Calls LLM: "Does the current page state satisfy this criteria: {successCriteria}? Answer yes/no with confidence 0-1."
Updates intent status to 'completed' or 'failed'.

Output: IntentVerification { intentId, passed, confidence }

Test: mock LLM response, verify intent status update.

### Task 4: EVALUATE_PROGRESS + Stuck Detection

**Files:**
- Create: `server/src/evaluate-progress.ts`
- Test: `server/__tests__/evaluate-progress.test.ts`

Takes: TaskMemory, BudgetTracker, current ExecutionResult, current ActionVerification.

Logic:
```
1. Update stuck signals (repeatedAction, samePage, failedExecution, stepsSinceProgress)
2. Compute progress score (new_page * 3 + new_elements * 1 + flow_step * 2 + goal * 5)
3. Check budget exhausted → 'done'
4. Check intent complete (successCriteria met) → trigger VERIFY_INTENT
5. Check progress detected → 'continue'
6. Check retry possible → 'retry_action'
7. Check stuck: (repeated ≥3 OR same_page ≥4 OR failed ≥2) AND no_progress ≥5
8. Check replan limit → 'replan' or 'escalate_to_user'
```

Output: EvaluateProgressDecision

Test: verify each decision path with specific TaskMemory states.

### Task 5: PLANNER_CONFIRM (goal completion)

**Files:**
- Create: `server/src/planner-confirm.ts`
- Test: `server/__tests__/planner-confirm.test.ts`

Called when all intents are 'completed'.
Takes: original goal + list of completed intents + current page state.
Calls LLM: "The goal was '{goal}'. These milestones were achieved: {intents}. Is the goal fully complete?"
Returns GoalConfirmation { achieved, remainingWork? }

Test: mock LLM, verify confirmation logic.
