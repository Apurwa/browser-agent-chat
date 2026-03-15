import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import {
  createCredential,
  getCredential,
  listCredentials,
  updateCredential,
  deleteCredential,
  rotateCredential,
  bindToAgent,
  unbindFromAgent,
  getAgentCredentials,
} from '../vault.js';

const router = Router();

// List all credentials for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const credentials = await listCredentials(userId);
  res.json(credentials);
});

// Get a single credential
router.get('/:id', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const credential = await getCredential(req.params.id, userId);
  if (!credential) return res.status(404).json({ error: 'Credential not found' });
  res.json(credential);
});

// Create a new credential
router.post('/', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { label, credential_type, secret, metadata, domains } = req.body;

  if (!label || !secret) {
    return res.status(400).json({ error: 'label and secret are required' });
  }

  const credential = await createCredential(
    userId,
    label,
    credential_type ?? 'username_password',
    secret,
    metadata ?? {},
    domains ?? [],
  );

  if (!credential) return res.status(500).json({ error: 'Failed to create credential' });
  res.status(201).json(credential);
});

// Update a credential (label, metadata, domains only — not the secret)
router.put('/:id', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { label, metadata, domains } = req.body;
  const updated = await updateCredential(req.params.id, userId, { label, metadata, domains });
  if (!updated) return res.status(404).json({ error: 'Credential not found' });
  res.json(updated);
});

// Soft-delete a credential
router.delete('/:id', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  await deleteCredential(req.params.id, userId);
  res.status(204).end();
});

// Rotate credential secret (change password / API key)
router.put('/:id/secret', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const { secret } = req.body;
  if (!secret) return res.status(400).json({ error: 'secret is required' });
  await rotateCredential(req.params.id, userId, secret);
  res.status(204).end();
});

// Bind credential to agent (verifies credential ownership)
router.post('/:id/bind/:agentId', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  // Verify the authenticated user owns this credential
  const credential = await getCredential(req.params.id, userId);
  if (!credential) return res.status(404).json({ error: 'Credential not found' });
  const { usage_context, priority } = req.body ?? {};
  await bindToAgent(req.params.id, req.params.agentId, usage_context, priority);
  res.status(201).json({ ok: true });
});

// Unbind credential from agent (verifies credential ownership)
router.delete('/:id/bind/:agentId', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const credential = await getCredential(req.params.id, userId);
  if (!credential) return res.status(404).json({ error: 'Credential not found' });
  await unbindFromAgent(req.params.id, req.params.agentId);
  res.status(204).end();
});

export default router;

// Agent-scoped credential listing — mounted at /api/agents/:id/credentials
export const agentCredentialsRouter = Router({ mergeParams: true });

agentCredentialsRouter.get('/', requireAuth, async (req, res) => {
  const agentId = req.params.id;
  const credentials = await getAgentCredentials(agentId);
  res.json(credentials);
});
