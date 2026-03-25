import type { FrontierItem } from './agent-types.js';

/**
 * Compute a numeric priority score for a frontier item.
 *
 * Formula:
 *   base = categoryBonus + visitedScore + depthPenalty + failedPenalty
 *   priority = base + (intentRelevance ?? 0) * 4
 *
 * Category bonuses:
 *   navigation: +3
 *   form | modal: +2
 *   button | link: +1
 *
 * Visited:
 *   unvisited (!visited): +3
 *   visited:              -2
 *
 * Depth: -depth * 1
 *
 * Failed: hasFailed ? -3 : 0
 *
 * Intent relevance: intentRelevance * 4  (0–4 boost)
 */
export function computeFrontierPriority(
  category: FrontierItem['category'],
  visited: boolean,
  depth: number,
  hasFailed: boolean,
  intentRelevance?: number,
): number {
  const categoryBonus =
    category === 'navigation' ? 3 :
    category === 'form' || category === 'modal' ? 2 :
    1; // button | link

  const visitedScore = visited ? -2 : 3;
  const depthPenalty = -depth;
  const failedPenalty = hasFailed ? -3 : 0;

  const base = categoryBonus + visitedScore + depthPenalty + failedPenalty;
  return base + (intentRelevance ?? 0) * 4;
}
