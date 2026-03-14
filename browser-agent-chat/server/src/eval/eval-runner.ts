import { createAgent, executeTask } from '../agent.js';
import { claimWarm, killBrowser, launchBrowser } from '../browserManager.js';
import {
  createEvalRun, updateEvalRun, createEvalResult,
  listEvalCases,
} from '../db.js';
import type { EvalRunTrigger, EvalRun, EvalCase, ServerMessage, ErrorType } from '../types.js';
import { runChecks, summarizeChecks } from './checks.js';
import type { CheckResult } from './checks.js';
import { judgeWithLLM } from './llm-judge.js';
import { classifyError } from './error-analyzer.js';

type EvalBroadcast = (msg: ServerMessage) => void;

// Active runs tracked for cancellation
const activeRuns = new Map<string, { cancelled: boolean }>();

export function cancelRun(runId: string): boolean {
  const run = activeRuns.get(runId);
  if (run) {
    run.cancelled = true;
    return true;
  }
  return false;
}

export async function startEvalRun(
  projectId: string,
  trigger: EvalRunTrigger,
  broadcast: EvalBroadcast,
  tags?: string[],
): Promise<EvalRun | null> {
  // Create the run record
  const run = await createEvalRun(projectId, trigger);
  if (!run) return null;

  const runState = { cancelled: false };
  activeRuns.set(run.id, runState);

  // Load eval cases
  const cases = await listEvalCases(projectId, { status: 'active', tags });
  if (cases.length === 0) {
    await updateEvalRun(run.id, {
      status: 'completed',
      summary: { total: 0, passed: 0, failed: 0, errored: 0, error_breakdown: {} },
      completed_at: new Date().toISOString(),
    });
    activeRuns.delete(run.id);
    return run;
  }

  // Kick off run asynchronously — returns immediately with the run record
  runCasesSequentially(run.id, projectId, cases, broadcast, runState).catch(err => {
    console.error(`[EvalRunner] Run ${run.id} failed with unexpected error:`, err);
    updateEvalRun(run.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
    }).catch(() => {});
    activeRuns.delete(run.id);
  });

  return run;
}

async function runCasesSequentially(
  runId: string,
  projectId: string,
  cases: EvalCase[],
  broadcast: EvalBroadcast,
  runState: { cancelled: boolean },
): Promise<void> {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  const errorBreakdown: Record<string, number> = {};

  for (let i = 0; i < cases.length; i++) {
    if (runState.cancelled) {
      await updateEvalRun(runId, {
        status: 'cancelled',
        summary: { total: cases.length, passed, failed, errored, error_breakdown: errorBreakdown },
        completed_at: new Date().toISOString(),
      });
      activeRuns.delete(runId);
      return;
    }

    const evalCase = cases[i];
    const startTime = Date.now();

    try {
      const result = await runSingleCase(runId, projectId, evalCase);
      const duration = Date.now() - startTime;

      await createEvalResult({
        run_id: runId,
        case_id: evalCase.id,
        session_id: null,
        verdict: result.verdict,
        code_checks: result.codeChecks,
        llm_judge: result.llmJudge,
        error_type: result.errorType,
        steps_taken: result.steps,
        duration_ms: duration,
        screenshots: result.screenshots,
      });

      if (result.verdict === 'pass') {
        passed++;
      } else if (result.verdict === 'fail') {
        failed++;
        if (result.errorType) {
          errorBreakdown[result.errorType] = (errorBreakdown[result.errorType] ?? 0) + 1;
        }
      } else {
        errored++;
      }

      broadcast({
        type: 'evalProgress',
        runId,
        completed: i + 1,
        total: cases.length,
        latest: { case: evalCase.name, verdict: result.verdict },
      });
    } catch (err) {
      errored++;
      console.error(`[EvalRunner] Case ${evalCase.id} (${evalCase.name}) threw unexpectedly:`, err);
      await createEvalResult({
        run_id: runId,
        case_id: evalCase.id,
        session_id: null,
        verdict: 'error',
        code_checks: {},
        llm_judge: null,
        error_type: 'unexpected_state',
        steps_taken: [],
        duration_ms: Date.now() - startTime,
        screenshots: [],
      });
    }
  }

  const summary = {
    total: cases.length,
    passed,
    failed,
    errored,
    error_breakdown: errorBreakdown,
  };

  await updateEvalRun(runId, {
    status: 'completed',
    summary,
    completed_at: new Date().toISOString(),
  });
  activeRuns.delete(runId);

  broadcast({
    type: 'evalComplete',
    runId,
    summary: { total: cases.length, passed, failed, errorBreakdown },
  });
}

interface CaseResult {
  verdict: 'pass' | 'fail' | 'error';
  codeChecks: Record<string, boolean>;
  llmJudge: { verdict: string; reasoning: string } | null;
  errorType: ErrorType | null;
  steps: Array<{ order: number; action: string; target?: string }>;
  screenshots: string[];
}

async function runSingleCase(
  runId: string,
  projectId: string,
  evalCase: EvalCase,
): Promise<CaseResult> {
  // Attempt to claim a warm browser; fall back to launching a fresh one
  let browserInfo = await claimWarm(projectId);
  if (!browserInfo) {
    try {
      browserInfo = await launchBrowser(projectId);
    } catch (err) {
      console.error(`[EvalRunner] Failed to launch browser for case ${evalCase.id}:`, err);
      return {
        verdict: 'error',
        codeChecks: {},
        llmJudge: null,
        errorType: 'unexpected_state',
        steps: [],
        screenshots: [],
      };
    }
  }

  const steps: Array<{ order: number; action: string; target?: string }> = [];
  let lastScreenshot = '';

  // Eval-specific broadcast: captures steps and screenshots only — no Redis writes, no side effects
  const evalBroadcast: EvalBroadcast = (msg: ServerMessage) => {
    if (msg.type === 'action') {
      steps.push({ order: steps.length + 1, action: msg.action, target: msg.target });
    } else if (msg.type === 'screenshot') {
      lastScreenshot = msg.data;
    }
  };

  try {
    // Create agent — pass null for both sessionId and projectId to prevent:
    //   - nav graph writes (recordNavigation fires only when projectId is set)
    //   - finding/suggestion detection (both guarded by `if (projectId && sessionId)`)
    const agentSession = await createAgent(
      evalBroadcast,
      browserInfo.cdpEndpoint,
      null,  // sessionId
      null,  // projectId
    );

    try {
      // Execute the eval task
      await executeTask(agentSession, evalCase.task_prompt, evalBroadcast);

      if (lastScreenshot) {
        // screenshots array carries the final page state for the LLM judge
      }

      // Run code-based checks against the live page
      const page = agentSession.connector.getHarness().page;
      const checkResults: CheckResult[] = await runChecks(page, evalCase.checks);
      const codeChecks = summarizeChecks(checkResults);
      const allChecksPassed = checkResults.every(r => r.passed);

      let verdict: 'pass' | 'fail' = allChecksPassed ? 'pass' : 'fail';
      let llmJudge: { verdict: string; reasoning: string } | null = null;

      // Run LLM judge only when code checks pass and criteria + screenshot are available
      if (allChecksPassed && evalCase.llm_judge_criteria && lastScreenshot) {
        const stepsDesc = steps
          .map(s => `${s.order}. ${s.action}${s.target ? ` (${s.target})` : ''}`)
          .join('\n');
        llmJudge = await judgeWithLLM(
          lastScreenshot,
          evalCase.llm_judge_criteria,
          evalCase.task_prompt,
          stepsDesc,
        );
        verdict = llmJudge.verdict === 'pass' ? 'pass' : 'fail';
      }

      let errorType: ErrorType | null = null;
      if (verdict === 'fail') {
        const failedChecks = checkResults.filter(r => !r.passed);
        errorType = classifyError({
          steps,
          finalUrl: page.url(),
          failedChecks,
          taskPrompt: evalCase.task_prompt,
        });
      }

      await agentSession.close();

      const screenshots = lastScreenshot ? [lastScreenshot] : [];
      return { verdict, codeChecks, llmJudge, errorType, steps, screenshots };
    } catch (taskErr) {
      // Task execution failed — close agent gracefully before re-throwing
      await agentSession.close().catch(() => {});
      throw taskErr;
    }
  } finally {
    // Always release the browser, regardless of success or failure
    await killBrowser(browserInfo.pid, browserInfo.port);
  }
}
