import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  listPendingSuggestions,
  getPendingSuggestionCount,
  acceptSuggestion,
  dismissSuggestion,
  updateSuggestionData,
  bulkAcceptSuggestions,
  bulkDismissSuggestions,
} from '../db.js';

const router = Router({ mergeParams: true });

// GET /api/projects/:id/suggestions
router.get('/', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const suggestions = await listPendingSuggestions(agentId);
  res.json(suggestions);
});

// GET /api/projects/:id/suggestions/count
router.get('/count', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const count = await getPendingSuggestionCount(agentId);
  res.json({ count });
});

// PUT /api/projects/:id/suggestions/:suggestionId/accept
router.put('/:suggestionId/accept', requireAuth, async (req, res) => {
  const suggestionId = req.params.suggestionId as string;
  const ok = await acceptSuggestion(suggestionId);
  if (!ok) { res.status(500).json({ error: 'Failed to accept suggestion' }); return; }
  res.json({ success: true });
});

// PUT /api/projects/:id/suggestions/:suggestionId/dismiss
router.put('/:suggestionId/dismiss', requireAuth, async (req, res) => {
  const suggestionId = req.params.suggestionId as string;
  const ok = await dismissSuggestion(suggestionId);
  if (!ok) { res.status(500).json({ error: 'Failed to dismiss suggestion' }); return; }
  res.json({ success: true });
});

// PUT /api/projects/:id/suggestions/:suggestionId — edit data before accept
router.put('/:suggestionId', requireAuth, async (req, res) => {
  const suggestionId = req.params.suggestionId as string;
  const { data } = req.body;
  if (!data) { res.status(400).json({ error: 'data is required' }); return; }
  const updated = await updateSuggestionData(suggestionId, data);
  if (!updated) { res.status(500).json({ error: 'Failed to update suggestion' }); return; }
  res.json(updated);
});

// POST /api/projects/:id/suggestions/accept-all
router.post('/accept-all', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const count = await bulkAcceptSuggestions(agentId);
  res.json({ accepted: count });
});

// POST /api/projects/:id/suggestions/dismiss-all
router.post('/dismiss-all', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const ok = await bulkDismissSuggestions(agentId);
  res.json({ success: ok });
});

export default router;
