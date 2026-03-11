import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { ClientMessage, ServerMessage, AgentStatus, ChatMessage, Finding } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const HEARTBEAT_INTERVAL = 30_000;

interface WebSocketState {
  connected: boolean;
  status: AgentStatus;
  screenshot: string | null;
  currentUrl: string | null;
  messages: ChatMessage[];
  findings: Finding[];
  findingsCount: number;
  activeProjectId: string | null;
  startAgent: (projectId: string) => void;
  resumeSession: (projectId: string) => void;
  sendTask: (content: string) => void;
  stopAgent: () => void;
}

const WebSocketContext = createContext<WebSocketState | null>(null);

export function useWS(): WebSocketState {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWS must be used within WebSocketProvider');
  return ctx;
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Stable ref for the active project so message handlers don't get stale closures
  const activeProjectRef = useRef<string | null>(null);

  const addMessage = useCallback((type: ChatMessage['type'], content: string, finding?: Finding) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      type,
      content,
      timestamp: Date.now(),
      finding,
    }]);
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    let msg: ServerMessage & { type: string; messages?: ChatMessage[] };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'thought':
        addMessage('agent', (msg as any).content);
        break;
      case 'action': {
        const a = msg as any;
        addMessage('agent', `Action: ${a.action}${a.target ? ` → ${a.target}` : ''}`);
        break;
      }
      case 'screenshot':
        setScreenshot(`data:image/png;base64,${(msg as any).data}`);
        break;
      case 'status':
        setStatus((msg as any).status);
        if ((msg as any).status === 'disconnected') {
          setScreenshot(null);
          setCurrentUrl(null);
          setActiveProjectId(null);
          activeProjectRef.current = null;
        }
        break;
      case 'nav':
        setCurrentUrl((msg as any).url);
        break;
      case 'error':
        addMessage('system', `Error: ${(msg as any).message}`);
        break;
      case 'taskComplete':
        addMessage('system', (msg as any).success ? 'Task completed.' : 'Task failed.');
        break;
      case 'finding': {
        const finding = (msg as any).finding as Finding;
        setFindings(prev => [...prev, finding]);
        addMessage('finding', finding.title, finding);
        break;
      }
      case 'memoryUpdate': {
        const mu = msg as any;
        if (mu.feature) addMessage('system', `Learned about feature: ${mu.feature.name}`);
        if (mu.flow) addMessage('system', `Learned about flow: ${mu.flow.name}`);
        break;
      }
      case 'sessionRestore': {
        // Server sent full message history on reconnect
        const restored = (msg as any).messages as ChatMessage[];
        if (restored && restored.length > 0) {
          setMessages(restored);
        }
        break;
      }
      case 'pong':
        // Heartbeat response — no action needed
        break;
    }
  }, [addMessage]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnected(true);

      // Start heartbeat
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_INTERVAL);

      // If we had an active project, try to resume
      if (activeProjectRef.current) {
        ws.send(JSON.stringify({ type: 'resume', projectId: activeProjectRef.current }));
      }
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      setConnected(false);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      // Reconnect with backoff
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, [handleMessage]);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const startAgent = useCallback((projectId: string) => {
    setMessages([]);
    setFindings([]);
    setScreenshot(null);
    setCurrentUrl(null);
    setStatus('disconnected');
    setActiveProjectId(projectId);
    activeProjectRef.current = projectId;
    send({ type: 'start', projectId });
  }, [send]);

  const resumeSession = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    activeProjectRef.current = projectId;
    send({ type: 'resume', projectId });
  }, [send]);

  const sendTask = useCallback((content: string) => {
    addMessage('user', content);
    send({ type: 'task', content });
  }, [send, addMessage]);

  const stopAgent = useCallback(() => {
    send({ type: 'stop' });
    setActiveProjectId(null);
    activeProjectRef.current = null;
  }, [send]);

  const value: WebSocketState = {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    findings,
    findingsCount: findings.length,
    activeProjectId,
    startAgent,
    resumeSession,
    sendTask,
    stopAgent,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
