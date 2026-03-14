import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import ChatPanel from './ChatPanel';
import { BrowserView } from './BrowserView';
import AppMap from './AppMap/AppMap';
import { useWS } from '../contexts/WebSocketContext';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';

export default function TestingView() {
  const { id } = useParams();
  const ws = useWS();
  const { getAccessToken } = useAuth();
  const [activeTab, setActiveTab] = useState<'chat' | 'map'>('chat');
  const [featuresCount, setFeaturesCount] = useState(0);
  const [hasCredentials, setHasCredentials] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAutoStart = location.state?.autoStart === true;

  // On mount: try to resume an existing session for this agent
  // Skip if autoStart — we'll start a fresh agent instead
  useEffect(() => {
    if (id && ws.activeAgentId !== id && !isAutoStart) {
      ws.resumeSession(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-start agent when navigating from Home with autoStart flag
  useEffect(() => {
    if (id && isAutoStart) {
      ws.startAgent(id);
      // Clear the state to prevent re-triggering on refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isAutoStart]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await apiAuthFetch(`/api/agents/${id}/memory/features`, token);
        if (res.ok) {
          const body = await res.json();
          const features = body.features ?? body;
          setFeaturesCount(Array.isArray(features) ? features.length : 0);
        }
      } catch { /* ignore */ }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await apiAuthFetch(`/api/agents/${id}`, token);
        if (res.ok) {
          const agent = await res.json();
          setHasCredentials(agent.hasCredentials);
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSaveCredentials = async (username: string, password: string) => {
    const token = await getAccessToken();
    const res = await apiAuthFetch(`/api/agents/${id}`, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: { username, password } }),
    });
    if (!res.ok) throw new Error('Failed to save credentials');
    setHasCredentials(true);
  };

  return (
    <div className="app-layout">
      <Sidebar findingsCount={ws.findingsCount} />
      <div className="testing-content">
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
          <div className="testing-tabs">
            <button
              className={`testing-tab ${activeTab === 'chat' ? 'testing-tab--active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
            <button
              className={`testing-tab ${activeTab === 'map' ? 'testing-tab--active' : ''}`}
              onClick={() => setActiveTab('map')}
            >
              App Map
            </button>
          </div>
          {activeTab === 'chat' ? (
            <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
              <ChatPanel
                agentId={id!}
                messages={ws.messages}
                status={ws.status}
                currentUrl={ws.currentUrl}
                hasCredentials={hasCredentials}
                showExplore={ws.status === 'idle' && !!id && featuresCount <= 3}
                onExplore={() => id && ws.explore(id)}
                onStartAgent={() => ws.startAgent(id!)}
                onSendTask={ws.sendTask}
                onStopAgent={ws.stopAgent}
                onSaveCredentials={handleSaveCredentials}
              />
              <BrowserView
                screenshot={ws.screenshot}
                currentUrl={ws.currentUrl}
                status={ws.status}
              />
            </div>
          ) : (
            <AppMap projectId={id!} onSendTask={ws.sendTask} onExplore={() => ws.explore(id!)} />
          )}
        </div>
      </div>
    </div>
  );
}
