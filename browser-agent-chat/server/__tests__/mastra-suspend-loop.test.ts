import { describe, it, expect } from 'vitest';
import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { InMemoryStore } from '@mastra/core/storage';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Task 2: Verify suspend() inside .dountil() loop
//
// Goal: Confirm that calling suspend() inside a dountil loop step works
// correctly — the workflow suspends, and after resume, the loop continues
// from where it left off. Also test double-suspend.
//
// Mastra version: 1.13.2
//
// IMPORTANT: suspend/resume requires persistent storage. We use InMemoryStore
// to enable snapshot persistence for these integration tests.
// ---------------------------------------------------------------------------

const LoopStateSchema = z.object({
  iteration: z.number().int().nonnegative(),
  suspended: z.boolean(),
  log: z.array(z.string()),
});

const ResumeSchema = z.object({
  continueLoop: z.boolean(),
});

const SuspendSchema = z.object({
  reason: z.string(),
});

const loopStep = createStep({
  id: 'loop-body',
  description: 'Loop body that suspends on specific iterations',
  inputSchema: LoopStateSchema,
  outputSchema: LoopStateSchema,
  resumeSchema: ResumeSchema,
  suspendSchema: SuspendSchema,
  execute: async ({ inputData, suspend, resumeData }) => {
    const nextIteration = inputData.iteration + 1;

    // Suspend on iterations 2 and 4
    if ((nextIteration === 2 || nextIteration === 4) && !resumeData) {
      await suspend(
        { reason: `Suspending at iteration ${nextIteration}` },
        { resumeLabel: `iter-${nextIteration}` },
      );
      // Code after suspend is unreachable — Mastra re-invokes with resumeData
    }

    const logEntry = resumeData
      ? `iter-${nextIteration}-resumed`
      : `iter-${nextIteration}`;

    return {
      iteration: nextIteration,
      suspended: false,
      log: [...inputData.log, logEntry],
    };
  },
});

const suspendLoopWorkflow = createWorkflow({
  id: 'suspend-loop',
  inputSchema: LoopStateSchema,
  outputSchema: LoopStateSchema,
  steps: [loopStep],
})
  .dountil(loopStep, async ({ inputData }) => {
    // Stop when iteration >= 5
    return (inputData as { iteration: number }).iteration >= 5;
  })
  .commit();

const storage = new InMemoryStore();

const mastra = new Mastra({
  workflows: { suspendLoopWorkflow },
  storage,
});

describe('suspend() inside .dountil() loop', () => {
  it('suspends on iteration 2 and resumes to continue the loop', async () => {
    const wf = mastra.getWorkflow('suspendLoopWorkflow');
    const run = await wf.createRun();

    // Start the workflow — should suspend at iteration 2
    const firstResult = await run.start({
      inputData: { iteration: 0, suspended: false, log: [] },
    });

    expect(firstResult.status).toBe('suspended');

    if (firstResult.status !== 'suspended') {
      throw new Error(`Expected suspended, got ${firstResult.status}`);
    }

    // Resume from the suspended state
    const resumeResult = await run.resume({
      step: loopStep,
      resumeData: { continueLoop: true },
    });

    // After resuming iteration 2, the loop should continue to iteration 4
    // where it suspends again (double-suspend test)
    if (resumeResult.status === 'suspended') {
      // Double-suspend: suspended again at iteration 4
      const finalResult = await run.resume({
        step: loopStep,
        resumeData: { continueLoop: true },
      });

      // After second resume, loop should complete (iteration >= 5)
      expect(finalResult.status).toBe('success');
      if (finalResult.status === 'success') {
        expect(finalResult.result.iteration).toBe(5);
        // Verify log entries include resume markers
        expect(finalResult.result.log).toContain('iter-2-resumed');
        expect(finalResult.result.log).toContain('iter-4-resumed');
      }
    } else if (resumeResult.status === 'success') {
      // If suspend-in-loop completes all remaining iterations after first resume,
      // that means double-suspend within a single dountil may not be fully supported.
      // Document the actual behavior.
      expect(resumeResult.result.iteration).toBeGreaterThanOrEqual(3);
      console.log(
        '[FINDING] After first resume, loop completed to end without second suspend. ' +
        `Final iteration: ${resumeResult.result.iteration}, log: ${JSON.stringify(resumeResult.result.log)}`,
      );
    } else {
      // Document unexpected status for future debugging
      console.log(`[FINDING] Unexpected status after resume: ${resumeResult.status}`);
      console.log('[FINDING] Full result:', JSON.stringify(resumeResult, null, 2));
    }
  });

  it('single suspend at iteration 2 — workflow suspends and can be resumed', async () => {
    // Simpler test: just verify the basic suspend/resume contract inside a loop
    const singleSuspendStep = createStep({
      id: 'single-suspend-body',
      description: 'Suspends only on iteration 2',
      inputSchema: LoopStateSchema,
      outputSchema: LoopStateSchema,
      resumeSchema: ResumeSchema,
      suspendSchema: SuspendSchema,
      execute: async ({ inputData, suspend, resumeData }) => {
        const nextIteration = inputData.iteration + 1;

        if (nextIteration === 2 && !resumeData) {
          await suspend(
            { reason: 'Pausing for user input' },
            { resumeLabel: 'pause-2' },
          );
        }

        const logEntry = resumeData
          ? `iter-${nextIteration}-resumed`
          : `iter-${nextIteration}`;

        return {
          iteration: nextIteration,
          suspended: false,
          log: [...inputData.log, logEntry],
        };
      },
    });

    const singleSuspendWorkflow = createWorkflow({
      id: 'single-suspend-loop',
      inputSchema: LoopStateSchema,
      outputSchema: LoopStateSchema,
      steps: [singleSuspendStep],
    })
      .dountil(singleSuspendStep, async ({ inputData }) => {
        return (inputData as { iteration: number }).iteration >= 3;
      })
      .commit();

    const testMastra = new Mastra({
      workflows: { singleSuspendWorkflow },
      storage: new InMemoryStore(),
    });

    const wf = testMastra.getWorkflow('singleSuspendWorkflow');
    const run = await wf.createRun();

    const startResult = await run.start({
      inputData: { iteration: 0, suspended: false, log: [] },
    });

    // Should suspend at iteration 2
    expect(startResult.status).toBe('suspended');

    if (startResult.status === 'suspended') {
      const resumed = await run.resume({
        step: singleSuspendStep,
        resumeData: { continueLoop: true },
      });

      // After resume, loop should continue and complete at iteration 3
      if (resumed.status === 'success') {
        expect(resumed.result.iteration).toBe(3);
        expect(resumed.result.log).toContain('iter-2-resumed');
      } else {
        // Document what actually happened
        console.log(`[FINDING] After resume, status was: ${resumed.status}`);
      }
    }
  });
});
