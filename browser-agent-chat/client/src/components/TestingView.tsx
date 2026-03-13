import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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

  // On mount: try to resume an existing session for this project
  useEffect(() => {
    if (id && ws.activeProjectId !== id) {
      ws.resumeSession(id);
    }
  }, [id]);

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
          onStartAgent={() => ws.startAgent(id!)}
          onSendTask={ws.sendTask}
          onStopAgent={ws.stopAgent}
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
