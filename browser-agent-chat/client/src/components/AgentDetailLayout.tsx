import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useHealth } from '../contexts/HealthContext';
import { useWS } from '../contexts/WebSocketContext';
import type { LucideIcon } from 'lucide-react';
import { FlaskConical, Bug, BrainCircuit, ClipboardCheck, Activity, Settings } from 'lucide-react';
import './AgentDetailLayout.css';

type BadgeKey = 'findingsCount' | 'pendingSuggestionCount';

interface TabDef {
  readonly label: string;
  readonly path: string;
  readonly icon: LucideIcon;
  readonly badgeKey?: BadgeKey;
  readonly requiresLangfuse?: boolean;
}

const TABS: readonly TabDef[] = [
  { label: 'Testing', path: 'testing', icon: FlaskConical },
  { label: 'Findings', path: 'findings', icon: Bug, badgeKey: 'findingsCount' },
  { label: 'Memory', path: 'memory', icon: BrainCircuit, badgeKey: 'pendingSuggestionCount' },
  { label: 'Evals', path: 'evals', icon: ClipboardCheck },
  { label: 'Traces', path: 'traces', icon: Activity, requiresLangfuse: true },
  { label: 'Settings', path: 'settings', icon: Settings },
];

export default function AgentDetailLayout() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { langfuseEnabled } = useHealth();
  const ws = useWS();

  const badges: Record<BadgeKey, number> = {
    findingsCount: ws.findingsCount,
    pendingSuggestionCount: ws.pendingSuggestionCount,
  };

  const visibleTabs = TABS.filter(
    (tab) => !tab.requiresLangfuse || langfuseEnabled,
  );

  return (
    <div className="agent-detail">
      <div className="agent-tabs">
        {visibleTabs.map((tab) => {
          const isActive = location.pathname.includes(`/${tab.path}`);
          const Icon = tab.icon;
          const badgeValue = tab.badgeKey ? badges[tab.badgeKey] : 0;

          return (
            <button
              key={tab.path}
              className={`agent-tab${isActive ? ' agent-tab--active' : ''}`}
              onClick={() => navigate(`/agents/${id}/${tab.path}`)}
            >
              <Icon size={15} />
              {tab.label}
              {badgeValue > 0 && (
                <span className="agent-tab-badge">{badgeValue}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="agent-detail-content">
        <Outlet />
      </div>
    </div>
  );
}
