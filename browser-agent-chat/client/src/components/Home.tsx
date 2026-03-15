import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { apiAuthFetch } from '../lib/api';
import { deriveProjectName } from '../lib/url-utils';
import { Sun, Moon, LogOut, Plus, ArrowUp, Mic, Upload, Clipboard } from 'lucide-react';
import type { AgentListItem } from '../types';
import './Home.css';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isSupported: isVoiceSupported, startListening, stopListening, interimTranscript, state: voiceState } = useVoiceInput({
    onResult: (text, isFinal) => {
      if (isFinal) setUrl(prev => (prev + ' ' + text).trim());
    },
  });

  const isListening = voiceState === 'listening';

  const handleMicClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      setUrl('');
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) setUrl(text.trim());
    } catch {
      // Clipboard access denied or empty
    }
    setShowPlusMenu(false);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = (reader.result as string).trim();
      if (text) setUrl(text);
    };
    reader.readAsText(file);
    setShowPlusMenu(false);
    e.target.value = '';
  }, []);

  useEffect(() => {
    if (!showMenu && !showPlusMenu) return;
    const handler = (e: MouseEvent) => {
      if (showMenu && !(e.target as HTMLElement).closest('.home-avatar-wrapper')) {
        setShowMenu(false);
      }
      if (showPlusMenu && !(e.target as HTMLElement).closest('.home-plus-wrapper')) {
        setShowPlusMenu(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showMenu, showPlusMenu]);

  const navigate = useNavigate();
  const { user, getAccessToken, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      const res = await apiAuthFetch('/api/agents', token);
      if (res.ok) {
        const data = await res.json();
        const sorted = (data.agents as AgentListItem[]).sort((a, b) => {
          const aTime = a.last_session_at ?? a.created_at;
          const bTime = b.last_session_at ?? b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        setAgents(sorted);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);

    // Normalize URL: prepend https:// if no protocol
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      const token = await getAccessToken();
      const name = deriveProjectName(normalizedUrl);
      const res = await apiAuthFetch('/api/agents', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: normalizedUrl }),
      });

      if (res.ok) {
        const agent = await res.json();
        navigate(`/agents/${agent.id}/testing`, { state: { autoStart: true } });
      } else {
        setError('Failed to create agent. Please try again.');
        setIsCreating(false);
      }
    } catch {
      setError('Network error. Please check your connection.');
      setIsCreating(false);
    }
  };

  const timeAgo = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const avatarUrl = user?.user_metadata?.avatar_url;
  const displayAgents = showAll ? agents : agents.slice(0, 5);

  return (
    <div className="home-page">
      {/* Top bar */}
      <div className="home-topbar">
        <div className="home-logo">
          <span className="home-logo-accent">QA</span>
          <span className="home-logo-text">Agent</span>
        </div>
        <div className="home-topbar-right">
          <button className="home-theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="home-avatar-wrapper">
            <button className="home-avatar" onClick={() => setShowMenu(prev => !prev)}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" />
              ) : (
                <span className="home-avatar-fallback">{user?.email?.charAt(0).toUpperCase()}</span>
              )}
            </button>
            {showMenu && (
              <div className="home-dropdown">
                <button onClick={signOut}><LogOut size={14} /> Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Center content */}
      <div className="home-center">
        <h1 className="home-headline">What do you want to test?</h1>

        <form className="home-url-form" onSubmit={handleSubmit}>
          <div className="home-plus-wrapper">
            <button type="button" className="home-plus-btn" onClick={() => setShowPlusMenu(prev => !prev)} disabled={isCreating}>
              <Plus size={20} />
            </button>
            {showPlusMenu && (
              <div className="home-plus-dropdown">
                <button type="button" onClick={handlePasteFromClipboard}>
                  <Clipboard size={14} /> Paste from clipboard
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} /> Upload file
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv,.json"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>

          <input
            type="text"
            className="home-url-input"
            value={isListening ? (url + (interimTranscript ? ' ' + interimTranscript : '')).trim() : url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Paste your app URL..."
            disabled={isCreating || isListening}
            required
          />

          {isVoiceSupported && (
            <button
              type="button"
              className={`home-mic-btn${isListening ? ' listening' : ''}`}
              onClick={handleMicClick}
              disabled={isCreating}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              <Mic size={20} />
              {isListening && <span className="home-mic-pulse" />}
            </button>
          )}

          <button type="submit" className="home-url-go" disabled={isCreating || !url.trim()}>
            {isCreating ? (
              <span className="home-spinner" />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </form>

        {isCreating && (
          <p className="home-status-text">Creating agent &amp; launching browser...</p>
        )}

        {error && (
          <p className="home-error-text">{error}</p>
        )}

        {!isCreating && (
          <>
            <div className="home-chips">
              <span className="home-chip">Explore &amp; learn features</span>
              <span className="home-chip">Test a specific flow</span>
              <span className="home-chip">Find bugs</span>
            </div>

            {agents.length === 0 && (
              <p className="home-hint">Paste any web app URL to get started</p>
            )}
          </>
        )}
      </div>

      {/* Recent Agents */}
      {agents.length > 0 && (
        <div className="home-projects">
          <div className="home-projects-header">
            <span className="home-projects-label">Recent Agents</span>
            {agents.length > 5 && (
              <button className="home-projects-viewall" onClick={() => setShowAll(prev => !prev)}>
                {showAll ? 'Show less' : 'View all →'}
              </button>
            )}
          </div>
          <div className={`home-projects-grid${showAll ? ' home-projects-grid--expanded' : ''}`}>
            {displayAgents.map(p => (
              <button key={p.id} className="home-project-card" onClick={() => navigate(`/agents/${p.id}/testing`)}>
                <div className="home-project-name">{p.name}</div>
                <div className="home-project-url">{p.url}</div>
                <div className="home-project-meta">
                  {p.findings_count > 0 ? (
                    <span className="home-project-badge home-project-badge--bugs">{p.findings_count} bugs</span>
                  ) : (
                    <span className="home-project-badge home-project-badge--clean">clean</span>
                  )}
                  {p.last_session_at && <span className="home-project-time">{timeAgo(p.last_session_at)}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
