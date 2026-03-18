import type { AgentSession } from './agent.js';
import type { ServerMessage } from './types.js';
import type { TaskMemory, Intent, AgentAction, Perception, UIElement } from './agent-types.js';
import { planStrategy } from './planner.js';
import { perceive } from './perception.js';
import { decideNextAction, categorizeElements } from './policy.js';
import type { ProgressContext } from './policy.js';
import { executeAction } from './executor.js';
import { verifyAction } from './verify-action.js';
import { verifyIntent } from './verify-intent.js';
import { evaluateProgress } from './evaluate-progress.js';
import { confirmGoalCompletion } from './planner-confirm.js';
import { createBudgetTracker } from './budget.js';
import { getWorldContext } from './world-model.js';
import { findSkillForIntent } from './skills.js';
import { recordNavigation } from './nav-graph.js';
import { createTaskTrace, classifyError } from './trace-helpers.js';
import { getLangfuse } from './langfuse.js';

// ---------------------------------------------------------------------------
// Exported pure helpers
// ---------------------------------------------------------------------------

/**
 * Get the current intent: first 'active', falling back to first 'pending'.
 * Returns null if no active or pending intents exist.
 */
export function getCurrentIntent(intents: ReadonlyArray<Intent>): Intent | null {
  const active = intents.find(i => i.status === 'active');
  if (active) return active;
  return intents.find(i => i.status === 'pending') ?? null;
}

/**
 * Advance intents: mark the current active intent as 'completed' and
 * activate the next pending intent. Returns a new array — does NOT mutate.
 *
 * If there is no active intent, the input array is returned unchanged.
 */
export function advanceIntent(intents: ReadonlyArray<Intent>): Intent[] {
  const activeIdx = intents.findIndex(i => i.status === 'active');
  if (activeIdx === -1) return [...intents];

  const completed = intents.map((intent, idx) => {
    if (idx === activeIdx) {
      return {
        ...intent,
        status: 'completed' as const,
        confidence: Math.max(intent.confidence, 0.7),
      };
    }
    return intent;
  });

  // Find the first pending and activate it
  const nextPendingIdx = completed.findIndex(i => i.status === 'pending');
  if (nextPendingIdx === -1) return completed;

  return completed.map((intent, idx) =>
    idx === nextPendingIdx
      ? { ...intent, status: 'active' as const }
      : intent,
  );
}

/**
 * Heuristic override: when the agent has repeated the same action type 3+
 * times in a row with no progress, force a click on the first unexplored
 * navigation element.
 *
 * Returns an action override or null if no override is needed.
 */
export function checkHeuristicOverride(
  taskMemory: Readonly<TaskMemory>,
  perception: Readonly<Perception>,
  clickedElementIds: ReadonlySet<string>,
): { action: AgentAction } | null {
  const last3 = taskMemory.actionsAttempted.slice(-3);
  if (last3.length < 3) return null;

  const allSameType = last3.every(a => a.type === last3[0].type);
  const noProgress = taskMemory.stuckSignals.stepsSinceProgress >= 3;

  if (!allSameType || !noProgress) return null;

  const unexplored = categorizeElements(perception.uiElements, clickedElementIds as Set<string>);
  const firstUnexploredNav = unexplored.navigation[0];
  if (!firstUnexploredNav) return null;

  const activeIntent = getCurrentIntent(taskMemory.intents);

  return {
    action: {
      type: 'click',
      elementId: firstUnexploredNav.id,
      expectedOutcome: `Navigate to ${firstUnexploredNav.label} to discover new features`,
      intentId: activeIntent?.id ?? 'unknown',
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * Get the live URL from the page via JS evaluation, with fallback to page.url().
 * Uses `any` to avoid conflicts between the Playwright Page overloads and the
 * narrower structural types used by perception/executor modules.
 */
async function getPageUrl(page: any): Promise<string> {
  try {
    return (await page.evaluate('location.href')) as string;
  } catch {
    return page.url() as string;
  }
}

/**
 * Return a new intents array with the given intent set to 'active'.
 */
function activateIntent(intents: Intent[], intentId: string): Intent[] {
  return intents.map(intent =>
    intent.id === intentId
      ? { ...intent, status: 'active' as const }
      : intent
  );
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function executeAgentLoop(
  session: AgentSession,
  goal: string,
  taskType: 'task' | 'explore',
  broadcast: (msg: ServerMessage) => void,
): Promise<{ success: boolean; stepsCompleted: number }> {
  const maxSteps = taskType === 'explore' ? 50 : 20;
  const budget = createBudgetTracker({ maxSteps });

  // Reuse caller's trace (from dispatchTask/dispatchExplore) or create a new one
  const trace = session.currentTrace ?? createTaskTrace(goal, taskType, session.agentId, session.sessionId);

  try {
    // 1. Load world context
    const worldContext = session.agentId
      ? await getWorldContext(session.agentId)
      : '';

    // 2. Get current URL
    const page = session.connector.getHarness().page;
    const startUrl = await getPageUrl(page);

    // 3. Plan strategy
    broadcast({ type: 'thought', content: 'Planning strategy...' });
    const maxIntents = Math.min(7, Math.floor(maxSteps / 3));

    const plannerGen = trace?.generation({
      name: 'planner',
      input: { goal, worldContext: worldContext || null, currentUrl: startUrl, maxIntents },
    });

    const { plan, prompt: plannerPrompt } = await planStrategy(
      session.agent,
      goal,
      worldContext,
      startUrl,
      maxIntents,
    );

    plannerGen?.end({
      output: plan,
      metadata: { intentCount: plan.intents.length, prompt: plannerPrompt },
    });

    broadcast({
      type: 'thought',
      content: `Strategy planned: ${plan.intents.length} intent(s)`,
    });

    // 4. Initialize TaskMemory
    let taskMemory: TaskMemory = {
      taskId: crypto.randomUUID(),
      goal,
      intents: plan.intents,
      visitedPages: startUrl ? [startUrl] : [],
      actionsAttempted: [],
      failedActions: [],
      replanCount: 0,
      progressScore: 0,
      stuckSignals: {
        repeatedActionCount: 0,
        samePageCount: 0,
        failedExecutionCount: 0,
        stepsSinceProgress: 0,
      },
    };

    // 5. Activate first pending intent
    const firstPending = taskMemory.intents.find(i => i.status === 'pending');
    if (firstPending) {
      taskMemory = {
        ...taskMemory,
        intents: activateIntent(taskMemory.intents, firstPending.id),
      };
    }

    // 6. Policy loop — state tracking for progress signal
    const extractedPages = new Set<string>();
    const clickedElementIds = new Set<string>();
    let lastProgressDelta = 0;
    let lastExtractedItemCount = 0;
    let stepNum = 0;

    // Track per-intent Langfuse spans
    let intentSpan: any = null;
    const activeIntentForSpan = getCurrentIntent(taskMemory.intents);
    if (activeIntentForSpan && trace) {
      intentSpan = trace.span({ name: `intent-${activeIntentForSpan.id}`, input: { description: activeIntentForSpan.description, successCriteria: activeIntentForSpan.successCriteria } });
    }

    while (!budget.exhausted()) {
      stepNum += 1;
      const currentPage = session.connector.getHarness().page;
      const urlBefore = await getPageUrl(currentPage);

      // a. Perceive current state
      const activeIntent = getCurrentIntent(taskMemory.intents);

      const percSpan = trace?.span({
        name: `perception-${stepNum}`,
        input: { url: urlBefore, activeIntent: activeIntent?.description ?? null },
      });

      const perception = await perceive(currentPage as any, activeIntent, '');

      const ctx2 = categorizeElements(perception.uiElements, clickedElementIds);
      percSpan?.end({
        output: {
          elementCount: perception.uiElements.length,
          pageTitle: perception.pageTitle,
          categories: {
            nav: ctx2.navigation.length,
            actions: ctx2.actions.length,
          },
        },
        metadata: { pageAlreadyExtracted: extractedPages.has(urlBefore) },
      });

      // b. Check for matching skill (MVP: log only, skip execution)
      if (session.agentId && activeIntent) {
        try {
          const skill = await findSkillForIntent(session.agentId, activeIntent.description);
          if (skill) {
            broadcast({
              type: 'thought',
              content: `Skill match found: "${skill.name}" (${skill.steps.length} steps, ${Math.round(skill.successRate * 100)}% success rate)`,
            });
            // MVP: skill execution not yet wired — fall through to policy
          }
        } catch {
          // Skills lookup failure is non-fatal
        }
      }

      // c. Compute progress context for policy
      const progressContext: ProgressContext = {
        pageAlreadyExtracted: extractedPages.has(urlBefore),
        progressDelta: lastProgressDelta,
        urlChanged: false, // will be set after looking at recent history
        visitedUrls: [...taskMemory.visitedPages],
        unexplored: categorizeElements(perception.uiElements, clickedElementIds),
      };

      // Check if last action changed URL
      if (taskMemory.actionsAttempted.length > 0) {
        const prevUrl = taskMemory.visitedPages[taskMemory.visitedPages.length - 2];
        progressContext.urlChanged = prevUrl !== urlBefore;
      }

      // c2. Heuristic override via extracted pure function
      const heuristicResult = checkHeuristicOverride(taskMemory, perception, clickedElementIds);

      let action: AgentAction;
      let heuristicOverride = false;

      if (heuristicResult) {
        const last3 = taskMemory.actionsAttempted.slice(-3);
        console.log(`[POLICY] Heuristic override: forcing click on "${heuristicResult.action.elementId}" after 3 repeated ${last3[0]?.type ?? 'unknown'} actions`);
        broadcast({ type: 'thought', content: `Switching strategy: clicking "${heuristicResult.action.elementId}"` });
        action = heuristicResult.action;
        heuristicOverride = true;
      } else {
        // d. Normal policy decision
        const policyGen = trace?.generation({
          name: `policy-${stepNum}`,
          input: { activeIntent: activeIntent?.description ?? null },
          metadata: { stepNum },
        });

        const { action: decidedAction, prompt: policyPrompt } = await decideNextAction(
          session.agent,
          perception,
          taskMemory.actionsAttempted.slice(-5),
          progressContext,
        );

        policyGen?.end({
          output: decidedAction,
          metadata: {
            prompt: policyPrompt,
            heuristicOverride: false,
            progressDelta: progressContext.progressDelta,
          },
        });

        action = decidedAction;
      }

      broadcast({
        type: 'action',
        action: action.type,
        target: action.elementId,
      });

      // d. Execute action
      const execSpan = trace?.span({
        name: `execute-${stepNum}`,
        input: {
          actionType: action.type,
          elementId: action.elementId ?? null,
          instruction: action.expectedOutcome,
        },
        metadata: { containsLlm: true },
      });

      const result = await executeAction(
        session.agent as any,
        currentPage as any,
        action,
        perception.uiElements,
      );

      // e. Get URL after action
      const urlAfter = await getPageUrl(currentPage);

      if (result.error) {
        execSpan?.end({
          output: result,
          metadata: {
            failure: {
              errorType: classifyError(result.error),
              errorMessage: result.error,
            },
          },
          level: 'ERROR',
        });
      } else {
        execSpan?.end({
          output: { success: result.success, urlChanged: urlBefore !== urlAfter },
        });
      }

      // f. Log action errors for debugging
      if (result.error) {
        console.error(`[AGENT-LOOP] Action ${action.type} failed:`, result.error);
        broadcast({ type: 'thought', content: `Action failed: ${result.error}` });
      }

      // g. Track progress for next iteration's policy context
      if (action.type === 'extract' && result.success) {
        extractedPages.add(urlBefore);
        // Compute progress delta from extracted data
        const extractedItems = Array.isArray((result.data as any)?.items) ? (result.data as any).items.length : 0;
        lastProgressDelta = Math.max(0, extractedItems - lastExtractedItemCount);
        lastExtractedItemCount = extractedItems;
      } else if (action.type === 'click' && action.elementId) {
        clickedElementIds.add(action.elementId);
        lastProgressDelta = urlBefore !== urlAfter ? 1 : 0;
      } else {
        lastProgressDelta = urlBefore !== urlAfter ? 1 : 0;
      }

      // h. Verify action
      const verifySpan = trace?.span({
        name: `verify-${stepNum}`,
        input: { actionType: action.type, urlBefore, urlAfter },
      });

      const verification = verifyAction(action, result, urlBefore, urlAfter);

      verifySpan?.end({
        output: { passed: verification.passed, confidence: verification.confidence },
        level: verification.passed ? 'DEFAULT' : 'WARNING',
      });

      // g. Update task memory (immutable update)
      const updatedActions = [...taskMemory.actionsAttempted, action];
      const updatedFailed = verification.passed
        ? taskMemory.failedActions
        : [...taskMemory.failedActions, action];

      const updatedPages =
        urlAfter && !taskMemory.visitedPages.includes(urlAfter)
          ? [...taskMemory.visitedPages, urlAfter]
          : taskMemory.visitedPages;

      taskMemory = {
        ...taskMemory,
        actionsAttempted: updatedActions,
        failedActions: updatedFailed,
        visitedPages: updatedPages,
      };

      // h. Record step in budget
      budget.recordStep();

      // i. Record navigation if URL changed
      if (urlAfter && urlAfter !== urlBefore && !urlAfter.startsWith('about:')) {
        broadcast({ type: 'nav', url: urlAfter });
        if (session.agentId) {
          let pageTitle = '';
          try {
            pageTitle = await currentPage.title();
          } catch {
            // non-fatal
          }
          recordNavigation(
            session.agentId,
            urlBefore,
            urlAfter,
            action.type,
            undefined,
            pageTitle,
            action.elementId,
          ).catch((err: unknown) => {
            console.error('[AGENT-LOOP] recordNavigation failed:', err);
          });
        }
      }

      // j. Evaluate progress (pure — does not mutate taskMemory)
      const { decision, reason, signals } = evaluateProgress(
        taskMemory,
        budget,
        verification,
        urlBefore,
        urlAfter,
      );

      // Apply the updated stuck signals immutably
      taskMemory = { ...taskMemory, stuckSignals: signals };

      broadcast({ type: 'thought', content: reason });

      // k. Handle decision
      if (decision === 'continue') {
        // Check if active intent is complete
        if (activeIntent) {
          const intentVerification = await verifyIntent(
            activeIntent,
            urlAfter || urlBefore,
            perception.pageTitle,
          );

          if (intentVerification.passed) {
            // Close current intent span
            intentSpan?.end({ output: { passed: true, confidence: intentVerification.confidence, stepsInIntent: stepNum } });

            broadcast({
              type: 'thought',
              content: `Intent "${activeIntent.description}" completed`,
            });

            // Use advanceIntent to mark current as completed and activate next
            const advancedIntents = advanceIntent(taskMemory.intents);
            const nextActive = getCurrentIntent(advancedIntents);

            taskMemory = {
              ...taskMemory,
              intents: advancedIntents,
              stuckSignals: {
                repeatedActionCount: 0,
                samePageCount: 0,
                failedExecutionCount: 0,
                stepsSinceProgress: 0,
              },
            };

            if (!nextActive || nextActive.status === 'completed') {
              intentSpan = null;
              broadcast({ type: 'thought', content: 'All intents completed' });
              break;
            }

            // Open span for next intent
            intentSpan = trace?.span({ name: `intent-${nextActive.id}`, input: { description: nextActive.description, successCriteria: nextActive.successCriteria } }) ?? null;

            broadcast({
              type: 'thought',
              content: `Moving to next intent: "${nextActive.description}"`,
            });
          }
        }
      } else if (decision === 'replan') {
        broadcast({ type: 'thought', content: `Replanning: ${reason}` });

        if (budget.canReplan()) {
          budget.recordReplan();
          taskMemory = { ...taskMemory, replanCount: taskMemory.replanCount + 1 };

          try {
            const currentUrl = await getPageUrl(currentPage);

            const replanGen = trace?.generation({
              name: `replan-${taskMemory.replanCount}`,
              input: { goal, currentUrl, replanCount: taskMemory.replanCount },
            });

            const { plan: replan, prompt: replanPrompt } = await planStrategy(
              session.agent,
              goal,
              worldContext,
              currentUrl,
            );

            replanGen?.end({
              output: replan,
              metadata: { intentCount: replan.intents.length, prompt: replanPrompt },
            });

            taskMemory = {
              ...taskMemory,
              intents: replan.intents,
            };

            const firstNext = taskMemory.intents.find(i => i.status === 'pending');
            if (firstNext) {
              taskMemory = {
                ...taskMemory,
                intents: activateIntent(taskMemory.intents, firstNext.id),
              };
            }

            broadcast({
              type: 'thought',
              content: `Replanned with ${replan.intents.length} intent(s)`,
            });
          } catch (replanErr) {
            console.error('[AGENT-LOOP] Replan failed:', replanErr);
            broadcast({
              type: 'thought',
              content: 'Replan failed, continuing with current plan',
            });
          }
        }
      } else if (decision === 'retry_action') {
        // Loop continues naturally — will re-perceive and pick next action
        continue;
      } else if (decision === 'done') {
        break;
      } else if (decision === 'escalate_to_user') {
        broadcast({
          type: 'error',
          message: `Agent requires assistance: ${reason}`,
        });
        break;
      }
    }

    // Close any open intent span (loop ended without completing all intents)
    if (intentSpan) {
      const lastIntent = getCurrentIntent(taskMemory.intents);
      intentSpan.end({ output: { passed: false, reason: 'loop ended', intent: lastIntent?.description ?? 'unknown' } });
      intentSpan = null;
    }

    // 7. Confirm goal completion
    const confirmation = confirmGoalCompletion(goal, taskMemory.intents, taskType, taskMemory.visitedPages.length);
    const stepsCompleted = budget.snapshot().stepsUsed;

    trace?.update({
      output: {
        success: confirmation.achieved,
        stepsCompleted,
        pagesVisited: taskMemory.visitedPages.length,
        remainingWork: confirmation.remainingWork ?? null,
      },
    });
    getLangfuse()?.flushAsync().catch(() => {});

    broadcast({ type: 'taskComplete', success: confirmation.achieved });

    if (!confirmation.achieved && confirmation.remainingWork) {
      broadcast({
        type: 'thought',
        content: `Incomplete: ${confirmation.remainingWork}`,
      });
    }

    return { success: confirmation.achieved, stepsCompleted };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent loop failed';
    console.error('[AGENT-LOOP] Fatal error:', err);

    trace?.update({
      output: { success: false, error: message },
      metadata: { fatalError: true },
    });
    getLangfuse()?.flushAsync().catch(() => {});

    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
    return { success: false, stepsCompleted: budget.snapshot().stepsUsed };
  }
}
