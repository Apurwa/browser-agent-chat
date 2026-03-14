import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import ChatPanel from './ChatPanel';
import { BrowserView } from './BrowserView';
import { useWS } from '../contexts/WebSocketContext';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';

export default function TestingView() {
  const { id } = useParams();
  const ws = useWS();
  const { getAccessToken } = useAuth();
  const [featuresCount, setFeaturesCount] = useState(0);
  const [hasCredentials, setHasCredentials] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAutoStart = location.state?.autoStart === true;

  // On mount: try to resume an existing session for this project
  // Skip if autoStart — we'll start a fresh agent instead
  useEffect(() => {
    if (id && ws.activeProjectId !== id && !isAutoStart) {
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
        const res = await apiAuthFetch(`/api/projects/${id}/memory/features`, token);
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
        const res = await apiAuthFetch(`/api/projects/${id}`, token);
        if (res.ok) {
          const project = await res.json();
          setHasCredentials(project.hasCredentials);
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSaveCredentials = async (username: string, password: string) => {
    const token = await getAccessToken();
    const res = await apiAuthFetch(`/api/projects/${id}`, token, {
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
        {ws.status === 'idle' && id && featuresCount <= 3 && (
          <button
            className="btn-add"
            onClick={() => ws.explore(id)}
            style={{ margin: '0.5rem', alignSelf: 'flex-start' }}
            title="Explore the app to discover features"
          >
            🔍 Explore App
          </button>
        )}
        <ChatPanel
          projectId={id!}
          messages={ws.messages}
          status={ws.status}
          currentUrl={ws.currentUrl}
          hasCredentials={hasCredentials}
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
    </div>
  );
}
