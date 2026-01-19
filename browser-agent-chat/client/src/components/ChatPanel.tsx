import { useState, useRef, useEffect } from 'react';
import type { ChatMessage, AgentStatus } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  status: AgentStatus;
  onSendTask: (task: string) => void;
  onStartAgent: (url: string) => void;
  onStopAgent: () => void;
  currentUrl: string | null;
}

export function ChatPanel({
  messages,
  status,
  onSendTask,
  onStartAgent,
  onStopAgent,
  currentUrl
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [urlInput, setUrlInput] = useState('https://magnitodo.com');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    onSendTask(input.trim());
    setInput('');
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    onStartAgent(urlInput.trim());
  };

  const isAgentReady = status === 'idle';
  const isAgentWorking = status === 'working';
  const hasActiveSession = currentUrl !== null;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Browser Agent Chat</h2>
        <div className="status-indicator">
          <span className={`status-dot ${status}`} />
          <span>{status}</span>
        </div>
      </div>

      {!hasActiveSession ? (
        <form className="url-form" onSubmit={handleStart}>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL to start..."
            required
          />
          <button type="submit" disabled={status === 'working'}>
            Start Agent
          </button>
        </form>
      ) : (
        <div className="session-controls">
          <span className="current-url">{currentUrl}</span>
          <button onClick={onStopAgent} disabled={isAgentWorking}>
            Stop
          </button>
        </div>
      )}

      <div className="messages-container">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.type}`}>
            <span className="message-type">{msg.type}</span>
            <span className="message-content">{msg.content}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isAgentReady
              ? "Enter a task for the agent..."
              : isAgentWorking
              ? "Agent is working..."
              : "Start an agent first..."
          }
          disabled={!isAgentReady}
        />
        <button type="submit" disabled={!isAgentReady || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
