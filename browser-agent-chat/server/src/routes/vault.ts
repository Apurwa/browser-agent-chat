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
import { getAgent } from '../db.js';

const router = Router();

// List all credentials for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const credentials = await listCredentials(userId);
    res.json(credentials);
  } catch (err) {
    console.error('GET /vault error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single credential
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = req.params.id as string;
    const credential = await getCredential(id, userId);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    res.json(credential);
  } catch (err) {
    console.error('GET /vault/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new credential
router.post('/', requireAuth, async (req, res) => {
  try {
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
  } catch (err) {
    console.error('POST /vault error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a credential (label, metadata, domains only — not the secret)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = req.params.id as string;
    const { label, metadata, domains } = req.body;
    const updated = await updateCredential(id, userId, { label, metadata, domains });
    if (!updated) return res.status(404).json({ error: 'Credential not found' });
    res.json(updated);
  } catch (err) {
    console.error('PUT /vault/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Soft-delete a credential
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = req.params.id as string;
    await deleteCredential(id, userId);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /vault/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rotate credential secret (change password / API key)
router.put('/:id/secret', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = req.params.id as string;
    const { secret } = req.body;
    if (!secret) return res.status(400).json({ error: 'secret is required' });
    await rotateCredential(id, userId, secret);
    res.status(204).end();
  } catch (err) {
    console.error('PUT /vault/:id/secret error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bind credential to agent (verifies credential ownership)
router.post('/:id/bind/:agentId', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = req.params.id as string;
    const agentId = req.params.agentId as string;
    // Verify the authenticated user owns this credential
    const credential = await getCredential(id, userId);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    const { usage_context, priority } = req.body ?? {};
    await bindToAgent(id, agentId, usage_context, priority);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('POST /vault/:id/bind/:agentId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Unbind credential from agent (verifies credential ownership)
router.delete('/:id/bind/:agentId', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const id = req.params.id as string;
    const agentId = req.params.agentId as string;
    const credential = await getCredential(id, userId);
    if (!credential) return res.status(404).json({ error: 'Credential not found' });
    await unbindFromAgent(id, agentId);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /vault/:id/bind/:agentId error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// Agent-scoped credential listing — mounted at /api/agents/:id/credentials
export const agentCredentialsRouter = Router({ mergeParams: true });

agentCredentialsRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const agentId = req.params.id as string;

    // Verify the authenticated user owns this agent
    const agent = await getAgent(agentId);
    if (!agent || agent.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const credentials = await getAgentCredentials(agentId);
    res.json(credentials);
  } catch (err) {
    console.error('GET /agents/:id/credentials error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
