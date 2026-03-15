import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { ClientMessage, ServerMessage, AgentStatus, ChatMessage, Finding, Suggestion } from '../types';

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
  pendingSuggestionCount: number;
  activeAgentId: string | null;
  activeTaskId: string | null;
  lastCompletedTask: { taskId: string; success: boolean; stepCount: number; durationMs: number } | null;
  startAgent: (agentId: string) => void;
  resumeSession: (agentId: string) => void;
  sendTask: (content: string) => void;
  stopAgent: () => void;
  explore: (agentId: string) => void;
  sendFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
  resetSuggestionCount: () => void;
  decrementSuggestionCount: () => void;
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
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [pendingSuggestionCount, setPendingSuggestionCount] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [lastCompletedTask, setLastCompletedTask] = useState<{
    taskId: string;
    success: boolean;
    stepCount: number;
    durationMs: number;
  } | null>(null);

  // Stable ref for the active agent so message handlers don't get stale closures
  const activeAgentRef = useRef<string | null>(null);

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
        // Note: 'disconnected' from server (e.g. idle timeout, error) clears active agent
        // but preserves screenshot/currentUrl/messages so stop→start feels seamless.
        if ((msg as any).status === 'disconnected') {
          setActiveAgentId(null);
          activeAgentRef.current = null;
        }
        break;
      case 'nav':
        setCurrentUrl((msg as any).url);
        lastUrlRef.current = (msg as any).url;
        break;
      case 'error':
        addMessage('system', `Error: ${(msg as any).message}`);
        break;
      case 'taskStarted':
        setActiveTaskId((msg as any).taskId);
        break;
      case 'taskComplete': {
        const taskId = (msg as any).taskId ?? activeTaskId ?? '';
        const stepCount = (msg as any).stepCount ?? 0;
        const durationMs = (msg as any).durationMs ?? 0;
        setLastCompletedTask({ taskId, success: (msg as any).success, stepCount, durationMs });
        setActiveTaskId(null);
        // Don't add system message here — TaskCompletionCard handles display
        break;
      }
      case 'finding': {
        const finding = (msg as any).finding as Finding;
        setFindings(prev => [...prev, finding]);
        addMessage('finding', finding.title, finding);
        break;
      }
      case 'suggestion': {
        const suggestion = (msg as any).suggestion as Suggestion;
        setPendingSuggestionCount(c => c + 1);
        const typeLabel = suggestion.type === 'feature' ? 'feature' : suggestion.type === 'flow' ? 'flow' : 'behavior';
        const name = 'name' in suggestion.data ? (suggestion.data as any).name : (suggestion.data as any).feature_name;
        addMessage('system', `💡 Learned: "${name}" ${typeLabel}`);
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
      case 'metrics': {
        const m = (msg as any).metrics;
        const summary = m.steps
          .map((s: any) => `${s.name}: ${s.duration}ms`)
          .join(' | ');
        addMessage('system', `Startup: ${m.total}ms (${summary})`);
        break;
      }
      case 'patternLearned': {
        const pl = msg as any;
        addMessage('system', `Pattern learned: "${pl.name}" (${pl.runs} runs, ${Math.round(pl.success_rate * 100)}% success)`);
        break;
      }
      case 'patternStale': {
        const ps = msg as any;
        addMessage('system', `Pattern stale: "${ps.name}" — ${ps.reason}`);
        break;
      }
      case 'pong':
        // Heartbeat response — no action needed
        break;
      case 'sessionCrashed':
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          type: 'system',
          content: 'Browser session crashed. Please restart the agent to continue.',
          timestamp: Date.now(),
        }]);
        setStatus('disconnected');
        activeAgentRef.current = null;
        setActiveAgentId(null);
        break;
      case 'taskInterrupted':
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          type: 'system',
          content: `Server restarted while running a task. Your browser session was preserved. Previous task: "${(msg as any).task}"`,
          timestamp: Date.now(),
        }]);
        // Status stays as-is (likely 'idle' from the recovered session snapshot)
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

      // If we had an active agent, try to resume
      if (activeAgentRef.current) {
        ws.send(JSON.stringify({ type: 'resume', agentId: activeAgentRef.current }));
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
    const ready = wsRef.current?.readyState;
    console.log('[WS] send', msg.type, 'readyState:', ready);
    if (ready === WebSocket.OPEN) {
      wsRef.current!.send(JSON.stringify(msg));
    } else {
      console.warn('[WS] send DROPPED — socket not open, readyState:', ready);
    }
  }, []);

  // Track the last URL so we can resume at the same page after stop→start
  const lastUrlRef = useRef<string | null>(null);

  const startAgent = useCallback((agentId: string) => {
    // If switching to a different agent, clear stale state from the previous one
    if (activeAgentRef.current !== agentId) {
      setMessages([]);
      setFindings([]);
      setScreenshot(null);
      setCurrentUrl(null);
      setPendingSuggestionCount(0);
      lastUrlRef.current = null;
    }
    setStatus('working');
    setActiveAgentId(agentId);
    activeAgentRef.current = agentId;
    // If we have a last-known URL for this agent, tell server to navigate there
    const resumeUrl = lastUrlRef.current || undefined;
    send({ type: 'start', agentId, resumeUrl });
  }, [send]);

  const resumeSession = useCallback((agentId: string) => {
    // If switching to a different agent, clear stale state from the previous one
    if (activeAgentRef.current !== agentId) {
      setMessages([]);
      setFindings([]);
      setScreenshot(null);
      setCurrentUrl(null);
      setPendingSuggestionCount(0);
      lastUrlRef.current = null;
    }
    setActiveAgentId(agentId);
    activeAgentRef.current = agentId;
    send({ type: 'resume', agentId });
  }, [send]);

  const sendTask = useCallback((content: string) => {
    addMessage('user', content);
    send({ type: 'task', content });
  }, [send, addMessage]);

  const stopAgent = useCallback(() => {
    send({ type: 'stop' });
    setStatus('disconnected');
    // Keep screenshot and currentUrl visible — user expects to see same screen on restart
    setActiveAgentId(null);
    activeAgentRef.current = null;
    // Keep lastUrlRef — so next start navigates back to where we were
  }, [send]);

  const explore = useCallback((agentId: string) => {
    setStatus('working');
    send({ type: 'explore', agentId });
  }, [send]);

  const sendFeedback = useCallback((taskId: string, rating: 'positive' | 'negative', correction?: string) => {
    send({ type: 'taskFeedback', task_id: taskId, rating, correction });
    setLastCompletedTask(null);
  }, [send]);

  const resetSuggestionCount = useCallback(() => {
    setPendingSuggestionCount(0);
  }, []);

  const decrementSuggestionCount = useCallback(() => {
    setPendingSuggestionCount(c => Math.max(0, c - 1));
  }, []);

  const value: WebSocketState = {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    findings,
    findingsCount: findings.length,
    pendingSuggestionCount,
    activeAgentId,
    activeTaskId,
    lastCompletedTask,
    startAgent,
    resumeSession,
    sendTask,
    stopAgent,
    explore,
    sendFeedback,
    resetSuggestionCount,
    decrementSuggestionCount,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
