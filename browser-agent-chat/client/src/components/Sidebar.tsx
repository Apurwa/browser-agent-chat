import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useWS } from '../contexts/WebSocketContext';
import { useHealth } from '../contexts/HealthContext';
import { useSidebar } from '../contexts/SidebarContext';
import {
  FlaskConical,
  Bug,
  BrainCircuit,
  ClipboardCheck,
  Settings,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  KeyRound,
  ChevronDown,
} from 'lucide-react';

function readExpanded(): boolean {
  try {
    return localStorage.getItem('sidebar-expanded') === 'true';
  } catch {
    return false;
  }
}

function writeExpanded(value: boolean): void {
  try {
    localStorage.setItem('sidebar-expanded', String(value));
  } catch {
    // storage unavailable
  }
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: agentId } = useParams<{ id: string }>();
  const { theme, toggleTheme } = useTheme();
  const { findingsCount, pendingSuggestionCount, activeAgentId } = useWS();
  const { langfuseEnabled } = useHealth();
  const { agents } = useSidebar();

  const [expanded, setExpanded] = useState(readExpanded);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAgentView = Boolean(agentId);
  const currentAgent = agents.find((a) => a.id === agentId);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      writeExpanded(next);
      return next;
    });
  }, []);

  const isActive = (path: string) => location.pathname.includes(path);
  const isExactActive = (path: string) => location.pathname === path;

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [dropdownOpen]);

  const isAgentActive = (id: string) => activeAgentId === id;

  const switchToAgent = (newId: string) => {
    setDropdownOpen(false);
    navigate(`/agents/${newId}/testing`);
  };

  // ─── Shared sections ───

  const renderLogo = () => (
    <button className="sidebar-logo" onClick={() => navigate('/')}>
      {expanded
        ? <><span className="sidebar-logo-qa">QA</span> <span className="sidebar-logo-agent">Agent</span></>
        : 'QA'}
    </button>
  );

  const renderWorkspaceSection = () => (
    <>
      {expanded && <div className="sidebar-section-label">Workspace</div>}
      {langfuseEnabled && (
        <button
          className={`sidebar-item${isExactActive('/observability') ? ' active' : ''}`}
          onClick={() => navigate('/observability')}
        >
          <Activity size={18} />
          {expanded && <span className="sidebar-label">Observability</span>}
        </button>
      )}
      <button
        className={`sidebar-item${isExactActive('/vault') ? ' active' : ''}`}
        onClick={() => navigate('/vault')}
      >
        <KeyRound size={18} />
        {expanded && <span className="sidebar-label">Vault</span>}
      </button>
    </>
  );

  const renderBottomSection = () => (
    <>
      <div className="sidebar-spacer" />

      {isAgentView ? (
        <button
          className={`sidebar-item${isActive('settings') ? ' active' : ''}`}
          onClick={() => navigate(`/agents/${agentId}/settings`)}
        >
          <Settings size={18} />
          {expanded && <span className="sidebar-label">Settings</span>}
        </button>
      ) : (
        <button
          className="sidebar-item disabled"
          title="Coming soon"
        >
          <Settings size={18} />
          {expanded && <span className="sidebar-label">Settings</span>}
        </button>
      )}

      <button className="sidebar-item" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        {expanded && <span className="sidebar-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>}
      </button>

    </>
  );

  // ─── State 1: Org View (no agent selected) ───

  const renderOrgAgentList = () => (
    <>
      <div className="sidebar-divider" />
      {expanded && <div className="sidebar-section-label">Agents</div>}
      {agents.map((agent) => (
        <button
          key={agent.id}
          className="sidebar-agent-item"
          onClick={() => navigate(`/agents/${agent.id}/testing`)}
          title={expanded ? undefined : agent.name}
        >
          {expanded ? (
            <>
              <span
                className="sidebar-agent-dot"
                data-active={isAgentActive(agent.id)}
              />
              <span className="sidebar-label">{agent.name}</span>
            </>
          ) : (
            <span
              className="sidebar-agent-initial"
              data-active={isAgentActive(agent.id)}
            >
              {agent.name.charAt(0).toUpperCase()}
            </span>
          )}
        </button>
      ))}
    </>
  );

  // ─── State 2: Agent View (agent selected) ───

  const renderAgentCapabilities = () => (
    <>
      <div className="sidebar-divider" />
      {expanded && <div className="sidebar-section-label">Agent</div>}

      {/* Agent header with dropdown */}
      <div className="sidebar-agent-header-wrapper" ref={dropdownRef}>
        <button
          className="sidebar-agent-header"
          onClick={() => setDropdownOpen((prev) => !prev)}
          title={expanded ? undefined : currentAgent?.name}
        >
          {expanded ? (
            <>
              <span
                className="sidebar-agent-dot"
                data-active={currentAgent ? isAgentActive(currentAgent.id) : false}
              />
              <span className="sidebar-label">{currentAgent?.name ?? 'Unknown'}</span>
              <ChevronDown
                size={14}
                className={`sidebar-agent-chevron${dropdownOpen ? ' sidebar-agent-chevron--open' : ''}`}
              />
            </>
          ) : (
            <span
              className="sidebar-agent-initial"
              data-active={currentAgent ? isAgentActive(currentAgent.id) : false}
            >
              {currentAgent?.name.charAt(0).toUpperCase() ?? '?'}
            </span>
          )}
        </button>

        {dropdownOpen && (() => {
          const rect = dropdownRef.current?.getBoundingClientRect();
          const top = rect ? rect.bottom + 4 : 0;
          const left = rect ? rect.left : 0;
          return (
            <div
              className="sidebar-agent-dropdown"
              style={{ position: 'fixed', top, left, minWidth: rect?.width ?? 180 }}
            >
              <div className="sidebar-agent-dropdown-list">
                {agents.slice(0, 10).map((agent) => (
                  <button
                    key={agent.id}
                    className={`sidebar-agent-dropdown-item${agent.id === agentId ? ' sidebar-agent-dropdown-item--current' : ''}`}
                    onClick={() => switchToAgent(agent.id)}
                  >
                    <span
                      className="sidebar-agent-dot"
                      data-active={isAgentActive(agent.id)}
                    />
                    <span>{agent.name}</span>
                  </button>
                ))}
              </div>
              {agents.length > 10 && (
                <button
                  className="sidebar-agent-dropdown-viewall"
                  onClick={() => {
                    setDropdownOpen(false);
                    navigate('/');
                  }}
                >
                  View all
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* Capability items */}
      <button
        className={`sidebar-item sidebar-capability${isActive('testing') ? ' active' : ''}`}
        onClick={() => navigate(`/agents/${agentId}/testing`)}
      >
        <FlaskConical size={18} />
        {expanded && <span className="sidebar-label">Testing</span>}
      </button>

      <button
        className={`sidebar-item sidebar-capability${isActive('findings') ? ' active' : ''}`}
        onClick={() => navigate(`/agents/${agentId}/findings`)}
      >
        <Bug size={18} />
        {expanded && <span className="sidebar-label">Findings</span>}
        {findingsCount > 0 && <span className="sidebar-badge">{findingsCount}</span>}
      </button>

      <button
        className={`sidebar-item sidebar-capability${isActive('memory') ? ' active' : ''}`}
        onClick={() => navigate(`/agents/${agentId}/memory`)}
      >
        <BrainCircuit size={18} />
        {expanded && <span className="sidebar-label">Memory</span>}
        {pendingSuggestionCount > 0 && (
          <span className="sidebar-badge sidebar-badge--warn">{pendingSuggestionCount}</span>
        )}
      </button>

      <button
        className={`sidebar-item sidebar-capability${isActive('evals') ? ' active' : ''}`}
        onClick={() => navigate(`/agents/${agentId}/evals`)}
      >
        <ClipboardCheck size={18} />
        {expanded && <span className="sidebar-label">Evals</span>}
      </button>

      {langfuseEnabled && (
        <button
          className={`sidebar-item sidebar-capability${isActive('traces') ? ' active' : ''}`}
          onClick={() => navigate(`/agents/${agentId}/traces`)}
        >
          <Activity size={18} />
          {expanded && <span className="sidebar-label">Traces</span>}
        </button>
      )}
    </>
  );

  return (
    <nav className={`sidebar${expanded ? ' sidebar--expanded' : ''}`}>
      <div className="sidebar-top-row">
        {renderLogo()}
        <button className="sidebar-toggle" onClick={toggle} title={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>
      {renderWorkspaceSection()}
      {isAgentView && renderAgentCapabilities()}
      {renderOrgAgentList()}
      {renderBottomSection()}
    </nav>
  );
}
