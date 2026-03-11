import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import 'dotenv/config';

import projectsRouter from './routes/projects.js';
import findingsRouter from './routes/findings.js';
import memoryRouter from './routes/memory.js';
import { createAgent, executeTask, type AgentSession } from './agent.js';
import { getProject, createSession, endSession } from './db.js';
import { decryptCredentials } from './crypto.js';
import { isSupabaseEnabled, verifyToken, type AuthenticatedUser } from './supabase.js';
import type { ClientMessage, ServerMessage } from './types.js';

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', supabase: isSupabaseEnabled() });
});

// REST API routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:id/findings', findingsRouter);
app.use('/api/projects/:id/memory', memoryRouter);

// Auth helper
async function authenticateRequest(req: express.Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  return verifyToken(token);
}

// WebSocket server
const wss = new WebSocketServer({ server });
const sessions = new Map<WebSocket, AgentSession>();

wss.on('connection', async (ws: WebSocket, req) => {
  // Extract token from query string
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  let authenticatedUser: AuthenticatedUser | null = null;

  if (token) {
    try {
      authenticatedUser = await verifyToken(token);
      console.log(`Client authenticated: ${authenticatedUser.githubUsername}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      if (message === 'User not in allowlist') {
        ws.close(4003, 'Forbidden: user not in allowlist');
      } else {
        ws.close(4001, 'Unauthorized: invalid token');
      }
      return;
    }
  } else if (process.env.ALLOWED_GITHUB_USERS) {
    ws.close(4001, 'Unauthorized: token required');
    return;
  }

  console.log('Client connected');

  const broadcast = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  ws.on('message', async (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'start') {
      // Close existing session if any
      const existing = sessions.get(ws);
      if (existing) {
        if (existing.sessionId) await endSession(existing.sessionId);
        await existing.close();
        sessions.delete(ws);
      }

      try {
        // Look up project
        const project = await getProject(msg.projectId);
        if (!project) {
          broadcast({ type: 'error', message: 'Project not found' });
          return;
        }

        // Decrypt credentials if available
        let loginUrl = project.url;
        let credentials: { username: string; password: string } | null = null;
        if (project.credentials) {
          try {
            credentials = decryptCredentials(project.credentials);
          } catch (err) {
            console.error('Failed to decrypt credentials:', err);
          }
        }

        // Create DB session
        const sessionId = await createSession(project.id, authenticatedUser?.id || null);

        // Create agent
        const session = await createAgent(
          loginUrl, broadcast, sessionId, project.id, credentials, authenticatedUser?.id || null
        );
        sessions.set(ws, session);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start agent';
        broadcast({ type: 'error', message });
      }
    } else if (msg.type === 'task') {
      const session = sessions.get(ws);
      if (!session) {
        broadcast({ type: 'error', message: 'No active session. Start an agent first.' });
        return;
      }
      // Fire and forget — task runs async, broadcasts progress
      executeTask(session, msg.content, broadcast);
    } else if (msg.type === 'stop') {
      const session = sessions.get(ws);
      if (session) {
        if (session.sessionId) await endSession(session.sessionId);
        await session.close();
        sessions.delete(ws);
        broadcast({ type: 'status', status: 'disconnected' });
      }
    }
  });

  ws.on('close', async () => {
    console.log('Client disconnected');
    const session = sessions.get(ws);
    if (session) {
      if (session.sessionId) await endSession(session.sessionId);
      await session.close();
      sessions.delete(ws);
    }
  });
});

const PORT = parseInt(process.env.PORT || '3001');
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('WebSocket server ready');
});
