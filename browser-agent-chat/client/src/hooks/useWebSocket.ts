import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMessage, ServerMessage, AgentStatus, ChatMessage } from '../types';

const WS_URL = 'ws://localhost:3001';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const addMessage = useCallback((type: ChatMessage['type'], content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type,
        content,
        timestamp: Date.now()
      }
    ]);
  }, []);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
        addMessage('system', 'Connected to server');
      };

      ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'thought':
              addMessage('agent', message.content);
              break;
            case 'action':
              addMessage('agent', `Action: ${message.action}${message.target ? ` on "${message.target}"` : ''}`);
              break;
            case 'screenshot':
              setScreenshot(`data:image/png;base64,${message.data}`);
              break;
            case 'status':
              setStatus(message.status);
              // Reset session state when disconnected
              if (message.status === 'disconnected') {
                setCurrentUrl(null);
                setScreenshot(null);
              }
              break;
            case 'nav':
              setCurrentUrl(message.url);
              break;
            case 'error':
              addMessage('system', `Error: ${message.message}`);
              break;
            case 'taskComplete':
              addMessage('system', message.success ? 'Task completed' : 'Task failed');
              break;
          }
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        setStatus('disconnected');
        addMessage('system', 'Disconnected from server');
        // Reconnect after delay
        setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [addMessage]);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));

      if (message.type === 'task') {
        addMessage('user', message.content);
      } else if (message.type === 'start') {
        addMessage('system', `Starting agent at ${message.url}`);
      } else if (message.type === 'stop') {
        addMessage('system', 'Stopping agent');
      }
    }
  }, [addMessage]);

  const startAgent = useCallback((url: string) => {
    send({ type: 'start', url });
  }, [send]);

  const sendTask = useCallback((content: string) => {
    send({ type: 'task', content });
  }, [send]);

  const stopAgent = useCallback(() => {
    send({ type: 'stop' });
  }, [send]);

  return {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    startAgent,
    sendTask,
    stopAgent
  };
}
