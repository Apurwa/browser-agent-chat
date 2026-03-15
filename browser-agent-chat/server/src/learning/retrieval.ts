import { embedText, cosineSimilarity } from './embedding.js';
import { listTaskClusters, listPatternsByCluster } from '../db.js';
import type { LearnedPattern, TaskCluster } from '../types.js';

const MAX_PATTERNS = 3;
const MAX_TOKENS = 500;
const DIVERSITY_THRESHOLD = 0.85;

interface RetrievedPattern {
  pattern: LearnedPattern;
  similarity: number;
  finalScore: number;
}

/**
 * Retrieve relevant patterns for a task prompt.
 * Two-stage: cluster match → pattern retrieval within cluster.
 */
export async function retrievePatterns(
  agentId: string,
  taskPrompt: string,
): Promise<RetrievedPattern[]> {
  const promptEmbedding = await embedText(taskPrompt);
  if (!promptEmbedding) return [];

  // Stage 1: Find best matching cluster
  const clusters = await listTaskClusters(agentId);
  if (clusters.length === 0) return [];

  let bestCluster: TaskCluster | null = null;
  let bestClusterSim = 0;

  for (const cluster of clusters) {
    const sim = cosineSimilarity(promptEmbedding, cluster.centroid_embedding);
    if (sim > bestClusterSim) {
      bestClusterSim = sim;
      bestCluster = cluster;
    }
  }

  if (!bestCluster || bestClusterSim < 0.5) return []; // No relevant cluster

  // Stage 2: Retrieve patterns within cluster
  const patterns = await listPatternsByCluster(bestCluster.id);
  const activePatterns = patterns.filter(
    p => p.pattern_state === 'active' || p.pattern_state === 'dominant'
  );

  if (activePatterns.length === 0) return [];

  // Score each pattern
  const scored: RetrievedPattern[] = activePatterns.map(pattern => {
    const similarity = pattern.embedding
      ? cosineSimilarity(promptEmbedding, pattern.embedding)
      : bestClusterSim;

    const scopeWeight = pattern.scope === 'agent' ? 1.0
      : pattern.scope === 'org' ? 0.8
      : 0.6;

    // Recency: days since last use, normalized
    const lastUsed = pattern.last_used_at
      ? (Date.now() - new Date(pattern.last_used_at).getTime()) / (1000 * 60 * 60 * 24)
      : 30;
    const recency = Math.max(0, 1 - lastUsed / 90); // Decays over 90 days

    const finalScore =
      0.50 * similarity +
      0.25 * (pattern.score ?? 0) +
      0.15 * scopeWeight +
      0.10 * recency;

    return { pattern, similarity, finalScore };
  });

  // Sort by score descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Diversity filter: remove patterns too similar to already-selected ones
  const selected: RetrievedPattern[] = [];
  for (const candidate of scored) {
    if (selected.length >= MAX_PATTERNS) break;

    const tooSimilar = selected.some(s => {
      if (!s.pattern.embedding || !candidate.pattern.embedding) return false;
      return cosineSimilarity(s.pattern.embedding, candidate.pattern.embedding) > DIVERSITY_THRESHOLD;
    });

    if (!tooSimilar) {
      selected.push(candidate);
    }
  }

  return selected;
}

/**
 * Format retrieved patterns for prompt injection.
 * Respects the 500-token budget (rough estimate: 1 token ≈ 4 chars).
 */
export function formatPatternsForPrompt(retrieved: RetrievedPattern[]): string {
  if (retrieved.length === 0) return '';

  const lines: string[] = [
    'These workflows are examples of previously successful approaches.',
    'Use them as guidance, but adapt to the current UI state.',
    'If elements differ, reason about the closest equivalent action.',
    '',
    '## Learned Workflows',
    '',
  ];

  let totalChars = lines.join('\n').length;

  for (const { pattern } of retrieved) {
    const trigger = pattern.trigger as any;
    const name = trigger?.summary ?? 'Unnamed workflow';
    const steps = (pattern.steps as any[]).map(
      (s, i) => `${i + 1}. ${s.action}${s.target ? ` → ${s.target}` : ''}`
    );

    const block = [
      `Workflow: ${name}`,
      `success_rate: ${(pattern.success_rate ?? 0).toFixed(2)}`,
      `avg_steps: ${pattern.avg_steps ?? steps.length}`,
      `runs: ${pattern.use_count}`,
      '',
      'Steps:',
      ...steps,
      '',
    ];

    const blockChars = block.join('\n').length;
    if (totalChars + blockChars > MAX_TOKENS * 4) break; // Token budget exceeded

    lines.push(...block);
    totalChars += blockChars;
  }

  return lines.join('\n');
}
