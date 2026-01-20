import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import 'dotenv/config';

import { createAgent, executeTask, type AgentSession } from './agent.js';
import type { ClientMessage, ServerMessage } from './types.js';
import { createSession, endSession, getSessionHistory, listSessions } from './db.js';
import { isSupabaseEnabled } from './supabase.js';

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

// REST endpoints for session history
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await listSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const history = await getSessionHistory(req.params.sessionId);
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

wss.on('connection', (ws) => {
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
            const dbSessionId = await createSession(message.url);
            const session = await createAgent(message.url, broadcast, dbSessionId);
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
