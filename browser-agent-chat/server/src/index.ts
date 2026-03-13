import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import 'dotenv/config';

import projectsRouter from './routes/projects.js';
import findingsRouter from './routes/findings.js';
import memoryRouter from './routes/memory.js';
import suggestionsRouter from './routes/suggestions.js';
import { createAgent, executeTask, executeExplore, executeLogin } from './agent.js';
import { getProject, createSession } from './db.js';
import { decryptCredentials } from './crypto.js';
import { isSupabaseEnabled } from './supabase.js';
import * as sessionPool from './sessionPool.js';
import * as browserPool from './browserPool.js';
import { createHeyGenToken, isHeyGenEnabled } from './heygen.js';
import type { ClientMessage, ServerMessage, ChatMessage } from './types.js';

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    supabase: isSupabaseEnabled(),
    heygenEnabled: isHeyGenEnabled(),
    activeSessions: sessionPool.listActiveSessions().length,
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

// WebSocket server
const wss = new WebSocketServer({ server });

// Track which project each client is associated with
const clientProjects = new Map<WebSocket, string>();
// Guard against duplicate start attempts while agent is launching
const startingProjects = new Set<string>();

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

      // If client was attached to another session, detach first
      const prevProjectId = clientProjects.get(ws);
      if (prevProjectId) {
        const prevSession = sessionPool.getSession(prevProjectId);
        if (prevSession) sessionPool.removeClient(prevSession, ws);
        clientProjects.delete(ws);
      }

      // Check if there's already a running session for this project
      const existing = sessionPool.getSession(msg.projectId);
      if (existing) {
        console.log('[START] Reattaching to existing session');
        // Reattach to existing session
        sessionPool.addClient(existing, ws);
        clientProjects.set(ws, msg.projectId);
        sessionPool.sendSnapshot(existing, ws);
        return;
      }

      // Guard: if already starting this project, just wait
      if (startingProjects.has(msg.projectId)) {
        console.log('[START] Already starting, ignoring duplicate');
        ws.send(JSON.stringify({ type: 'status', status: 'working' } as ServerMessage));
        return;
      }

      // Create new session
      startingProjects.add(msg.projectId);
      // Send immediate feedback so user knows it's working
      ws.send(JSON.stringify({ type: 'status', status: 'working' } as ServerMessage));
      const startT0 = Date.now();
      let lastT = startT0;
      const orchSteps: Array<{ name: string; duration: number }> = [];
      const recordStep = (name: string) => {
        const now = Date.now();
        orchSteps.push({ name, duration: now - lastT });
        lastT = now;
      };

      try {
        const project = await getProject(msg.projectId);
        recordStep('db_get_project');
        if (!project) {
          startingProjects.delete(msg.projectId);
          ws.send(JSON.stringify({ type: 'error', message: 'Project not found' } as ServerMessage));
          ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
          return;
        }

        let credentials: { username: string; password: string } | null = null;
        if (project.credentials) {
          try {
            credentials = decryptCredentials(project.credentials);
          } catch (err) {
            console.error('Failed to decrypt credentials:', err);
          }
        }
        recordStep('decrypt_credentials');

        const dbSessionId = await createSession(project.id);
        recordStep('db_create_session');

        // Create broadcast function — sends directly to ws during startup,
        // then through the pool once the session is registered
        const poolBroadcast = (serverMsg: ServerMessage) => {
          const session = sessionPool.getSession(msg.projectId);

          if (!session) {
            // Session not registered yet (during createAgent) — send directly
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(serverMsg));
            }
            return;
          }

          // Track state in pool
          if (serverMsg.type === 'screenshot') {
            sessionPool.updateScreenshot(session, serverMsg.data);
          } else if (serverMsg.type === 'nav') {
            sessionPool.updateUrl(session, serverMsg.url);
          } else if (serverMsg.type === 'status') {
            sessionPool.updateStatus(session, serverMsg.status as any);
          }

          // Store messages for replay
          if (serverMsg.type === 'thought') {
            sessionPool.addMessage(session, makeChatMessage('agent', serverMsg.content));
          } else if (serverMsg.type === 'action') {
            const text = `Action: ${serverMsg.action}${serverMsg.target ? ` → ${serverMsg.target}` : ''}`;
            sessionPool.addMessage(session, makeChatMessage('agent', text));
          } else if (serverMsg.type === 'error') {
            sessionPool.addMessage(session, makeChatMessage('system', `Error: ${serverMsg.message}`));
          } else if (serverMsg.type === 'taskComplete') {
            sessionPool.addMessage(session, makeChatMessage('system', serverMsg.success ? 'Task completed.' : 'Task failed.'));
          } else if (serverMsg.type === 'finding') {
            sessionPool.addMessage(session, { id: crypto.randomUUID(), type: 'finding', content: serverMsg.finding.title, timestamp: Date.now() });
          } else if (serverMsg.type === 'suggestion') {
            const s = serverMsg.suggestion;
            const typeLabel = s.type === 'feature' ? 'feature' : s.type === 'flow' ? 'flow' : 'behavior';
            const name = 'name' in s.data ? (s.data as any).name : (s.data as any).feature_name;
            sessionPool.addMessage(session, makeChatMessage('system', `💡 Learned: "${name}" ${typeLabel}`));
          }

          // Broadcast to all connected clients
          sessionPool.broadcast(session, serverMsg);
        };

        // Use resumeUrl if client was previously on a different page
        const navigateUrl = msg.resumeUrl || project.url;
        const agentSession = await createAgent(
          navigateUrl, poolBroadcast, dbSessionId, project.id
        );
        recordStep('create_agent_total');

        const totalMs = Date.now() - startT0;
        console.log('[METRICS] Full startup:', JSON.stringify({ total: totalMs, steps: orchSteps }));

        // Register session BEFORE login so stop/task/etc can find it
        const pooled = sessionPool.registerSession(msg.projectId, agentSession, dbSessionId);
        sessionPool.addClient(pooled, ws);
        clientProjects.set(ws, msg.projectId);

        // Kick off login as fire-and-forget (non-blocking)
        // Set loginDone so tasks/explore wait for it to complete
        if (credentials) {
          agentSession.loginDone = executeLogin(agentSession, credentials, poolBroadcast).catch(err => {
            console.error('[LOGIN] Background login error:', err);
          });
        }
      } catch (err) {
        console.error('[START] Error creating agent:', err);
        const message = err instanceof Error ? err.message : 'Failed to start agent';
        ws.send(JSON.stringify({ type: 'error', message } as ServerMessage));
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      } finally {
        startingProjects.delete(msg.projectId);
      }

    } else if (msg.type === 'resume') {
      // Detach from previous if needed
      const prevProjectId = clientProjects.get(ws);
      if (prevProjectId && prevProjectId !== msg.projectId) {
        const prevSession = sessionPool.getSession(prevProjectId);
        if (prevSession) sessionPool.removeClient(prevSession, ws);
      }

      const session = sessionPool.getSession(msg.projectId);
      if (session) {
        sessionPool.addClient(session, ws);
        clientProjects.set(ws, msg.projectId);
        sessionPool.sendSnapshot(session, ws);
      } else {
        // No active session — tell client
        ws.send(JSON.stringify({ type: 'status', status: 'disconnected' } as ServerMessage));
      }

    } else if (msg.type === 'task') {
      const projectId = clientProjects.get(ws);
      if (!projectId) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session. Start an agent first.' } as ServerMessage));
        return;
      }

      const session = sessionPool.getSession(projectId);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired. Please restart the agent.' } as ServerMessage));
        return;
      }

      // Store user message
      sessionPool.addMessage(session, makeChatMessage('user', msg.content));

      // Broadcast function for task goes through the pool's existing broadcast
      const taskBroadcast = (serverMsg: ServerMessage) => {
        const s = sessionPool.getSession(projectId);
        if (!s) return;

        if (serverMsg.type === 'screenshot') {
          sessionPool.updateScreenshot(s, serverMsg.data);
        } else if (serverMsg.type === 'nav') {
          sessionPool.updateUrl(s, serverMsg.url);
        } else if (serverMsg.type === 'status') {
          sessionPool.updateStatus(s, serverMsg.status as any);
        }

        if (serverMsg.type === 'thought') {
          sessionPool.addMessage(s, makeChatMessage('agent', serverMsg.content));
        } else if (serverMsg.type === 'action') {
          const text = `Action: ${serverMsg.action}${serverMsg.target ? ` → ${serverMsg.target}` : ''}`;
          sessionPool.addMessage(s, makeChatMessage('agent', text));
        } else if (serverMsg.type === 'error') {
          sessionPool.addMessage(s, makeChatMessage('system', `Error: ${serverMsg.message}`));
        } else if (serverMsg.type === 'taskComplete') {
          sessionPool.addMessage(s, makeChatMessage('system', serverMsg.success ? 'Task completed.' : 'Task failed.'));
        } else if (serverMsg.type === 'finding') {
          sessionPool.addMessage(s, { id: crypto.randomUUID(), type: 'finding', content: serverMsg.finding.title, timestamp: Date.now() });
        } else if (serverMsg.type === 'suggestion') {
          const sg = serverMsg.suggestion;
          const typeLabel = sg.type === 'feature' ? 'feature' : sg.type === 'flow' ? 'flow' : 'behavior';
          const name = 'name' in sg.data ? (sg.data as any).name : (sg.data as any).feature_name;
          sessionPool.addMessage(s, makeChatMessage('system', `💡 Learned: "${name}" ${typeLabel}`));
        }

        sessionPool.broadcast(s, serverMsg);
      };

      executeTask(session.agentSession, msg.content, taskBroadcast);

    } else if (msg.type === 'stop') {
      const projectId = clientProjects.get(ws);
      if (projectId) {
        await sessionPool.destroySession(projectId);
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

      const session = sessionPool.getSession(projectId);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Session expired.' } as ServerMessage));
        return;
      }

      const project = await getProject(msg.projectId);
      if (!project) {
        ws.send(JSON.stringify({ type: 'error', message: 'Project not found.' } as ServerMessage));
        return;
      }

      // Log explore start in chat history
      sessionPool.addMessage(session, makeChatMessage('system', 'Explore & Learn started...'));

      // Reuse the task broadcast pattern
      const exploreBroadcast = (serverMsg: ServerMessage) => {
        const s = sessionPool.getSession(projectId);
        if (!s) return;
        if (serverMsg.type === 'screenshot') sessionPool.updateScreenshot(s, serverMsg.data);
        else if (serverMsg.type === 'nav') sessionPool.updateUrl(s, serverMsg.url);
        else if (serverMsg.type === 'status') sessionPool.updateStatus(s, serverMsg.status as any);

        if (serverMsg.type === 'thought') sessionPool.addMessage(s, makeChatMessage('agent', serverMsg.content));
        else if (serverMsg.type === 'action') sessionPool.addMessage(s, makeChatMessage('agent', `Action: ${serverMsg.action}${serverMsg.target ? ` → ${serverMsg.target}` : ''}`));
        else if (serverMsg.type === 'error') sessionPool.addMessage(s, makeChatMessage('system', `Error: ${serverMsg.message}`));
        else if (serverMsg.type === 'taskComplete') sessionPool.addMessage(s, makeChatMessage('system', serverMsg.success ? 'Exploration completed.' : 'Exploration failed.'));
        else if (serverMsg.type === 'finding') sessionPool.addMessage(s, { id: crypto.randomUUID(), type: 'finding', content: serverMsg.finding.title, timestamp: Date.now() });
        else if (serverMsg.type === 'suggestion') {
          const sg = serverMsg.suggestion;
          const name = 'name' in sg.data ? (sg.data as any).name : (sg.data as any).feature_name;
          sessionPool.addMessage(s, makeChatMessage('system', `💡 Learned: "${name}" ${sg.type}`));
        }

        sessionPool.broadcast(s, serverMsg);
      };

      executeExplore(session.agentSession, project?.context || null, exploreBroadcast);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const projectId = clientProjects.get(ws);
    if (projectId) {
      const session = sessionPool.getSession(projectId);
      if (session) {
        sessionPool.removeClient(session, ws);
      }
      clientProjects.delete(ws);
    }
  });
});

const PORT = parseInt(process.env.PORT || '3001');
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('WebSocket server ready');
  // Pre-warm a browser so first agent start is fast
  browserPool.warmUp().catch(() => {});
});
