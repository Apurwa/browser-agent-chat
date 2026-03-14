import { useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useWS } from '../contexts/WebSocketContext';
import {
  FlaskConical,
  Bug,
  BrainCircuit,
  Settings,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

interface SidebarProps {
  findingsCount?: number;
  disabled?: boolean;
}

export default function Sidebar({ findingsCount = 0, disabled = false }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const { theme, toggleTheme } = useTheme();
  const { pendingSuggestionCount } = useWS();
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('sidebar-expanded') === 'true'; } catch { return false; }
  });

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem('sidebar-expanded', String(next)); } catch {}
  };

  const isActive = (path: string) => location.pathname.includes(path);

  const navTo = (path: string) => {
    if (!disabled && id) navigate(`/projects/${id}/${path}`);
  };

  return (
    <nav className={`sidebar${expanded ? ' sidebar--expanded' : ''}`}>
      {/* Logo */}
      <button className="sidebar-logo" onClick={() => navigate('/')}>
        QA
      </button>

      {/* Nav items */}
      <button
        className={`sidebar-item${isActive('testing') ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        onClick={() => navTo('testing')}
      >
        <FlaskConical size={18} />
        {expanded && <span className="sidebar-label">Testing</span>}
      </button>

      <button
        className={`sidebar-item${isActive('findings') ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        onClick={() => navTo('findings')}
      >
        <Bug size={18} />
        {expanded && <span className="sidebar-label">Findings</span>}
        {findingsCount > 0 && <span className="sidebar-badge">{findingsCount}</span>}
      </button>

      <button
        className={`sidebar-item${isActive('memory') ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        onClick={() => navTo('memory')}
      >
        <BrainCircuit size={18} />
        {expanded && <span className="sidebar-label">Memory</span>}
        {pendingSuggestionCount > 0 && (
          <span className="sidebar-badge sidebar-badge--warn">{pendingSuggestionCount}</span>
        )}
      </button>

      <div className="sidebar-spacer" />

      {/* Bottom items */}
      <button className="sidebar-item" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        {expanded && <span className="sidebar-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>}
      </button>

      <button
        className={`sidebar-item${isActive('settings') ? ' active' : ''}${disabled ? ' disabled' : ''}`}
        onClick={() => navTo('settings')}
      >
        <Settings size={18} />
        {expanded && <span className="sidebar-label">Settings</span>}
      </button>

      {/* Collapse toggle */}
      <button className="sidebar-toggle" onClick={toggle} title={expanded ? 'Collapse' : 'Expand'}>
        {expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
    </nav>
  );
}
