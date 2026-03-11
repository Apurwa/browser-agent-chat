import { useState, useEffect, useRef, useCallback } from 'react';
import type { ClientMessage, ServerMessage, AgentStatus, ChatMessage, Finding } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
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

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;

      switch (msg.type) {
        case 'thought':
          addMessage('agent', msg.content);
          break;
        case 'action':
          addMessage('agent', `Action: ${msg.action}${msg.target ? ` → ${msg.target}` : ''}`);
          break;
        case 'screenshot':
          setScreenshot(`data:image/png;base64,${msg.data}`);
          break;
        case 'status':
          setStatus(msg.status);
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
          break;
        case 'taskComplete':
          addMessage('system', msg.success ? 'Task completed.' : 'Task failed.');
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

    ws.onclose = () => {
      setConnected(false);
      setStatus('disconnected');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, [addMessage]);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

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
    connected, status, screenshot, currentUrl, messages, findings,
    findingsCount: findings.length,
    startAgent, sendTask, stopAgent,
  };
}
