import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import 'dotenv/config';

import { createAgent, executeTask, type AgentSession } from './agent.js';
import type { ClientMessage, ServerMessage } from './types.js';
import { createSession, endSession, getSessionHistory, listSessions } from './db.js';
import { isSupabaseEnabled, verifyToken, type AuthenticatedUser } from './supabase.js';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', supabaseEnabled: isSupabaseEnabled() });
});

async function authenticateRequest(req: express.Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  return verifyToken(token);
}

// REST endpoints for session history
app.get('/api/sessions', async (req, res) => {
  try {
    let userId: string | undefined;
    if (process.env.ALLOWED_GITHUB_USERS) {
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      userId = user.id;
    }
    const sessions = await listSessions(50, userId);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    let userId: string | undefined;
    if (process.env.ALLOWED_GITHUB_USERS) {
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      userId = user.id;
    }
    const history = await getSessionHistory(req.params.sessionId, userId);
    if (!history.session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch session history' });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Store active session per client
const sessions = new Map<WebSocket, AgentSession>();

wss.on('connection', async (ws, req) => {
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
    // If allowlist is configured but no token provided, reject
    ws.close(4001, 'Unauthorized: token required');
    return;
  }

  console.log('Client connected');

  // Broadcast function for this client
  const broadcast = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  ws.on('message', async (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'start': {
          // Close existing session if any
          const existingSession = sessions.get(ws);
          if (existingSession) {
            // End the database session
            if (existingSession.sessionId) {
              await endSession(existingSession.sessionId);
            }
            await existingSession.close();
            sessions.delete(ws);
          }

          // Create new agent session
          try {
            // Create database session first
            const dbSessionId = await createSession(message.url, authenticatedUser?.id || null);
            const session = await createAgent(message.url, broadcast, dbSessionId, authenticatedUser?.id || null);
            sessions.set(ws, session);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to start agent';
            broadcast({ type: 'error', message: errorMsg });
            broadcast({ type: 'status', status: 'error' });
          }
          break;
        }

        case 'task': {
          const session = sessions.get(ws);
          if (!session) {
            broadcast({ type: 'error', message: 'No active session. Please start an agent first.' });
            return;
          }

          await executeTask(session, message.content, broadcast);
          break;
        }

        case 'stop': {
          const session = sessions.get(ws);
          if (session) {
            // End the database session
            if (session.sessionId) {
              await endSession(session.sessionId);
            }
            await session.close();
            sessions.delete(ws);
          }
          // Always send disconnected status when stop is requested
          broadcast({ type: 'status', status: 'disconnected' });
          break;
        }

        default:
          console.warn('Unknown message type:', message);
      }
    } catch (err) {
      console.error('Error processing message:', err);
      broadcast({ type: 'error', message: 'Failed to process message' });
    }
  });

  ws.on('close', async () => {
    console.log('Client disconnected');
    const session = sessions.get(ws);
    if (session) {
      // End the database session
      if (session.sessionId) {
        await endSession(session.sessionId);
      }
      await session.close();
      sessions.delete(ws);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);
});
