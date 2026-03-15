import { listLearningPoolByCluster, createTaskPattern, listPatternsByCluster } from '../db.js';
import { embedText } from './embedding.js';
import type { LearningPoolEntry } from '../types.js';

const MIN_CLUSTER_RUNS = 5;
const MIN_STEP_FREQUENCY = 0.4; // Step must appear in 40%+ of runs

interface ExtractedStep {
  action: string;
  target?: string;
}

/**
 * Extract dominant path from a cluster's positive runs using LCS.
 * Also checks negative runs for real success rate calculation.
 * Returns null if cluster doesn't have enough positive runs.
 */
export async function extractPattern(
  clusterId: string,
  agentId: string,
  clusterSummary: string,
): Promise<{ steps: ExtractedStep[]; metrics: PatternMetrics } | null> {
  const positiveRuns = await listLearningPoolByCluster(clusterId, 'positive');
  if (positiveRuns.length < MIN_CLUSTER_RUNS) return null;

  // Also get negative runs to calculate real success rate
  const negativeRuns = await listLearningPoolByCluster(clusterId, 'negative');
  const totalRuns = positiveRuns.length + negativeRuns.length;
  const runs = positiveRuns;

  // Extract step sequences from each run
  const sequences = runs.map(run =>
    (run.steps as any[])
      .filter(s => s.step_type === 'action' || s.step_type === 'navigation')
      .map(s => ({ action: s.content, target: s.target ?? undefined }))
  );

  if (sequences.length === 0) return null;

  // Find dominant path using pairwise LCS
  const dominantPath = findDominantPath(sequences);
  if (dominantPath.length === 0) return null;

  // Calculate metrics (pass total runs including negatives for real success rate)
  const metrics = calculateMetrics(runs, dominantPath.length, totalRuns);

  // Check if a pattern already exists for this cluster
  const existingPatterns = await listPatternsByCluster(clusterId);
  if (existingPatterns.length > 0) {
    // Update existing pattern if new one is better (dominance rule)
    const best = existingPatterns.reduce((a, b) => (a.score ?? 0) > (b.score ?? 0) ? a : b);
    if ((best.success_rate ?? 0) >= metrics.successRate && (best.avg_steps ?? Infinity) <= metrics.avgSteps) {
      return null; // Existing pattern is at least as good
    }
  }

  // Create the pattern
  const embedding = await embedText(clusterSummary);

  await createTaskPattern({
    agent_id: agentId,
    trigger: { type: 'task', summary: clusterSummary },
    steps: dominantPath,
    cluster_id: clusterId,
    embedding,
    avg_steps: metrics.avgSteps,
    avg_duration_ms: metrics.avgDuration,
    success_rate: metrics.successRate,
    variance: metrics.variance,
    score: metrics.score,
  });

  return { steps: dominantPath, metrics };
}

interface PatternMetrics {
  avgSteps: number;
  avgDuration: number;
  successRate: number;
  variance: number;
  score: number;
}

function calculateMetrics(runs: LearningPoolEntry[], patternStepCount: number, totalRuns: number): PatternMetrics {
  const stepCounts = runs.map(r => r.step_count);
  const durations = runs.filter(r => r.duration_ms != null).map(r => r.duration_ms!);

  const avgSteps = stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length;
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Success rate: positive runs / total runs in cluster (includes negatives)
  const successRate = totalRuns > 0 ? runs.length / totalRuns : 1.0;

  // Variance of step counts (lower = more stable)
  const mean = avgSteps;
  const variance = stepCounts.reduce((sum, sc) => sum + Math.pow(sc - mean, 2), 0) / stepCounts.length;

  // Normalized score: 0.5×success + 0.25×efficiency + 0.15×stability + 0.1×recency
  const maxSteps = Math.max(...stepCounts, 1);
  const efficiency = 1 - (patternStepCount / maxSteps); // Lower steps = higher efficiency
  const stability = 1 / (1 + variance); // Lower variance = higher stability
  const recency = 1.0; // All recent runs

  const score = 0.5 * successRate + 0.25 * Math.max(0, efficiency) + 0.15 * stability + 0.1 * recency;

  return { avgSteps: Math.round(avgSteps), avgDuration: Math.round(avgDuration), successRate, variance, score };
}

/**
 * Find the dominant path across multiple sequences using pairwise LCS.
 * Steps that appear in less than MIN_STEP_FREQUENCY of runs are removed.
 */
function findDominantPath(sequences: ExtractedStep[][]): ExtractedStep[] {
  if (sequences.length === 0) return [];
  if (sequences.length === 1) return sequences[0];

  // Count frequency of each step (by action string)
  const stepFrequency = new Map<string, number>();
  for (const seq of sequences) {
    const seen = new Set<string>();
    for (const step of seq) {
      const key = stepKey(step);
      if (!seen.has(key)) {
        stepFrequency.set(key, (stepFrequency.get(key) ?? 0) + 1);
        seen.add(key);
      }
    }
  }

  // Filter to steps appearing in MIN_STEP_FREQUENCY of runs
  const threshold = Math.ceil(sequences.length * MIN_STEP_FREQUENCY);
  const frequentSteps = new Set<string>();
  for (const [key, count] of stepFrequency) {
    if (count >= threshold) frequentSteps.add(key);
  }

  // Filter sequences to only frequent steps
  const filtered = sequences.map(seq =>
    seq.filter(s => frequentSteps.has(stepKey(s)))
  );

  // Find LCS of first two sequences, then iteratively with the rest
  let result = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    result = lcs(result, filtered[i]);
  }

  return result;
}

function stepKey(step: ExtractedStep): string {
  return `${step.action}|${step.target ?? ''}`;
}

/**
 * Longest Common Subsequence of two step sequences.
 */
function lcs(a: ExtractedStep[], b: ExtractedStep[]): ExtractedStep[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (stepKey(a[i - 1]) === stepKey(b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the subsequence
  const result: ExtractedStep[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (stepKey(a[i - 1]) === stepKey(b[j - 1])) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}
