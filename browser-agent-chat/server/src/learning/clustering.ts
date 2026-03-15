import { cosineSimilarity } from './embedding.js';
import {
  listTaskClusters, createTaskCluster, updateTaskCluster,
  incrementClusterRunCount, updateLearningPoolCluster,
} from '../db.js';
import type { TaskCluster } from '../types.js';

const CLUSTER_SIMILARITY_THRESHOLD = 0.85;

/**
 * Find the best matching cluster for a given embedding, or create a new one.
 * Returns the cluster ID.
 */
export async function assignToCluster(
  agentId: string,
  embedding: number[],
  taskSummary: string,
  entryId: string,
): Promise<string> {
  const clusters = await listTaskClusters(agentId);

  let bestCluster: TaskCluster | null = null;
  let bestSimilarity = 0;

  for (const cluster of clusters) {
    const sim = cosineSimilarity(embedding, cluster.centroid_embedding);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestCluster = cluster;
    }
  }

  let clusterId: string;

  if (bestCluster && bestSimilarity >= CLUSTER_SIMILARITY_THRESHOLD) {
    // Assign to existing cluster, update centroid via running mean
    clusterId = bestCluster.id;
    const n = bestCluster.run_count + 1;
    const newCentroid = bestCluster.centroid_embedding.map(
      (val, i) => (val * (n - 1) + embedding[i]) / n
    );
    await updateTaskCluster(clusterId, {
      centroid_embedding: newCentroid,
      run_count: n,
    });
  } else {
    // Create new cluster
    const newCluster = await createTaskCluster({
      agent_id: agentId,
      centroid_embedding: embedding,
      task_summary: taskSummary,
      run_count: 1,
    });
    if (!newCluster) throw new Error('Failed to create task cluster');
    clusterId = newCluster.id;
  }

  // Link the learning pool entry to this cluster
  await updateLearningPoolCluster(entryId, clusterId);

  return clusterId;
}

/**
 * Check if two clusters should be merged (for background job).
 * Returns true if centroid similarity exceeds threshold.
 */
export function shouldMergeClusters(
  clusterA: TaskCluster,
  clusterB: TaskCluster,
): boolean {
  const centroidSim = cosineSimilarity(
    clusterA.centroid_embedding,
    clusterB.centroid_embedding
  );
  return centroidSim > 0.9;
}
