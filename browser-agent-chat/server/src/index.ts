import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import 'dotenv/config';

import agentsRouter from './routes/agents.js';
import findingsRouter from './routes/findings.js';
import memoryRouter from './routes/memory.js';
import suggestionsRouter from './routes/suggestions.js';
import evalsRouter from './routes/evals.js';
import mapRouter from './routes/map.js';
import vaultRouter, { agentCredentialsRouter } from './routes/vault.js';
import { executeTask, executeExplore, handleLoginDetection } from './agent.js';
import { getAgent, createSession, createTask, updateTask } from './db.js';
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
app.use('/api/agents', agentsRouter);
app.use('/api/agents/:id/findings', findingsRouter);
app.use('/api/agents/:id/memory', memoryRouter);
app.use('/api/agents/:id/suggestions', suggestionsRouter);
app.use('/api/agents/:id/evals', evalsRouter);
app.use('/api/agents/:id/map', mapRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/agents/:id/credentials', agentCredentialsRouter);

// WebSocket server
const wss = new WebSocketServer({ server });

// Track which agent each client is associated with
const clientAgents = new Map<WebSocket, string>();

// Track active tasks per agent
const activeTasks = new Map<string, { taskId: string; stepCount: number }>();

// Broadcast a ServerMessage to all WebSocket clients connected to an agent.
// Used by eval routes and any future server-initiated push.
export function broadcastToAgent(agentId: string, msg: ServerMessage): void {
  for (const [client, aid] of clientAgents) {
    if (aid === agentId && client.readyState === WebSocket.OPEN) {
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
      console.log('[START] Starting agent for:', msg.agentId);

      const prevAgentId = clientAgents.get(ws);
      if (prevAgentId) {
        sessionManager.removeClient(prevAgentId, ws);
        clientAgents.delete(ws);
      }

      const hasExisting = await sessionManager.hasSession(msg.agentId);
      if (hasExisting && sessionManager.getAgent(msg.agentId)) {
        console.log('[START] Reattaching to existing session');
        sessionManager.addClient(msg.agentId, ws);
        clientAgents.set(ws, msg.agentId);
        await sessionManager.sendSnapshot(msg.agentId, ws);
        return;
      }

      ws.send(JSON.stringify({ type: 'status', status: 'working' } as ServerMessage));

      // Register client→agent mapping early so viewport messages
      // arriving during async agent creation can find the agent.
      clientAgents.set(ws, msg.agentId);

      try {
        const agent = await getAgent(msg.agentId);
        if (!agent) {
          clientAgents.delete(ws);
          ws.send(JSON.stringify({ type: 'error', message: 'Agent not found' } as ServerMessage));
          ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
          return;
        }

        let credentials: { username: string; password: string } | null = null;
        if (agent.credentials) {
          try { credentials = decryptCredentials(agent.credentials); } catch {}
        }

        const dbSessionId = await createSession(agent.id);

        const agentSession = await sessionManager.createSession(
          msg.agentId, msg.resumeUrl || agent.url, dbSessionId
        );

        sessionManager.addClient(msg.agentId, ws);

        // Tell client the agent is ready
        ws.send(JSON.stringify({ type: 'status', status: 'idle' } as ServerMessage));

        {
          const loginBroadcast = sessionManager.makeBroadcast(msg.agentId);
          const loginPage = agentSession.connector.getHarness().page;
          agentSession.loginDone = handleLoginDetection(loginPage, msg.agentId, agent.user_id, loginBroadcast).catch((err: unknown) => {
            console.error('[LOGIN] Background login error:', err);
          });
        }
      } catch (err) {
        console.error('[START] Error creating agent:', err);
        clientAgents.delete(ws);
        const message = err instanceof Error ? err.message : 'Failed to start agent';
        ws.send(JSON.stringify({ type: 'error', message } as ServerMessage));
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      }

    } else if (msg.type === 'resume') {
      const prevAgentId = clientAgents.get(ws);
      if (prevAgentId && prevAgentId !== msg.agentId) {
        sessionManager.removeClient(prevAgentId, ws);
      }

      const exists = await sessionManager.hasSession(msg.agentId);
      if (exists) {
        sessionManager.addClient(msg.agentId, ws);
        clientAgents.set(ws, msg.agentId);
        await sessionManager.sendSnapshot(msg.agentId, ws);
      } else {
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      }

    } else if (msg.type === 'task') {
      const agentId = clientAgents.get(ws);
      if (!agentId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Start an agent first.' } as ServerMessage));
        return;
      }

      const agentSession = sessionManager.getAgent(agentId);
      if (!agentSession) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired. Please restart the agent.' } as ServerMessage));
        return;
      }

      const userMsg = makeChatMessage('user', msg.content);
      redisStore.pushMessage(agentId, userMsg).catch(() => {});

      redisStore.setSession(agentId, { lastTask: msg.content }).catch(() => {});

      // Create task record
      if (agentSession.sessionId) {
        try {
          const taskId = await createTask(agentSession.sessionId, agentId, msg.content);
          activeTasks.set(agentId, { taskId, stepCount: 0 });
          broadcastToAgent(agentId, { type: 'taskStarted', taskId });
        } catch (err) {
          console.error('[TASK] Failed to create task:', err);
        }
      }

      const baseBroadcast = sessionManager.makeBroadcast(agentId);
      const taskBroadcast = (broadcastMsg: ServerMessage) => {
        // Intercept taskComplete to update task record
        if (broadcastMsg.type === 'taskComplete') {
          const activeTask = activeTasks.get(agentId);
          if (activeTask) {
            const success = broadcastMsg.success;
            updateTask(activeTask.taskId, {
              status: success ? 'completed' : 'failed',
              success,
              completed_at: new Date().toISOString(),
            }).catch(err => console.error('[TASK] Failed to update task:', err));
            activeTasks.delete(agentId);
          }
        }
        baseBroadcast(broadcastMsg);
      };
      executeTask(agentSession, msg.content, taskBroadcast);

    } else if (msg.type === 'stop') {
      const agentId = clientAgents.get(ws);
      if (agentId) {
        // Cancel any active task
        const activeTask = activeTasks.get(agentId);
        if (activeTask) {
          updateTask(activeTask.taskId, { status: 'cancelled', completed_at: new Date().toISOString() })
            .catch(err => console.error('[TASK] Failed to cancel task:', err));
          activeTasks.delete(agentId);
        }

        await sessionManager.destroySession(agentId);
        for (const [client, aid] of clientAgents) {
          if (aid === agentId) clientAgents.delete(client);
        }
      }
    } else if (msg.type === 'explore') {
      const agentId = clientAgents.get(ws);
      if (!agentId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Send start first.' } as ServerMessage));
        return;
      }
      if (agentId !== msg.agentId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Agent ID mismatch with active session.' } as ServerMessage));
        return;
      }

      const agentSession = sessionManager.getAgent(agentId);
      if (!agentSession) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired.' } as ServerMessage));
        return;
      }

      const agent = await getAgent(msg.agentId);
      if (!agent) {
        ws.send(JSON.stringify({ type: 'error', message: 'Agent not found.' } as ServerMessage));
        return;
      }

      broadcastToAgent(agentId, { type: 'status', status: 'working' });

      const exploreMsg = makeChatMessage('system', 'Explore & Learn started...');
      redisStore.pushMessage(agentId, exploreMsg).catch(() => {});

      const exploreBroadcast = sessionManager.makeBroadcast(agentId);
      executeExplore(agentSession, agent?.context || null, exploreBroadcast);

    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const agentId = clientAgents.get(ws);
    if (agentId) {
      sessionManager.removeClient(agentId, ws);
      clientAgents.delete(ws);
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
