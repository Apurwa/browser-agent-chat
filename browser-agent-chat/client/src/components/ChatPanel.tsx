import { useState, useRef, useEffect } from 'react';
import FindingAlert from './FindingAlert';
import type { ChatMessage, AgentStatus } from '../types';

const LOGIN_KEYWORDS = ['login', 'sign in', 'sign-in', 'log in', 'authentication', 'username and password', 'credentials'];
const INTENT_KEYWORDS = ['need', 'require', 'see', 'found', 'ask', 'provide', 'enter'];

interface ChatPanelProps {
  projectId: string;
  messages: ChatMessage[];
  status: AgentStatus;
  currentUrl: string | null;
  hasCredentials: boolean;
  onStartAgent: () => void;
  onSendTask: (content: string) => void;
  onStopAgent: () => void;
  onSaveCredentials: (username: string, password: string) => Promise<void>;
}

export default function ChatPanel({
  projectId: _projectId, messages, status, currentUrl,
  hasCredentials,
  onStartAgent, onSendTask, onStopAgent, onSaveCredentials,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isActive = status === 'idle' || status === 'working';

  const hasShownTip = useRef(false);
  const prevStatus = useRef<AgentStatus>(status);
  const [tipMessage, setTipMessage] = useState<string | null>(null);

  const credentialPromptShown = useRef(false);
  const [showCredForm, setShowCredForm] = useState(false);
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [credPromptMsgId, setCredPromptMsgId] = useState<string | null>(null);

  // Detect login-related thoughts
  useEffect(() => {
    if (credentialPromptShown.current || hasCredentials) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.type !== 'agent') return;
    const lower = lastMsg.content.toLowerCase();
    const hasLogin = LOGIN_KEYWORDS.some(k => lower.includes(k));
    const hasIntent = INTENT_KEYWORDS.some(k => lower.includes(k));
    if (hasLogin && hasIntent) {
      credentialPromptShown.current = true;
      setCredPromptMsgId(lastMsg.id);
    }
  }, [messages, hasCredentials]);

  const handleCredSubmit = async () => {
    if (!credUsername || !credPassword) return;
    setCredSaving(true);
    try {
      await onSaveCredentials(credUsername, credPassword);
      setShowCredForm(false);
      setCredPromptMsgId(null);
    } catch {
      // Credentials save failed — form stays open for retry
    } finally {
      setCredSaving(false);
    }
  };

  const handleCredSkip = () => {
    setCredPromptMsgId(null);
  };

  useEffect(() => {
    if (prevStatus.current === 'working' && status === 'idle' && !hasShownTip.current) {
      setTipMessage("Tip: Try 'Explore this app' or describe a flow to test.");
      hasShownTip.current = true;
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
            {msg.id === credPromptMsgId && !showCredForm && (
              <div className="chat-cred-prompt">
                <button className="btn-primary btn-sm" onClick={() => setShowCredForm(true)}>Add credentials</button>
                <button className="btn-secondary btn-sm" onClick={handleCredSkip}>Skip</button>
              </div>
            )}
            {msg.id === credPromptMsgId && showCredForm && (
              <div className="chat-cred-form">
                <input type="text" placeholder="Username / email" value={credUsername} onChange={e => setCredUsername(e.target.value)} />
                <input type="password" placeholder="Password" value={credPassword} onChange={e => setCredPassword(e.target.value)} />
                <button className="btn-primary btn-sm" onClick={handleCredSubmit} disabled={credSaving || !credUsername || !credPassword}>
                  {credSaving ? 'Saving...' : 'Save & Login'}
                </button>
              </div>
            )}
          </div>
        ))}
        {tipMessage && (
          <div className="chat-message chat-message-system chat-tip">
            <p>{tipMessage}</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

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
