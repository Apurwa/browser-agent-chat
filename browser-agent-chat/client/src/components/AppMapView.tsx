import { useParams } from 'react-router-dom';
import AppMap from './AppMap/AppMap';
import { useWS } from '../contexts/WebSocketContext';

export default function AppMapView() {
  const { id } = useParams();
  const ws = useWS();

  if (!id) return null;

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <AppMap agentId={id} onSendTask={ws.sendTask} onExplore={() => ws.explore(id)} />
    </div>
  );
}
