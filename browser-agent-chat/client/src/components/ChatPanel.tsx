import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import FindingAlert from './FindingAlert';
import PatternLearnedCard from './PatternLearnedCard';
import TaskCompletionCard from './TaskCompletionCard';
import type { ChatMessage, AgentStatus } from '../types';
import { useWS } from '../contexts/WebSocketContext';

interface ChatPanelProps {
  agentId: string;
  messages: ChatMessage[];
  status: AgentStatus;
  currentUrl: string | null;
  showExplore: boolean;
  lastCompletedTask: { taskId: string; success: boolean; stepCount: number; durationMs: number } | null;
  onExplore: () => void;
  onSendTask: (content: string) => void;
  onFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
}

export default function ChatPanel({
  agentId: _agentId, messages, status, currentUrl,
  showExplore, lastCompletedTask, onExplore,
  onSendTask, onFeedback,
}: ChatPanelProps) {
  const navigate = useNavigate();
  const { pendingCredentialRequest, sendCredentialProvided, feedbackAck, sessionWarning, sessionEvicted, sendRestart, startAgent } = useWS();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputDisabled = status === 'crashed' || status === 'error';

  const prevStatus = useRef<AgentStatus>(status);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleCredentialSkip = () => {
    sendCredentialProvided('');
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
    if (!input.trim() || inputDisabled) return;
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
        {status === 'disconnected' && !sessionEvicted && (
          <span className="chat-status-indicator reconnecting">Reconnecting...</span>
        )}
        {sessionEvicted && (
          <button className="btn-primary btn-sm" onClick={() => startAgent(_agentId)}>Reconnect</button>
        )}
        {(status === 'crashed' || status === 'error') && (
          <button className="btn-primary btn-sm" onClick={() => sendRestart(_agentId)}>Restart</button>
        )}
      </div>

      {currentUrl && <div className="chat-url">{currentUrl}</div>}

      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message chat-message-${msg.type}`}>
            {msg.type === 'finding' && msg.finding ? (
              <FindingAlert finding={msg.finding} />
            ) : msg.patternData ? (
              <PatternLearnedCard
                name={msg.patternData.name}
                steps={msg.patternData.steps}
                successRate={msg.patternData.successRate}
                runs={msg.patternData.runs}
                transition={msg.patternData.transition}
                isCelebration={msg.patternData.isCelebration}
              />
            ) : (
              <p>{msg.content}</p>
            )}
          </div>
        ))}
        {lastCompletedTask && (
          <TaskCompletionCard
            taskId={lastCompletedTask.taskId}
            success={lastCompletedTask.success}
            stepCount={lastCompletedTask.stepCount}
            durationMs={lastCompletedTask.durationMs}
            onFeedback={onFeedback}
            feedbackAck={feedbackAck}
          />
        )}
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
        <div className="chat-credential-prompt">
          <p>This site requires login credentials.</p>
          <button onClick={() => navigate(`/vault?prefill=${encodeURIComponent(pendingCredentialRequest.domain)}`)}>
            Add a credential for {pendingCredentialRequest.domain}
          </button>
          <button className="chat-cred-form-skip" onClick={handleCredentialSkip} style={{ marginLeft: 8 }}>
            Skip
          </button>
        </div>
      )}

      {sessionWarning && (
        <div className="chat-status-banner warning">{sessionWarning}</div>
      )}

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={inputDisabled ? 'Session error — restart to continue' : status === 'working' ? 'Type a message (will send when ready)...' : 'Send a message...'}
          disabled={inputDisabled}
        />
        <button type="submit" disabled={!input.trim() || inputDisabled}>→</button>
      </form>
    </div>
  );
}
