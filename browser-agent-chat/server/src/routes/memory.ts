import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  listFeatures, createFeature, updateFeature, deleteFeature,
  createFlow, updateFlow, deleteFlow,
} from '../db.js';
import type { CreateFeatureRequest, CreateFlowRequest } from '../types.js';

const router = Router({ mergeParams: true }); // mergeParams to access :id from parent

// List features (with nested flows)
router.get('/features', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const features = await listFeatures(agentId);
  res.json({ features });
});

// Create feature
router.post('/features', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const body = req.body as CreateFeatureRequest;
  if (!body.name || !body.criticality) {
    res.status(400).json({ error: 'name and criticality are required' });
    return;
  }
  const feature = await createFeature(
    agentId, body.name, body.description ?? null,
    body.criticality, body.expected_behaviors ?? []
  );
  if (!feature) { res.status(500).json({ error: 'Failed to create feature' }); return; }
  res.status(201).json({ feature });
});

// Update feature
router.put('/features/:featureId', requireAuth, async (req, res) => {
  const featureId = req.params.featureId as string;
  const feature = await updateFeature(featureId, req.body);
  if (!feature) { res.status(404).json({ error: 'Feature not found' }); return; }
  res.json({ feature });
});

// Delete feature
router.delete('/features/:featureId', requireAuth, async (req, res) => {
  const featureId = req.params.featureId as string;
  const success = await deleteFeature(featureId);
  if (!success) { res.status(404).json({ error: 'Feature not found' }); return; }
  res.status(204).send();
});

// List flows for a feature
router.get('/features/:featureId/flows', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const featureId = req.params.featureId as string;
  const features = await listFeatures(agentId);
  const feature = features.find(f => f.id === featureId);
  if (!feature) { res.status(404).json({ error: 'Feature not found' }); return; }
  res.json({ flows: feature.flows ?? [] });
});

// Create flow under a feature
router.post('/features/:featureId/flows', requireAuth, async (req, res) => {
  const agentId = req.params.id as string;
  const featureId = req.params.featureId as string;
  const body = req.body as CreateFlowRequest;
  if (!body.name || !body.criticality) {
    res.status(400).json({ error: 'name and criticality are required' });
    return;
  }
  const flow = await createFlow(
    featureId, agentId,
    body.name, body.steps ?? [], body.checkpoints ?? [], body.criticality
  );
  if (!flow) { res.status(500).json({ error: 'Failed to create flow' }); return; }
  res.status(201).json({ flow });
});

// Update flow
router.put('/flows/:flowId', requireAuth, async (req, res) => {
  const flowId = req.params.flowId as string;
  const flow = await updateFlow(flowId, req.body);
  if (!flow) { res.status(404).json({ error: 'Flow not found' }); return; }
  res.json({ flow });
});

// Delete flow
router.delete('/flows/:flowId', requireAuth, async (req, res) => {
  const flowId = req.params.flowId as string;
  const success = await deleteFlow(flowId);
  if (!success) { res.status(404).json({ error: 'Flow not found' }); return; }
  res.status(204).send();
});

export default router;
