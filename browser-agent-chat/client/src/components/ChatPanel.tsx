import { useState, useRef, useEffect } from 'react';
import FindingAlert from './FindingAlert';
import type { ChatMessage, AgentStatus } from '../types';

interface ChatPanelProps {
  projectId: string;
  messages: ChatMessage[];
  status: AgentStatus;
  currentUrl: string | null;
  onStartAgent: () => void;
  onSendTask: (content: string) => void;
  onStopAgent: () => void;
}

export default function ChatPanel({
  projectId, messages, status, currentUrl,
  onStartAgent, onSendTask, onStopAgent,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isActive = status === 'idle' || status === 'working';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status !== 'idle') return;
    onSendTask(input.trim());
    setInput('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-status">
          <span className={`status-dot status-${status}`} />
          <span className="status-text">{status}</span>
        </div>
        {isActive ? (
          <button className="btn-stop" onClick={onStopAgent}>Stop</button>
        ) : (
          <button className="btn-primary btn-sm" onClick={onStartAgent}>Start Agent</button>
        )}
      </div>

      {currentUrl && <div className="chat-url">{currentUrl}</div>}

      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message chat-message-${msg.type}`}>
            {msg.type === 'finding' && msg.finding ? (
              <FindingAlert finding={msg.finding} />
            ) : (
              <p>{msg.content}</p>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={status === 'working' ? 'Agent is working...' : 'Send a message...'}
          disabled={!isActive || status === 'working'}
        />
        <button type="submit" disabled={!input.trim() || status !== 'idle'}>→</button>
      </form>
    </div>
  );
}
