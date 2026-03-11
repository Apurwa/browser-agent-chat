import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import ChatPanel from './ChatPanel';
import { BrowserView } from './BrowserView';
import { useWS } from '../contexts/WebSocketContext';

export default function TestingView() {
  const { id } = useParams();
  const ws = useWS();

  // On mount: try to resume an existing session for this project
  useEffect(() => {
    if (id && ws.activeProjectId !== id) {
      ws.resumeSession(id);
    }
  }, [id]);

  return (
    <div className="app-layout">
      <Sidebar findingsCount={ws.findingsCount} />
      <div className="testing-content">
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
