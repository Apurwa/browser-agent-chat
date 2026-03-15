import {
  updatePatternState, listPatternsByCluster, listActivePatterns,
  getTaskCluster,
} from '../db.js';
import type { LearnedPattern, PatternState } from '../types.js';

const ACTIVATION_USE_COUNT = 3;
const ACTIVATION_SUCCESS_RATE = 0.8;
const FAILURE_THRESHOLD = 3;
const ROLLING_WINDOW = 20;
const ROLLING_SUCCESS_THRESHOLD = 0.6;
const STALE_DAYS = 30;
const UNUSED_DAYS = 60;

/**
 * Check if a candidate pattern should be activated.
 */
export async function checkActivation(pattern: LearnedPattern): Promise<boolean> {
  if (pattern.pattern_state !== 'candidate') return false;
  if (pattern.use_count < ACTIVATION_USE_COUNT) return false;
  if ((pattern.success_rate ?? 0) < ACTIVATION_SUCCESS_RATE) return false;

  // Check cluster has enough runs
  if (pattern.cluster_id) {
    const cluster = await getTaskCluster(pattern.cluster_id);
    if (cluster && cluster.run_count < 5) return false;
  }

  await updatePatternState(pattern.id, 'active', {
    last_verified_success: new Date().toISOString(),
  });

  // Check if this should become dominant
  await checkDominance(pattern);

  return true;
}

/**
 * Check if a pattern should become dominant in its cluster.
 */
async function checkDominance(pattern: LearnedPattern): Promise<void> {
  if (!pattern.cluster_id) return;

  const clusterPatterns = await listPatternsByCluster(pattern.cluster_id);
  const activePatterns = clusterPatterns.filter(
    p => p.pattern_state === 'active' || p.pattern_state === 'dominant'
  );

  if (activePatterns.length === 0) return;

  // Find pattern with highest score
  const best = activePatterns.reduce((a, b) => (a.score ?? 0) > (b.score ?? 0) ? a : b);

  // Demote current dominant if different
  for (const p of activePatterns) {
    if (p.pattern_state === 'dominant' && p.id !== best.id) {
      await updatePatternState(p.id, 'active');
    }
  }

  // Promote best to dominant
  if (best.pattern_state !== 'dominant') {
    await updatePatternState(best.id, 'dominant');
  }
}

/**
 * Record a pattern failure and check if it should go stale.
 * Returns true if pattern was marked stale.
 */
export async function recordPatternFailure(pattern: LearnedPattern): Promise<boolean> {
  const newFailures = pattern.consecutive_failures + 1;

  if (newFailures >= FAILURE_THRESHOLD) {
    // Check rolling success rate (approximate from success_rate and use_count)
    const estimatedSuccessRate = pattern.use_count > 0
      ? Math.max(0, ((pattern.success_rate ?? 1) * pattern.use_count - newFailures) / pattern.use_count)
      : 0;

    if (estimatedSuccessRate < ROLLING_SUCCESS_THRESHOLD) {
      await updatePatternState(pattern.id, 'stale', {
        consecutive_failures: newFailures,
        success_rate: estimatedSuccessRate,
      });
      return true;
    }
  }

  await updatePatternState(pattern.id, pattern.pattern_state, {
    consecutive_failures: newFailures,
  });
  return false;
}

/**
 * Record a pattern success. Reset failure count, update metrics.
 */
export async function recordPatternSuccess(pattern: LearnedPattern): Promise<void> {
  const newUseCount = pattern.use_count + 1;
  const newSuccessRate = pattern.use_count > 0
    ? ((pattern.success_rate ?? 1) * pattern.use_count + 1) / newUseCount
    : 1.0;

  // Use updatePatternState with extended fields (use_count, last_used_at added to its type)
  await updatePatternState(pattern.id, pattern.pattern_state, {
    use_count: newUseCount,
    consecutive_failures: 0,
    success_rate: newSuccessRate,
    last_used_at: new Date().toISOString(),
    last_verified_success: new Date().toISOString(),
  });

  // Check activation for candidates
  if (pattern.pattern_state === 'candidate') {
    await checkActivation({ ...pattern, use_count: newUseCount, success_rate: newSuccessRate });
  }
}

/**
 * Check patterns for staleness (used by background job).
 */
export async function checkPatternHealth(agentId: string): Promise<{
  staled: string[];
  archived: string[];
}> {
  const patterns = await listActivePatterns(agentId, 'task');
  const staled: string[] = [];
  const archived: string[] = [];
  const now = Date.now();

  for (const p of patterns) {
    // Check for unused patterns
    const lastUsed = p.last_used_at ? new Date(p.last_used_at).getTime() : new Date(p.created_at).getTime();
    const daysSinceUse = (now - lastUsed) / (1000 * 60 * 60 * 24);

    if (daysSinceUse > UNUSED_DAYS) {
      await updatePatternState(p.id, 'archived');
      archived.push(p.id);
      continue;
    }

    // Check last verified success freshness
    if (p.last_verified_success) {
      const lastSuccess = new Date(p.last_verified_success).getTime();
      const daysSinceSuccess = (now - lastSuccess) / (1000 * 60 * 60 * 24);
      if (daysSinceSuccess > STALE_DAYS && p.consecutive_failures >= FAILURE_THRESHOLD) {
        await updatePatternState(p.id, 'stale');
        staled.push(p.id);
      }
    }
  }

  return { staled, archived };
}
