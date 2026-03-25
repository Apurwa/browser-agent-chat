import type { Intent } from '../../agent-types.js';

export function evalTaskCompletion(intents: Intent[]): { score: number; details: string } {
  const completed = intents.filter(i => i.status === 'completed').length;
  const score = intents.length > 0 ? completed / intents.length : 0;
  return { score, details: `${completed}/${intents.length} intents completed` };
}
