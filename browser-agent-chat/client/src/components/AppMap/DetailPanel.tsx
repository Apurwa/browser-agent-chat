import { useAuth } from '../../hooks/useAuth';
import { apiAuthFetch } from '../../lib/api';
import FeatureCard from './FeatureCard';
import type { MapNode, MapEdge } from './useAppMap';

interface DetailPanelProps {
  selectedNode: MapNode | null;
  unlinkedSuggestions: MapNode['pendingSuggestions'];
  projectId: string;
  onRefresh: () => void;
  onSendTask: (task: string) => void;
  onSelectNode: (nodeId: string) => void;
  edges: MapEdge[];
  nodes: MapNode[];
}

export default function DetailPanel({
  selectedNode, unlinkedSuggestions, projectId,
  onRefresh, onSendTask, onSelectNode, edges, nodes,
}: DetailPanelProps) {
  const { getAccessToken } = useAuth();

  const handleAccept = async (suggestionId: string) => {
    try {
      const token = await getAccessToken();
      await apiAuthFetch(`/api/agents/${projectId}/suggestions/${suggestionId}/accept`, token, {
        method: 'PUT',
      });
      onRefresh();
    } catch (err) {
      console.error('Failed to accept suggestion:', err);
    }
  };

  const handleDismiss = async (suggestionId: string) => {
    try {
      const token = await getAccessToken();
      await apiAuthFetch(`/api/agents/${projectId}/suggestions/${suggestionId}/dismiss`, token, {
        method: 'PUT',
      });
      onRefresh();
    } catch (err) {
      console.error('Failed to dismiss suggestion:', err);
    }
  };

  const handleReExplore = () => {
    if (!selectedNode) return;
    onSendTask(`Navigate to ${selectedNode.urlPattern} and identify all features, interactions, and flows on this page.`);
  };

  const connectedNodes = selectedNode ? (() => {
    const outbound = edges
      .filter(e => e.fromNodeId === selectedNode.id)
      .map(e => ({ nodeId: e.toNodeId, direction: 'to' as const }));
    const inbound = edges
      .filter(e => e.toNodeId === selectedNode.id)
      .map(e => ({ nodeId: e.fromNodeId, direction: 'from' as const }));
    return [...inbound, ...outbound]
      .map(c => ({ ...c, node: nodes.find(n => n.id === c.nodeId) }))
      .filter(c => c.node);
  })() : [];

  if (!selectedNode) {
    return (
      <div className="detail-panel detail-panel--empty">
        <p className="detail-panel-hint">Select a page node to see its features</p>
        {unlinkedSuggestions.length > 0 && (
          <div className="detail-panel-section">
            <div className="detail-panel-label detail-panel-label--pending">
              {unlinkedSuggestions.length} UNLINKED SUGGESTION{unlinkedSuggestions.length > 1 ? 'S' : ''}
            </div>
            {unlinkedSuggestions.map(s => (
              <SuggestionItem key={s.id} suggestion={s} onAccept={handleAccept} onDismiss={handleDismiss} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <div className="detail-panel-title-row">
          <span className="detail-panel-title">{selectedNode.pageTitle || 'Untitled'}</span>
          <div className="detail-panel-header-actions">
            <button className="detail-action" onClick={handleReExplore}>Re-explore</button>
          </div>
        </div>
        <div className="detail-panel-url">{selectedNode.urlPattern}</div>
      </div>

      <div className="detail-panel-section">
        <div className="detail-panel-label">FEATURES ({selectedNode.features.length})</div>
        {selectedNode.features.length === 0 && (
          <div className="detail-panel-empty-features">No features discovered yet</div>
        )}
        {[...selectedNode.features]
          .sort((a, b) => {
            const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
            return (order[a.criticality] ?? 3) - (order[b.criticality] ?? 3);
          })
          .map(f => (
            <FeatureCard
              key={f.id}
              feature={f}
              projectId={projectId}
              pageTitle={selectedNode.pageTitle}
              urlPattern={selectedNode.urlPattern}
              onSendTask={onSendTask}
              onRefresh={onRefresh}
            />
          ))
        }
      </div>

      {selectedNode.pendingSuggestions.length > 0 && (
        <div className="detail-panel-section">
          <div className="detail-panel-label detail-panel-label--pending">
            PENDING SUGGESTIONS ({selectedNode.pendingSuggestions.length})
          </div>
          {selectedNode.pendingSuggestions.map(s => (
            <SuggestionItem key={s.id} suggestion={s} onAccept={handleAccept} onDismiss={handleDismiss} />
          ))}
        </div>
      )}

      {connectedNodes.length > 0 && (
        <div className="detail-panel-section">
          <div className="detail-panel-label">NAVIGATES TO</div>
          <div className="connected-chips">
            {connectedNodes.map(c => (
              <button
                key={`${c.direction}-${c.nodeId}`}
                className="connected-chip"
                onClick={() => onSelectNode(c.nodeId)}
              >
                {c.direction === 'from' ? '\u2190 ' : ''}{c.node!.pageTitle || c.node!.urlPattern}{c.direction === 'to' ? ' \u2192' : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionItem({ suggestion, onAccept, onDismiss }: {
  suggestion: MapNode['pendingSuggestions'][number];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const data = suggestion.data;
  const name = (data.name || data.feature_name || data.behavior || 'Unknown') as string;

  return (
    <div className="suggestion-item">
      <div className="suggestion-item-header">
        <span className="suggestion-item-name">{name}</span>
        <div className="suggestion-item-actions">
          <button className="suggestion-accept" onClick={() => onAccept(suggestion.id)} title="Accept">{'\u2713'}</button>
          <button className="suggestion-dismiss" onClick={() => onDismiss(suggestion.id)} title="Dismiss">{'\u2717'}</button>
        </div>
      </div>
      {typeof data.description === 'string' && (
        <div className="suggestion-item-desc">{data.description}</div>
      )}
    </div>
  );
}
