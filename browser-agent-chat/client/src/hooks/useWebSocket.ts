import { useState, useEffect, useRef, useCallback } from 'react';
import type { ClientMessage, ServerMessage, AgentStatus, ChatMessage, Finding } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export interface AgentEvent {
  type: 'thought' | 'action' | 'taskComplete' | 'error' | 'status';
  content: string;
  success?: boolean;
}

interface UseWebSocketOptions {
  onAgentEvent?: (event: AgentEvent) => void;
  token?: string;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const addMessage = useCallback((type: ChatMessage['type'], content: string, finding?: Finding) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      type,
      content,
      timestamp: Date.now(),
      finding,
    }]);
  }, []);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const wsUrl = options.token ? `${WS_URL}?token=${options.token}` : WS_URL;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => setConnected(true);

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMessage;

        switch (msg.type) {
          case 'thought':
            addMessage('agent', msg.content);
            options.onAgentEvent?.({ type: 'thought', content: msg.content });
            break;
          case 'action':
            addMessage('agent', `Action: ${msg.action}${msg.target ? ` → ${msg.target}` : ''}`);
            options.onAgentEvent?.({ type: 'action', content: `${msg.action}${msg.target ? `: ${msg.target}` : ''}` });
            break;
          case 'screenshot':
            setScreenshot(`data:image/png;base64,${msg.data}`);
            break;
          case 'status':
            setStatus(msg.status);
            options.onAgentEvent?.({ type: 'status', content: msg.status });
            if (msg.status === 'disconnected') {
              setScreenshot(null);
              setCurrentUrl(null);
            }
            break;
          case 'nav':
            setCurrentUrl(msg.url);
            break;
          case 'error':
            addMessage('system', `Error: ${msg.message}`);
            options.onAgentEvent?.({ type: 'error', content: msg.message });
            break;
          case 'taskComplete':
            addMessage('system', msg.success ? 'Task completed.' : 'Task failed.');
            options.onAgentEvent?.({ type: 'taskComplete', content: msg.success ? 'completed' : 'failed', success: msg.success });
            break;
          case 'finding':
            setFindings(prev => [...prev, msg.finding]);
            addMessage('finding', msg.finding.title, msg.finding);
            break;
          case 'memoryUpdate':
            if (msg.feature) addMessage('system', `Learned about feature: ${msg.feature.name}`);
            if (msg.flow) addMessage('system', `Learned about flow: ${msg.flow.name}`);
            break;
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code);
        setConnected(false);
        setStatus('disconnected');

        if (event.code === 4003) {
          setAccessDenied(true);
          addMessage('system', 'Access denied — your GitHub account is not authorized');
          return;
        }

        if (event.code === 4001) {
          addMessage('system', 'Session expired. Please sign in again.');
          return;
        }

        addMessage('system', 'Disconnected from server');
        if (!disposed) {
          setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();

      wsRef.current = ws;
    };

    connect();

    return () => {
      disposed = true;
      wsRef.current?.close();
    };
  }, [addMessage, options.token]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const startAgent = useCallback((projectId: string) => {
    setMessages([]);
    setFindings([]);
    send({ type: 'start', projectId });
  }, [send]);

  const sendTask = useCallback((content: string) => {
    addMessage('user', content);
    send({ type: 'task', content });
  }, [send, addMessage]);

  const stopAgent = useCallback(() => {
    send({ type: 'stop' });
  }, [send]);

  return {
    connected, status, screenshot, currentUrl, messages, findings, accessDenied,
    findingsCount: findings.length,
    startAgent, sendTask, stopAgent,
  };
}
