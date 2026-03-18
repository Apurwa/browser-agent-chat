import { AgentBudgetSchema, type AgentBudget } from './agent-types.js';

export interface BudgetTracker {
  recordStep(): void;
  recordReplan(): void;
  remaining(): { steps: number; timeMs: number };
  exhausted(): boolean;
  warning(): boolean;
  canReplan(): boolean;
  snapshot(): BudgetSnapshot;
}

export interface BudgetSnapshot {
  stepsUsed: number;
  stepsRemaining: number;
  replansUsed: number;
  elapsedMs: number;
  exhausted: boolean;
  warning: boolean;
}

export function createBudgetTracker(overrides: Partial<AgentBudget> = {}): BudgetTracker {
  const config = AgentBudgetSchema.parse(overrides);
  const startTime = Date.now();
  let stepsUsed = 0;
  let replansUsed = 0;

  const elapsedMs = () => Date.now() - startTime;

  const isExhausted = () =>
    stepsUsed >= config.maxSteps || elapsedMs() >= config.maxTimeMs;

  const isWarning = () =>
    stepsUsed >= config.maxSteps * 0.8 || elapsedMs() >= config.maxTimeMs * 0.8;

  return {
    recordStep: () => { stepsUsed++; },
    recordReplan: () => { replansUsed++; },
    remaining: () => ({
      steps: Math.max(0, config.maxSteps - stepsUsed),
      timeMs: Math.max(0, config.maxTimeMs - elapsedMs()),
    }),
    exhausted: isExhausted,
    warning: isWarning,
    canReplan: () => replansUsed < config.maxReplanAttempts,
    snapshot: () => ({
      stepsUsed,
      stepsRemaining: Math.max(0, config.maxSteps - stepsUsed),
      replansUsed,
      elapsedMs: elapsedMs(),
      exhausted: isExhausted(),
      warning: isWarning(),
    }),
  };
}
