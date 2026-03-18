import { describe, it, expect } from 'vitest';
import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Task 1: Verify .dountil() condition behavior
//
// Goal: Confirm that the dountil condition function receives the **step output**
// (count AFTER increment) and not the step input.
// ---------------------------------------------------------------------------

const CounterInputSchema = z.object({
  count: z.number().int().nonnegative(),
  done: z.boolean(),
});

const CounterOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  done: z.boolean(),
});

const incrementStep = createStep({
  id: 'increment',
  description: 'Increment counter by 1, set done when count >= 3',
  inputSchema: CounterInputSchema,
  outputSchema: CounterOutputSchema,
  execute: async ({ inputData }) => {
    const nextCount = inputData.count + 1;
    return {
      count: nextCount,
      done: nextCount >= 3,
    };
  },
});

// Capture what the condition function receives across iterations
const conditionReceivedValues: Array<{ inputData: unknown; iterationCount: number }> = [];

const counterWorkflow = createWorkflow({
  id: 'counter-dountil',
  inputSchema: CounterInputSchema,
  outputSchema: CounterOutputSchema,
  steps: [incrementStep],
})
  .dountil(incrementStep, async ({ inputData, iterationCount }) => {
    conditionReceivedValues.push({
      inputData: structuredClone(inputData),
      iterationCount,
    });
    // Stop when done is true (i.e. count >= 3)
    return (inputData as { done: boolean }).done === true;
  })
  .commit();

const mastra = new Mastra({
  workflows: { counterWorkflow },
});

describe('.dountil() condition behavior', () => {
  it('condition receives step OUTPUT (count after increment, not before)', async () => {
    // Reset captured values
    conditionReceivedValues.length = 0;

    const run = await mastra.getWorkflow('counterWorkflow').createRun();
    const result = await run.start({
      inputData: { count: 0, done: false },
    });

    // The loop should run 3 iterations:
    //   iter 0: input count=0 → step output count=1, done=false → condition sees count=1 → false
    //   iter 1: input count=1 → step output count=2, done=false → condition sees count=2 → false
    //   iter 2: input count=2 → step output count=3, done=true  → condition sees count=3 → true (stop)
    expect(result.status).toBe('success');

    // Verify the condition was called with STEP OUTPUT values
    expect(conditionReceivedValues.length).toBe(3);

    // FINDING: Mastra iterationCount is 1-based (starts at 1, not 0)

    // First iteration: step receives count=0, outputs count=1
    // Condition should see count=1 (the step OUTPUT)
    const firstCall = conditionReceivedValues[0];
    expect((firstCall.inputData as { count: number }).count).toBe(1);
    expect(firstCall.iterationCount).toBe(1); // 1-based

    // Second iteration: step receives count=1, outputs count=2
    const secondCall = conditionReceivedValues[1];
    expect((secondCall.inputData as { count: number }).count).toBe(2);
    expect(secondCall.iterationCount).toBe(2);

    // Third iteration: step receives count=2, outputs count=3, done=true
    const thirdCall = conditionReceivedValues[2];
    expect((thirdCall.inputData as { count: number }).count).toBe(3);
    expect((thirdCall.inputData as { done: boolean }).done).toBe(true);
    expect(thirdCall.iterationCount).toBe(3);
  });

  it('final workflow result contains the last step output', async () => {
    conditionReceivedValues.length = 0;

    const run = await mastra.getWorkflow('counterWorkflow').createRun();
    const result = await run.start({
      inputData: { count: 0, done: false },
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      // The result should reflect the final step output
      expect(result.result).toEqual({ count: 3, done: true });
    }
  });

  it('exits immediately if condition is true after first iteration', async () => {
    conditionReceivedValues.length = 0;

    const run = await mastra.getWorkflow('counterWorkflow').createRun();
    // Starting at count=2 means step outputs count=3, done=true on first iteration
    const result = await run.start({
      inputData: { count: 2, done: false },
    });

    expect(result.status).toBe('success');
    // Condition should be called exactly once
    expect(conditionReceivedValues.length).toBe(1);
    expect((conditionReceivedValues[0].inputData as { count: number }).count).toBe(3);
  });
});
