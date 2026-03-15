import cron from 'node-cron';
import * as redisStore from '../redisStore.js';
import { listTaskClusters, listPatternsByCluster, updatePatternState } from '../db.js';
import { cosineSimilarity } from './embedding.js';
import { checkPatternHealth } from './lifecycle.js';
import { supabase, isSupabaseEnabled } from '../supabase.js';

const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_TTL_SECONDS = 360; // 6 minutes

async function acquireLock(jobName: string): Promise<boolean> {
  try {
    const redis = redisStore.getRedis();
    if (!redis) return true;
    const key = `learning:job:${jobName}:lock`;
    const result = await redis.set(key, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch {
    return true;
  }
}

async function releaseLock(jobName: string): Promise<void> {
  try {
    const redis = redisStore.getRedis();
    if (!redis) return;
    await redis.del(`learning:job:${jobName}:lock`);
  } catch {
    // Ignore lock release errors
  }
}

async function runWithLock(jobName: string, fn: () => Promise<void>): Promise<void> {
  if (!(await acquireLock(jobName))) {
    console.log(`[JOBS] ${jobName} skipped — another instance holds the lock`);
    return;
  }
  try {
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Job ${jobName} timed out`)), JOB_TIMEOUT_MS)
    );
    await Promise.race([fn(), timeout]);
  } catch (err) {
    console.error(`[JOBS] ${jobName} error:`, err);
  } finally {
    await releaseLock(jobName);
  }
}

async function clusterMerging(): Promise<void> {
  if (!isSupabaseEnabled()) return;
  console.log('[JOBS] Running cluster merging...');

  const { data: agents } = await supabase!
    .from('task_clusters')
    .select('agent_id')
    .not('agent_id', 'is', null);

  if (!agents) return;

  const agentIds = [...new Set(agents.map((a: any) => a.agent_id))];

  for (const agentId of agentIds) {
    const clusters = await listTaskClusters(agentId);
    const merged = new Set<string>();

    for (let i = 0; i < clusters.length; i++) {
      if (merged.has(clusters[i].id)) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        if (merged.has(clusters[j].id)) continue;

        const sim = cosineSimilarity(
          clusters[i].centroid_embedding,
          clusters[j].centroid_embedding
        );

        if (sim > 0.9) {
          const [larger, smaller] = clusters[i].run_count >= clusters[j].run_count
            ? [clusters[i], clusters[j]]
            : [clusters[j], clusters[i]];

          await supabase!
            .from('learning_pool')
            .update({ cluster_id: larger.id })
            .eq('cluster_id', smaller.id);

          await supabase!
            .from('learned_patterns')
            .update({ cluster_id: larger.id })
            .eq('cluster_id', smaller.id);

          await supabase!
            .from('task_clusters')
            .update({ run_count: larger.run_count + smaller.run_count })
            .eq('id', larger.id);

          await supabase!
            .from('task_clusters')
            .delete()
            .eq('id', smaller.id);

          merged.add(smaller.id);
          console.log(`[JOBS] Merged cluster "${smaller.task_summary}" into "${larger.task_summary}"`);
        }
      }
    }
  }
}

async function patternConsolidation(): Promise<void> {
  if (!isSupabaseEnabled()) return;
  console.log('[JOBS] Running pattern consolidation...');

  const { data: clusters } = await supabase!
    .from('task_clusters')
    .select('id');

  if (!clusters) return;

  for (const cluster of clusters) {
    const patterns = await listPatternsByCluster(cluster.id);
    if (patterns.length < 2) continue;

    const archived = new Set<string>();

    for (let i = 0; i < patterns.length; i++) {
      if (archived.has(patterns[i].id)) continue;
      for (let j = i + 1; j < patterns.length; j++) {
        if (archived.has(patterns[j].id)) continue;

        if (patterns[i].embedding && patterns[j].embedding) {
          const sim = cosineSimilarity(patterns[i].embedding!, patterns[j].embedding!);
          if (sim > 0.85) {
            const rateDiff = Math.abs((patterns[i].success_rate ?? 0) - (patterns[j].success_rate ?? 0));
            if (rateDiff < 0.1) {
              const loser = (patterns[i].score ?? 0) >= (patterns[j].score ?? 0)
                ? patterns[j] : patterns[i];
              await updatePatternState(loser.id, 'archived');
              archived.add(loser.id);
            }
          }
        }
      }
    }
  }
}

async function patternUsageAnalytics(): Promise<void> {
  if (!isSupabaseEnabled()) return;
  console.log('[JOBS] Running pattern usage analytics...');

  const { data: agents } = await supabase!
    .from('learned_patterns')
    .select('agent_id')
    .eq('pattern_type', 'task')
    .not('pattern_state', 'eq', 'archived');

  if (!agents) return;

  const agentIds = [...new Set(agents.map((a: any) => a.agent_id))];

  for (const agentId of agentIds) {
    await checkPatternHealth(agentId);
  }
}

export function initLearningJobs(): void {
  // Daily at 2:00 AM
  cron.schedule('0 2 * * *', () => {
    runWithLock('cluster-merging', clusterMerging);
    runWithLock('pattern-consolidation', patternConsolidation);
    runWithLock('pattern-usage', patternUsageAnalytics);
  });

  // Hourly health monitor
  cron.schedule('0 * * * *', () => {
    runWithLock('pattern-health', patternUsageAnalytics);
  });

  console.log('[JOBS] Learning background jobs scheduled');
}
