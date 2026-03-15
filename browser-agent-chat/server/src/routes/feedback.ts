import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  listTaskFeedback, listActivePatterns, getPatternStats,
  getLearningPoolStats, listTaskClusters, deletePattern,
  updatePatternState,
} from '../db.js';
import { supabase, isSupabaseEnabled } from '../supabase.js';
import type { PatternState } from '../types.js';

const router = Router({ mergeParams: true });

// POST /api/agents/:id/feedback — submit task feedback (REST fallback)
router.post('/', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const { task_id, rating, correction } = req.body;

  if (!task_id || !rating) {
    res.status(400).json({ error: 'task_id and rating are required' });
    return;
  }

  if (!['positive', 'negative'].includes(rating)) {
    res.status(400).json({ error: 'rating must be positive or negative' });
    return;
  }

  // Look up the task prompt from the DB so embeddings are meaningful
  let taskPrompt = '';
  if (isSupabaseEnabled()) {
    const { data } = await supabase!.from('tasks').select('prompt').eq('id', task_id).single();
    if (data?.prompt) taskPrompt = data.prompt;
  }

  const { processFeedback } = await import('../learning/pipeline.js');
  await processFeedback(
    agentId, task_id, null, taskPrompt, rating, correction ?? null,
    () => {}, // No broadcast for REST
  );

  res.status(201).json({ ok: true });
});

// GET /api/agents/:id/feedback — list feedback
router.get('/', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const rating = req.query.rating as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  const feedback = await listTaskFeedback(agentId, {
    rating: rating as any,
    limit,
  });
  res.json({ feedback });
});

// GET /api/agents/:id/feedback/patterns — list learned patterns
router.get('/patterns', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const patterns = await listActivePatterns(agentId, 'task');
  res.json({ patterns });
});

// PATCH /api/agents/:id/feedback/patterns/:pid — update pattern state
router.patch('/patterns/:pid', requireAuth, async (req, res) => {
  const patternId = req.params.pid as string;
  const { pattern_state } = req.body;
  if (!pattern_state || !['stale', 'archived'].includes(pattern_state)) {
    res.status(400).json({ error: 'pattern_state must be stale or archived' });
    return;
  }
  await updatePatternState(patternId, pattern_state as PatternState);
  res.json({ ok: true });
});

// DELETE /api/agents/:id/feedback/patterns/:pid — delete pattern (unteach)
router.delete('/patterns/:pid', requireAuth, async (req, res) => {
  const patternId = req.params.pid as string;
  const success = await deletePattern(patternId);
  if (!success) { res.status(404).json({ error: 'Pattern not found' }); return; }
  res.json({ ok: true });
});

// GET /api/agents/:id/feedback/stats — learning stats
router.get('/stats', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const [patternStats, poolStats, clusters] = await Promise.all([
    getPatternStats(agentId),
    getLearningPoolStats(agentId),
    listTaskClusters(agentId),
  ]);
  res.json({
    patterns: patternStats,
    pool: poolStats,
    clusters: { count: clusters.length },
  });
});

export default router;
