import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { apiAuthFetch } from '../lib/api';
import { deriveProjectName } from '../lib/url-utils';
import { Sun, Moon, LogOut } from 'lucide-react';
import type { ProjectListItem } from '../types';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const navigate = useNavigate();
  const { user, getAccessToken, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      const res = await apiAuthFetch('/api/projects', token);
      if (res.ok) {
        const data = await res.json();
        const sorted = (data.projects as ProjectListItem[]).sort((a, b) => {
          const aTime = a.last_session_at ?? a.created_at;
          const bTime = b.last_session_at ?? b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        setProjects(sorted);
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
      const res = await apiAuthFetch('/api/projects', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: normalizedUrl }),
      });

      if (res.ok) {
        const project = await res.json();
        navigate(`/projects/${project.id}/testing`, { state: { autoStart: true } });
      } else {
        setError('Failed to create project. Please try again.');
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
  const displayProjects = showAll ? projects : projects.slice(0, 5);

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
          <input
            type="text"
            className="home-url-input"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Paste your app URL..."
            disabled={isCreating}
            required
          />
          <button type="submit" className="home-url-go" disabled={isCreating || !url.trim()}>
            {isCreating ? (
              <span className="home-spinner" />
            ) : (
              '→'
            )}
          </button>
        </form>

        {isCreating && (
          <p className="home-status-text">Creating project &amp; launching agent...</p>
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

            {projects.length === 0 && (
              <p className="home-hint">Paste any web app URL to get started</p>
            )}
          </>
        )}
      </div>

      {/* Recent Projects */}
      {projects.length > 0 && (
        <div className="home-projects">
          <div className="home-projects-header">
            <span className="home-projects-label">Recent Projects</span>
            {projects.length > 5 && (
              <button className="home-projects-viewall" onClick={() => setShowAll(prev => !prev)}>
                {showAll ? 'Show less' : 'View all →'}
              </button>
            )}
          </div>
          <div className={`home-projects-grid${showAll ? ' home-projects-grid--expanded' : ''}`}>
            {displayProjects.map(p => (
              <button key={p.id} className="home-project-card" onClick={() => navigate(`/projects/${p.id}/testing`)}>
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
