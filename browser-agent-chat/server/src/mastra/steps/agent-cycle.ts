import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { CycleSchema } from '../schemas.js';
import { getSessionContext } from '../../session-registry.js';
import { perceive } from '../../perception.js';
import { checkHeuristicOverride, getCurrentIntent, advanceIntent } from '../../agent-loop.js';
import { decideNextAction } from '../../policy.js';
import { executeAction } from '../../executor.js';
import { verifyAction } from '../../verify-action.js';
import { verifyIntent } from '../../verify-intent.js';
import { updateTaskMemory, evaluateProgress } from '../../evaluate-progress.js';
import { planStrategy } from '../../planner.js';
import { recordNavigation } from '../../nav-graph.js';
import { detectLoginPage } from '../../login-detector.js';
import { classifyFailure } from '../../observability.js';

// ---------------------------------------------------------------------------
// agentCycleStep — one iteration of the agent loop
//
// This is the loop body executed inside a .dountil(). Each iteration:
//   1. Check for login page -> suspend() if detected
//   2. Perceive via perceive(page, intents)
//   3. Check heuristic override
//   4. Decide via decideNextAction() (unless heuristic overrides)
//   5. Execute via executeAction()
//   6. Verify via verifyAction()
//   7. Update memory via updateTaskMemory() (pure version)
//   8. Record step in budget via ctx.budget.recordStep()
//   9. Evaluate progress via evaluateProgress()
//  10. Handle all 5 decisions: continue, retry_action, replan, done, escalate
//  11. Record navigation if URL changed
//  12. Return updated CycleSchema
// ---------------------------------------------------------------------------

const SuspendSchema = z.object({
  reason: z.string(),
  domain: z.string().optional(),
});

const ResumeSchema = z.object({
  credentialId: z.string().optional(),
});

export const agentCycleStep = createStep({
  id: 'agent-cycle',
  description: 'One iteration: perceive -> decide -> execute -> verify -> evaluate',
  inputSchema: CycleSchema,
  outputSchema: CycleSchema,
  suspendSchema: SuspendSchema,
  resumeSchema: ResumeSchema,
  execute: async ({ inputData, suspend, resumeData }) => {
    const ctx = getSessionContext(inputData.sessionId);
    const { session } = ctx;

    // Guard: check if browser/page is still alive before doing anything
    let page: any;
    try {
      page = session.connector.getHarness().page;
      await page.evaluate('1'); // quick liveness check
    } catch (err) {
      console.error('[AGENT-CYCLE] Browser/page is dead:', err);
      ctx.broadcast({ type: 'error', message: 'Browser session ended' });
      const costAgg = (session as any)?._costAggregator;
      costAgg?.recordFailure({
        category: 'browser_crashed',
        message: err instanceof Error ? err.message : 'Browser/page dead',
        recoverable: false,
      });
      return {
        ...inputData,
        taskComplete: false,
        escalated: true,
        budgetSnapshot: ctx.budget.snapshot(),
      };
    }

    // 0. Check for login page (proactive credential detection)
    if (!resumeData) {
      try {
        const loginDetection = await detectLoginPage(page);
        if (loginDetection.isLoginPage) {
          ctx.broadcast({
            type: 'thought',
            content: `Login page detected (confidence: ${loginDetection.score}). Requesting credentials...`,
          });
          await suspend(
            { reason: 'credential_needed', domain: loginDetection.domain },
            { resumeLabel: 'credential-needed' },
          );
          // After suspend, Mastra re-invokes with resumeData
        }
      } catch {
        // Login detection failure is non-fatal
      }
    }

    // After resume from credential suspension, credential has been injected
    // by the WebSocket handler. Continue with the cycle.

    try {
    const urlBefore = await getPageUrl(page);

    // 1. Perceive current state
    const activeIntent = getCurrentIntent(inputData.intents);
    const perception = await perceive(page as any, activeIntent, '');

    // 2. Heuristic override check
    const clickedElementIds = new Set<string>();
    const heuristicResult = checkHeuristicOverride(
      inputData.taskMemory,
      perception,
      clickedElementIds,
    );

    let action;

    if (heuristicResult) {
      // 3. Heuristic override fires
      ctx.broadcast({
        type: 'thought',
        content: `Switching strategy: clicking "${heuristicResult.action.elementId}"`,
      });
      action = heuristicResult.action;
    } else {
      // 4. Normal policy decision
      const { action: decidedAction } = await decideNextAction(
        session.agent,
        perception,
        inputData.taskMemory.actionsAttempted.slice(-5),
      );
      action = decidedAction;
    }

    ctx.broadcast({
      type: 'action',
      action: action.type,
      target: action.elementId,
    });

    // 5. Execute action
    const result = await executeAction(
      session.agent as any,
      page as any,
      action,
      perception.uiElements,
    );

    // 6. Get URL after action
    const urlAfter = await getPageUrl(page);

    // 6b. Record action failure in cost aggregator
    if (result.error) {
      const costAgg = (session as any)?._costAggregator;
      costAgg?.recordFailure({
        category: classifyFailure(result.error),
        message: result.error,
        actionType: action.type,
        intentId: getCurrentIntent(inputData.intents)?.id,
        recoverable: true,
      });
    }

    // 7. Verify action
    const verification = verifyAction(action, result, urlBefore, urlAfter);

    // 8. Update task memory (pure — returns new object)
    const updatedMemory = updateTaskMemory(
      inputData.taskMemory,
      action,
      verification,
      urlBefore,
      urlAfter,
    );

    // 9. Record step in budget (mutable — lives in registry)
    ctx.budget.recordStep();

    // 10. Evaluate progress (pure — does not mutate)
    const { decision, reason, signals } = evaluateProgress(
      updatedMemory,
      ctx.budget,
      verification,
      urlBefore,
      urlAfter,
    );

    // Apply updated stuck signals
    const memoryWithSignals = { ...updatedMemory, stuckSignals: signals };

    ctx.broadcast({ type: 'thought', content: reason });

    // 11. Handle all 5 decisions
    let intents = [...inputData.intents];
    let taskComplete = false;
    let escalated = false;
    let finalMemory = memoryWithSignals;

    switch (decision) {
      case 'continue': {
        // Check if active intent is complete
        if (activeIntent) {
          const intentCheck = await verifyIntent(
            activeIntent,
            urlAfter || urlBefore,
            perception.pageTitle,
          );

          if (intentCheck.passed) {
            ctx.broadcast({
              type: 'thought',
              content: `Intent "${activeIntent.description}" completed`,
            });

            intents = advanceIntent(inputData.intents);
            const nextActive = getCurrentIntent(intents);

            // Reset stuck signals on intent completion
            finalMemory = {
              ...finalMemory,
              intents,
              stuckSignals: {
                repeatedActionCount: 0,
                samePageCount: 0,
                failedExecutionCount: 0,
                stepsSinceProgress: 0,
              },
            };

            if (!nextActive || nextActive.status === 'completed') {
              ctx.broadcast({ type: 'thought', content: 'All intents completed' });
              taskComplete = true;
            } else {
              ctx.broadcast({
                type: 'thought',
                content: `Moving to next intent: "${nextActive.description}"`,
              });
            }
          }
        }
        break;
      }

      case 'retry_action':
        // Loop continues naturally — next iteration re-perceives
        break;

      case 'replan': {
        ctx.broadcast({ type: 'thought', content: `Replanning: ${reason}` });
        if (ctx.budget.canReplan()) {
          ctx.budget.recordReplan();
          finalMemory = {
            ...finalMemory,
            replanCount: finalMemory.replanCount + 1,
          };
          try {
            const { plan } = await planStrategy(
              session.agent,
              inputData.goal,
              inputData.worldContext,
              urlAfter,
            );
            intents = plan.intents;

            // Activate first pending intent
            const firstPending = intents.findIndex(i => i.status === 'pending');
            if (firstPending >= 0) {
              intents = intents.map((intent, idx) =>
                idx === firstPending
                  ? { ...intent, status: 'active' as const }
                  : intent,
              );
            }

            finalMemory = { ...finalMemory, intents };

            ctx.broadcast({
              type: 'thought',
              content: `Replanned with ${plan.intents.length} intent(s)`,
            });
          } catch (replanErr) {
            console.error('[AGENT-CYCLE] Replan failed:', replanErr);
            ctx.broadcast({
              type: 'thought',
              content: 'Replan failed, continuing with current plan',
            });
          }
        }
        break;
      }

      case 'done':
        taskComplete = true;
        break;

      case 'escalate_to_user': {
        ctx.broadcast({
          type: 'error',
          message: `Agent requires assistance: ${reason}`,
        });
        const costAgg = (session as any)?._costAggregator;
        costAgg?.recordFailure({
          category: classifyFailure(reason),
          message: reason,
          recoverable: false,
        });
        escalated = true;
        break;
      }
    }

    // 12. Record navigation if URL changed
    if (urlAfter && urlAfter !== urlBefore && !urlAfter.startsWith('about:')) {
      ctx.broadcast({ type: 'nav', url: urlAfter });
      if (inputData.agentId) {
        let pageTitle = '';
        try {
          pageTitle = await page.title();
        } catch {
          // non-fatal
        }
        recordNavigation(
          inputData.agentId,
          urlBefore,
          urlAfter,
          action.type,
          undefined,
          pageTitle,
          action.elementId,
        ).catch((err: unknown) => {
          console.error('[AGENT-CYCLE] recordNavigation failed:', err);
        });
      }
    }

    return {
      ...inputData,
      currentUrl: urlAfter || urlBefore,
      intents,
      taskMemory: finalMemory,
      budgetSnapshot: ctx.budget.snapshot(),
      taskComplete,
      escalated,
    };

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const isBrowserDead = errMsg.includes('Target page') || errMsg.includes('browser has been closed') || errMsg.includes('Target closed')
      if (isBrowserDead) {
        console.error('[AGENT-CYCLE] Browser died mid-step:', errMsg)
        ctx.broadcast({ type: 'error', message: 'Browser session ended unexpectedly' })
        return {
          ...inputData,
          taskComplete: false,
          escalated: true,
          budgetSnapshot: ctx.budget.snapshot(),
        }
      }
      // Re-throw non-browser errors
      throw err
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPageUrl(page: any): Promise<string> {
  try {
    return (await page.evaluate('location.href')) as string;
  } catch {
    return page.url() as string;
  }
}
