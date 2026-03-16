import type { AgentSession } from './agent.js';
import type { ServerMessage } from './types.js';
import type { TaskMemory, Intent, AgentAction } from './agent-types.js';
import { planStrategy } from './planner.js';
import { perceive } from './perception.js';
import { decideNextAction } from './policy.js';
import { executeAction } from './executor.js';
import { verifyAction } from './verify-action.js';
import { verifyIntent } from './verify-intent.js';
import { evaluateProgress } from './evaluate-progress.js';
import { confirmGoalCompletion } from './planner-confirm.js';
import { createBudgetTracker } from './budget.js';
import { getWorldContext } from './world-model.js';
import { findSkillForIntent } from './skills.js';
import { recordNavigation } from './nav-graph.js';

// ---------------------------------------------------------------------------
// Helpers
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
 * Find the first pending intent in the list, or the current active one.
 */
function findActiveIntent(intents: Intent[]): Intent | null {
  const active = intents.find(i => i.status === 'active');
  if (active) return active;
  return intents.find(i => i.status === 'pending') ?? null;
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

/**
 * Return a new intents array with the given intent marked completed.
 */
function completeIntent(intents: Intent[], intentId: string): Intent[] {
  return intents.map(intent =>
    intent.id === intentId
      ? { ...intent, status: 'completed' as const, confidence: Math.max(intent.confidence, 0.7) }
      : intent
  );
}

/**
 * Advance to the next pending intent, activating it. Returns updated intents
 * and the newly active intent (or null if all are done).
 */
function advanceToNextIntent(intents: Intent[]): { intents: Intent[]; next: Intent | null } {
  const nextPending = intents.find(i => i.status === 'pending');
  if (!nextPending) {
    return { intents, next: null };
  }
  const updated = activateIntent(intents, nextPending.id);
  return { intents: updated, next: { ...nextPending, status: 'active' } };
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
    const plan = await planStrategy(session.agent, goal, worldContext, startUrl);

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

    // 6. Policy loop
    while (!budget.exhausted()) {
      const currentPage = session.connector.getHarness().page;
      const urlBefore = await getPageUrl(currentPage);

      // a. Perceive current state
      // Cast to `any` to bridge the Playwright Page overloads with the narrower
      // structural types used by perception/executor modules.
      const activeIntent = findActiveIntent(taskMemory.intents);
      const perception = await perceive(currentPage as any, activeIntent, '');

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

      // c. Decide next action
      const action: AgentAction = await decideNextAction(
        session.agent,
        perception,
        taskMemory.actionsAttempted.slice(-5),
      );

      broadcast({
        type: 'action',
        action: action.type,
        target: action.elementId,
      });

      // d. Execute action
      const result = await executeAction(
        session.agent as any,
        currentPage as any,
        action,
        perception.uiElements,
      );

      // e. Get URL after action
      const urlAfter = await getPageUrl(currentPage);

      // f. Verify action
      const verification = verifyAction(action, result, urlBefore, urlAfter);

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

      // j. Evaluate progress
      const { decision, reason } = evaluateProgress(
        taskMemory,
        budget,
        verification,
        urlBefore,
        urlAfter,
      );

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
            broadcast({
              type: 'thought',
              content: `Intent "${activeIntent.description}" completed`,
            });

            taskMemory = {
              ...taskMemory,
              intents: completeIntent(taskMemory.intents, activeIntent.id),
            };

            const { intents: nextIntents, next } = advanceToNextIntent(taskMemory.intents);
            taskMemory = { ...taskMemory, intents: nextIntents };

            if (!next) {
              broadcast({ type: 'thought', content: 'All intents completed' });
              break;
            }

            broadcast({
              type: 'thought',
              content: `Moving to next intent: "${next.description}"`,
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
            const replan = await planStrategy(session.agent, goal, worldContext, currentUrl);

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

    // 7. Confirm goal completion
    const confirmation = confirmGoalCompletion(goal, taskMemory.intents);
    const stepsCompleted = budget.snapshot().stepsUsed;

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
    broadcast({ type: 'error', message });
    broadcast({ type: 'taskComplete', success: false });
    return { success: false, stepsCompleted: budget.snapshot().stepsUsed };
  }
}
