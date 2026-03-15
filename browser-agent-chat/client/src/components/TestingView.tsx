import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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

  // Unconditional auto-connect on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (id) {
      ws.startAgent(id);
    }
  }, [id]);

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
              App Graph
            </button>
          </div>
          {activeTab === 'chat' ? (
            <div style={{ display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0 }}>
              <ChatPanel
                agentId={id!}
                messages={ws.messages}
                status={ws.status}
                currentUrl={ws.currentUrl}
                showExplore={ws.status === 'idle' && !!id && featuresCount <= 3}
                lastCompletedTask={ws.lastCompletedTask}
                onExplore={() => id && ws.explore(id)}
                onSendTask={ws.sendTask}
                onFeedback={ws.sendFeedback}
              />
              <BrowserView
                screenshot={ws.screenshot}
                currentUrl={ws.currentUrl}
                status={ws.status}
              />
            </div>
          ) : (
            <AppMap agentId={id!} onSendTask={ws.sendTask} onExplore={() => ws.explore(id!)} />
          )}
        </div>
      </div>
    </div>
  );
}
