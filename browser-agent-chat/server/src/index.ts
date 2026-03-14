import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import 'dotenv/config';

import projectsRouter from './routes/projects.js';
import findingsRouter from './routes/findings.js';
import memoryRouter from './routes/memory.js';
import suggestionsRouter from './routes/suggestions.js';
import evalsRouter from './routes/evals.js';
import { executeTask, executeExplore, executeLogin } from './agent.js';
import { getProject, createSession } from './db.js';
import { decryptCredentials } from './crypto.js';
import { isSupabaseEnabled } from './supabase.js';
import * as sessionManager from './sessionManager.js';
import * as redisStore from './redisStore.js';
import * as browserManager from './browserManager.js';
import { createHeyGenToken, isHeyGenEnabled } from './heygen.js';
import { initLangfuse, shutdownLangfuse } from './langfuse.js';
import type { ClientMessage, ServerMessage, ChatMessage } from './types.js';

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Health check
app.get('/health', async (_req, res) => {
  const sessions = await sessionManager.listActiveSessions();
  const redisOk = redisStore.getRedis()?.status === 'ready';
  res.json({
    status: 'ok',
    supabase: isSupabaseEnabled(),
    heygenEnabled: isHeyGenEnabled(),
    redis: redisOk,
    activeSessions: sessions.length,
  });
});

// HeyGen token endpoint
app.post('/api/heygen/token', async (_req, res) => {
  try {
    if (!isHeyGenEnabled()) {
      res.status(503).json({ error: 'HeyGen is not configured' });
      return;
    }
    const tokenData = await createHeyGenToken();
    res.json(tokenData);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate HeyGen token';
    res.status(500).json({ error: message });
  }
});

// REST API routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects/:id/findings', findingsRouter);
app.use('/api/projects/:id/memory', memoryRouter);
app.use('/api/projects/:id/suggestions', suggestionsRouter);
app.use('/api/projects/:id/evals', evalsRouter);

// WebSocket server
const wss = new WebSocketServer({ server });

// Track which project each client is associated with
const clientProjects = new Map<WebSocket, string>();

// Broadcast a ServerMessage to all WebSocket clients connected to a project.
// Used by eval routes and any future server-initiated push.
export function broadcastToProject(projectId: string, msg: ServerMessage): void {
  for (const [client, pid] of clientProjects) {
    if (pid === projectId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  }
}

function makeChatMessage(type: ChatMessage['type'], content: string): ChatMessage {
  return { id: crypto.randomUUID(), type, content, timestamp: Date.now() };
}

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  ws.on('message', async (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    console.log('WS message:', msg.type, JSON.stringify(msg).slice(0, 200));

    if (msg.type === 'ping') {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      return;
    }

    if (msg.type === 'start') {
      console.log('[START] Starting agent for project:', msg.projectId);

      const prevProjectId = clientProjects.get(ws);
      if (prevProjectId) {
        sessionManager.removeClient(prevProjectId, ws);
        clientProjects.delete(ws);
      }

      const hasExisting = await sessionManager.hasSession(msg.projectId);
      if (hasExisting && sessionManager.getAgent(msg.projectId)) {
        console.log('[START] Reattaching to existing session');
        sessionManager.addClient(msg.projectId, ws);
        clientProjects.set(ws, msg.projectId);
        await sessionManager.sendSnapshot(msg.projectId, ws);
        return;
      }

      ws.send(JSON.stringify({ type: 'status', status: 'working' } as ServerMessage));

      // Register client→project mapping early so viewport messages
      // arriving during async agent creation can find the project.
      clientProjects.set(ws, msg.projectId);

      try {
        const project = await getProject(msg.projectId);
        if (!project) {
          clientProjects.delete(ws);
          ws.send(JSON.stringify({ type: 'error', message: 'Project not found' } as ServerMessage));
          ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
          return;
        }

        let credentials: { username: string; password: string } | null = null;
        if (project.credentials) {
          try { credentials = decryptCredentials(project.credentials); } catch {}
        }

        const dbSessionId = await createSession(project.id);

        const agentSession = await sessionManager.createSession(
          msg.projectId, msg.resumeUrl || project.url, dbSessionId
        );

        sessionManager.addClient(msg.projectId, ws);

        if (credentials) {
          const loginBroadcast = sessionManager.makeBroadcast(msg.projectId);
          agentSession.loginDone = executeLogin(agentSession, credentials, loginBroadcast).catch(err => {
            console.error('[LOGIN] Background login error:', err);
          });
        }
      } catch (err) {
        console.error('[START] Error creating agent:', err);
        clientProjects.delete(ws);
        const message = err instanceof Error ? err.message : 'Failed to start agent';
        ws.send(JSON.stringify({ type: 'error', message } as ServerMessage));
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      }

    } else if (msg.type === 'resume') {
      const prevProjectId = clientProjects.get(ws);
      if (prevProjectId && prevProjectId !== msg.projectId) {
        sessionManager.removeClient(prevProjectId, ws);
      }

      const exists = await sessionManager.hasSession(msg.projectId);
      if (exists) {
        sessionManager.addClient(msg.projectId, ws);
        clientProjects.set(ws, msg.projectId);
        await sessionManager.sendSnapshot(msg.projectId, ws);
      } else {
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      }

    } else if (msg.type === 'task') {
      const projectId = clientProjects.get(ws);
      if (!projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Start an agent first.' } as ServerMessage));
        return;
      }

      const agentSession = sessionManager.getAgent(projectId);
      if (!agentSession) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired. Please restart the agent.' } as ServerMessage));
        return;
      }

      const userMsg = makeChatMessage('user', msg.content);
      redisStore.pushMessage(projectId, userMsg).catch(() => {});

      redisStore.setSession(projectId, { lastTask: msg.content }).catch(() => {});

      const taskBroadcast = sessionManager.makeBroadcast(projectId);
      executeTask(agentSession, msg.content, taskBroadcast);

    } else if (msg.type === 'stop') {
      const projectId = clientProjects.get(ws);
      if (projectId) {
        await sessionManager.destroySession(projectId);
        for (const [client, pid] of clientProjects) {
          if (pid === projectId) clientProjects.delete(client);
        }
      }
    } else if (msg.type === 'explore') {
      const projectId = clientProjects.get(ws);
      if (!projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Send start first.' } as ServerMessage));
        return;
      }
      if (projectId !== msg.projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Project ID mismatch with active session.' } as ServerMessage));
        return;
      }

      const agentSession = sessionManager.getAgent(projectId);
      if (!agentSession) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired.' } as ServerMessage));
        return;
      }

      const project = await getProject(msg.projectId);
      if (!project) {
        ws.send(JSON.stringify({ type: 'error', message: 'Project not found.' } as ServerMessage));
        return;
      }

      const exploreMsg = makeChatMessage('system', 'Explore & Learn started...');
      redisStore.pushMessage(projectId, exploreMsg).catch(() => {});

      const exploreBroadcast = sessionManager.makeBroadcast(projectId);
      executeExplore(agentSession, project?.context || null, exploreBroadcast);

    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const projectId = clientProjects.get(ws);
    if (projectId) {
      sessionManager.removeClient(projectId, ws);
      clientProjects.delete(ws);
    }
  });
});

const PORT = parseInt(process.env.PORT || '3001');

async function shutdown(signal: string): Promise<void> {
  console.log(`[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  wss.close();

  // Mark sessions disconnected (browsers survive)
  await sessionManager.shutdownAll();

  // Flush Langfuse traces
  await shutdownLangfuse();

  // Close Redis
  await redisStore.shutdown();

  console.log('[SHUTDOWN] Complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function startup(): Promise<void> {
  console.log('[STARTUP] Initializing Langfuse...');
  initLangfuse();

  console.log('[STARTUP] Connecting to Redis...');
  redisStore.connect();

  console.log('[STARTUP] Cleaning up orphaned warm browsers...');
  await browserManager.cleanupOrphanedWarm();

  console.log('[STARTUP] Recovering sessions...');
  await sessionManager.recoverAllSessions();

  console.log('[STARTUP] Starting expiry polling...');
  redisStore.pollExpiredSessions(sessionManager.handleExpiry);

  console.log('[STARTUP] Warming browser pool...');
  browserManager.warmUp().catch(err =>
    console.error('[STARTUP] Warm-up error:', err)
  );

  server.listen(PORT, () => {
    console.log(`[STARTUP] Server running on http://localhost:${PORT}`);
    console.log('[STARTUP] WebSocket server ready');
  });
}

startup().catch(err => {
  console.error('[STARTUP] Fatal error:', err);
  process.exit(1);
});
