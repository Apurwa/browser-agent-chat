export function evalBudgetEfficiency(
  stepsUsed: number,
  intentsCompleted: number,
): { score: number; details: string } {
  const score = stepsUsed > 0 ? intentsCompleted / stepsUsed : 0;
  return { score, details: `${intentsCompleted} intents in ${stepsUsed} steps` };
}
