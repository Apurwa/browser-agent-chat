import { useState, useRef, useEffect } from 'react';
import FindingAlert from './FindingAlert';
import type { ChatMessage, AgentStatus } from '../types';
import * as vaultApi from '../lib/vaultApi';
import { useAuth } from '../hooks/useAuth';
import { useWS } from '../contexts/WebSocketContext';

interface ChatPanelProps {
  agentId: string;
  messages: ChatMessage[];
  status: AgentStatus;
  currentUrl: string | null;
  showExplore: boolean;
  onExplore: () => void;
  onStartAgent: () => void;
  onSendTask: (content: string) => void;
  onStopAgent: () => void;
}

export default function ChatPanel({
  agentId: _agentId, messages, status, currentUrl,
  showExplore, onExplore,
  onStartAgent, onSendTask, onStopAgent,
}: ChatPanelProps) {
  const { getAccessToken } = useAuth();
  const { pendingCredentialRequest, sendCredentialProvided } = useWS();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isActive = status === 'idle' || status === 'working';

  const prevStatus = useRef<AgentStatus>(status);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credLabel, setCredLabel] = useState('');

  const handleCredentialSubmit = async () => {
    const token = await getAccessToken();
    const result = await vaultApi.createCredential(token, {
      label: credLabel || pendingCredentialRequest!.domain,
      credential_type: 'username_password',
      secret: { password: credPassword },
      metadata: { username: credUsername },
      domains: [pendingCredentialRequest!.domain],
    });
    if (result) {
      await vaultApi.bindToAgent(token, result.id, pendingCredentialRequest!.agentId);
      sendCredentialProvided(result.id);
    }
    setCredUsername('');
    setCredPassword('');
    setCredLabel('');
  };

  useEffect(() => {
    if (prevStatus.current === 'working' && status === 'idle') {
      setShowSuggestions(true);
    }
    if (status === 'working') {
      setShowSuggestions(false);
    }
    prevStatus.current = status;
  }, [status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !isActive) return;
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

      {(showSuggestions || showExplore) && status === 'idle' && (
        <div className="chat-suggestions">
          {showExplore && (
            <button className="chat-suggestion-chip" onClick={() => { onExplore(); setShowSuggestions(false); }}>
              Explore this app
            </button>
          )}
          <button className="chat-suggestion-chip" onClick={() => { onSendTask('Test the login flow'); setShowSuggestions(false); }}>
            Test login flow
          </button>
          <button className="chat-suggestion-chip" onClick={() => { onSendTask('Check all links on this page'); setShowSuggestions(false); }}>
            Check all links
          </button>
          <button className="chat-suggestion-chip" onClick={() => { onSendTask('Test form validation'); setShowSuggestions(false); }}>
            Test form validation
          </button>
        </div>
      )}

      {pendingCredentialRequest && (
        <div className="chat-cred-form" style={{ padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: '8px', marginBottom: '8px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-primary)' }}>
            Credentials needed for <strong>{pendingCredentialRequest.domain}</strong>
          </div>
          <input type="text" placeholder="Label (optional)" value={credLabel} onChange={e => setCredLabel(e.target.value)} style={{ width: '100%', marginBottom: '4px', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', color: 'var(--text-body)' }} />
          <input type="text" placeholder="Username" value={credUsername} onChange={e => setCredUsername(e.target.value)} autoComplete="off" style={{ width: '100%', marginBottom: '4px', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', color: 'var(--text-body)' }} />
          <input type="password" placeholder="Password" value={credPassword} onChange={e => setCredPassword(e.target.value)} autoComplete="new-password" style={{ width: '100%', marginBottom: '8px', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '4px', color: 'var(--text-body)' }} />
          <button onClick={handleCredentialSubmit} disabled={!credUsername.trim() || !credPassword.trim()} style={{ padding: '6px 14px', background: 'var(--brand)', border: 'none', borderRadius: '4px', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Save & Login
          </button>
        </div>
      )}

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={status === 'working' ? 'Type a message (will send when ready)...' : 'Send a message...'}
          disabled={!isActive}
        />
        <button type="submit" disabled={!input.trim() || !isActive}>→</button>
      </form>
    </div>
  );
}
