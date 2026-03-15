import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import {
  isLangfuseEnabled,
  fetchObservabilitySummary,
  fetchObservabilityTrends,
  fetchObservabilityAgents,
} from '../langfuse.js';
import { supabase } from '../supabase.js';

const router = Router();

/** Resolve agentId → agentName map from Supabase */
async function getAgentNames(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!supabase) return map;

  const { data } = await supabase
    .from('agents')
    .select('id, name')
    .eq('user_id', userId);

  if (data) {
    for (const row of data) {
      map.set(row.id, row.name);
    }
  }
  return map;
}

/** Default date range: last 30 days */
function parseDateRange(query: { from?: string; to?: string }): { from: string; to: string } {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Swap if from > to
  if (from > to) {
    return { from: to.toISOString(), to: from.toISOString() };
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

// GET /api/observability/summary
router.get('/summary', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  try {
    const { from, to } = parseDateRange(req.query as { from?: string; to?: string });
    const summary = await fetchObservabilitySummary(from, to);
    res.json(summary);
  } catch (err) {
    console.error('[OBSERVABILITY] Summary error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch summary';
    res.status(500).json({ error: message });
  }
});

// GET /api/observability/trends
router.get('/trends', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  try {
    const { from, to } = parseDateRange(req.query as { from?: string; to?: string });
    const userId = (req as AuthenticatedRequest).userId;
    const agentNames = await getAgentNames(userId);
    const trends = await fetchObservabilityTrends(from, to, agentNames);
    res.json(trends);
  } catch (err) {
    console.error('[OBSERVABILITY] Trends error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch trends';
    res.status(500).json({ error: message });
  }
});

// GET /api/observability/agents
router.get('/agents', requireAuth, async (req, res) => {
  if (!isLangfuseEnabled()) {
    res.status(503).json({ error: 'Langfuse is not configured' });
    return;
  }

  try {
    const { from, to } = parseDateRange(req.query as { from?: string; to?: string });
    const userId = (req as AuthenticatedRequest).userId;
    const agentNames = await getAgentNames(userId);
    const agents = await fetchObservabilityAgents(from, to, agentNames);
    res.json({ agents });
  } catch (err) {
    console.error('[OBSERVABILITY] Agents error:', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch agent metrics';
    res.status(500).json({ error: message });
  }
});

export default router;
