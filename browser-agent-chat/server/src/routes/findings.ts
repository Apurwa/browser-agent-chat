import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { listFindings, updateFindingStatus } from '../db.js';
import type { FindingType, Criticality, FindingStatus } from '../types.js';

const router = Router({ mergeParams: true });

// List findings with filters
router.get('/', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const filters: { type?: FindingType; severity?: Criticality; status?: FindingStatus } = {};
  if (req.query.type) filters.type = req.query.type as FindingType;
  if (req.query.severity) filters.severity = req.query.severity as Criticality;
  if (req.query.status) filters.status = req.query.status as FindingStatus;

  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;

  const result = await listFindings(agentId, filters, limit, offset);
  res.json(result);
});

// Update finding status
router.put('/:findingId', requireAuth, async (req, res) => {
  const findingId = req.params.findingId as string;
  const { status } = req.body as { status: FindingStatus };
  if (!status || !['new', 'confirmed', 'dismissed'].includes(status)) {
    res.status(400).json({ error: 'Valid status required: new, confirmed, dismissed' });
    return;
  }
  const finding = await updateFindingStatus(findingId, status);
  if (!finding) { res.status(404).json({ error: 'Finding not found' }); return; }
  res.json({ finding });
});

export default router;
