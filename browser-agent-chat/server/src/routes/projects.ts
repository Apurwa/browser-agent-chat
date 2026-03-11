import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import { encryptCredentials } from '../crypto.js';
import {
  createProject, getProject, listProjects, updateProject, deleteProject,
} from '../db.js';
import type { CreateProjectRequest, ProjectResponse, ProjectListItem } from '../types.js';

const router = Router();

// List user's projects
router.get('/', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const projects = await listProjects(userId);
  const items: ProjectListItem[] = projects.map(p => ({
    id: p.id,
    name: p.name,
    url: p.url,
    hasCredentials: p.credentials !== null,
    context: p.context,
    created_at: p.created_at,
    updated_at: p.updated_at,
    findings_count: 0, // TODO: join with findings count
    last_session_at: null, // TODO: join with latest session
  }));
  res.json({ projects: items });
});

// Create project
router.post('/', requireAuth, async (req, res) => {
  const { userId } = req as AuthenticatedRequest;
  const body = req.body as CreateProjectRequest;

  if (!body.name || !body.url) {
    res.status(400).json({ error: 'name and url are required' });
    return;
  }

  const encrypted = body.credentials ? encryptCredentials(body.credentials) : null;
  const project = await createProject(userId, body.name, body.url, encrypted, body.context ?? null);

  if (!project) {
    res.status(500).json({ error: 'Failed to create project' });
    return;
  }

  const response: ProjectResponse = {
    id: project.id,
    name: project.name,
    url: project.url,
    hasCredentials: project.credentials !== null,
    context: project.context,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
  res.status(201).json(response);
});

// Get project details
router.get('/:id', requireAuth, async (req, res) => {
  const projectId = req.params.id as string;
  const project = await getProject(projectId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const response: ProjectResponse = {
    id: project.id,
    name: project.name,
    url: project.url,
    hasCredentials: project.credentials !== null,
    context: project.context,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
  res.json(response);
});

// Update project
router.put('/:id', requireAuth, async (req, res) => {
  const projectId = req.params.id as string;
  const updates: Record<string, unknown> = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.url) updates.url = req.body.url;
  if (req.body.context !== undefined) updates.context = req.body.context;
  if (req.body.credentials) updates.credentials = encryptCredentials(req.body.credentials);

  const project = await updateProject(projectId, updates);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  res.json({
    id: project.id, name: project.name, url: project.url,
    hasCredentials: project.credentials !== null,
    context: project.context, created_at: project.created_at, updated_at: project.updated_at,
  });
});

// Delete project
router.delete('/:id', requireAuth, async (req, res) => {
  const projectId = req.params.id as string;
  const success = await deleteProject(projectId);
  if (!success) { res.status(404).json({ error: 'Project not found' }); return; }
  res.status(204).send();
});

export default router;
