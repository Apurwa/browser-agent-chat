import { createTaskFeedback, addToLearningPool, listExecutionSteps, getTaskCluster } from '../db.js';
import { embedText, summarizeTask } from './embedding.js';
import { assignToCluster } from './clustering.js';
import { extractPattern } from './extraction.js';
import type { FeedbackRating, ServerMessage } from '../types.js';

/**
 * Process user feedback on a task.
 * 1. Store feedback
 * 2. Embed and add to learning pool
 * 3. Assign to cluster
 * 4. Attempt pattern extraction if cluster is large enough
 */
export async function processFeedback(
  agentId: string,
  taskId: string,
  sessionId: string | null,
  taskPrompt: string,
  rating: FeedbackRating,
  correction: string | null,
  broadcast: (msg: ServerMessage) => void,
): Promise<void> {
  // Step 1: Store feedback
  const feedback = await createTaskFeedback({
    agent_id: agentId,
    task_id: taskId,
    session_id: sessionId,
    rating,
    correction,
  });

  if (!feedback) {
    console.error('[LEARNING] Failed to store feedback');
    return;
  }

  // Step 2: Embed task prompt and generate summary
  const [promptEmbedding, taskSummary] = await Promise.all([
    embedText(taskPrompt),
    summarizeTask(taskPrompt),
  ]);

  const summaryEmbedding = await embedText(taskSummary);

  // Step 3: Get execution steps and add to learning pool
  const executionSteps = await listExecutionSteps(taskId);
  const totalDuration = executionSteps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);

  const poolEntry = await addToLearningPool({
    task_id: taskId,
    agent_id: agentId,
    feedback: rating,
    task_prompt: taskPrompt,
    task_prompt_embedding: promptEmbedding,
    task_summary: taskSummary,
    task_summary_embedding: summaryEmbedding,
    steps: executionSteps.map(s => ({
      step_order: s.step_order,
      step_type: s.step_type,
      content: s.content,
      target: s.target ?? undefined,
      duration_ms: s.duration_ms ?? undefined,
    })),
    step_count: executionSteps.length,
    duration_ms: totalDuration || null,
  });

  if (!poolEntry) {
    console.error('[LEARNING] Failed to add to learning pool');
    return;
  }

  // Step 4: Cluster ALL runs (positive and negative) for accurate success rate
  if (!promptEmbedding) return;

  // Step 5: Assign to cluster
  const clusterId = await assignToCluster(agentId, promptEmbedding, taskSummary, poolEntry.id);

  // Step 6: Only attempt pattern extraction for positive runs
  if (rating !== 'positive') return;

  const cluster = await getTaskCluster(clusterId);
  if (!cluster) return;

  const result = await extractPattern(clusterId, agentId, cluster.task_summary);

  if (result) {
    console.log(`[LEARNING] Pattern extracted for cluster "${cluster.task_summary}": ${result.steps.length} steps`);
    // patternLearned broadcast moved to lifecycle.ts — candidate creation is silent
  }
}
