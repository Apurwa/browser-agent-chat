import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useWS } from '../../contexts/WebSocketContext';
import { apiAuthFetch } from '../../lib/api';
import { buildCanonicalGraph } from './CanonicalGraph';
import { projectNavigation, projectCapabilities } from './GraphProjectionLayer';
import { useGraphStore } from './GraphStore';

export interface MapFlowStep {
  order: number;
  description: string;
  url?: string;
}

export interface MapCheckpoint {
  description: string;
  expected: string;
}

export interface MapFlow {
  id: string;
  name: string;
  steps: MapFlowStep[];
  checkpoints: MapCheckpoint[];
  criticality: string;
}

export interface MapFeature {
  id: string;
  name: string;
  description: string | null;
  criticality: string;
  expected_behaviors: string[];
  flows?: MapFlow[];
}

export interface MapSuggestion {
  id: string;
  type: string;
  status: string;
  data: Record<string, unknown>;
  agent_id: string;
  source_session: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface MapNode {
  id: string;
  urlPattern: string;
  pageTitle: string;
  firstSeenAt: string;
  lastSeenAt: string;
  features: MapFeature[];
  pendingSuggestions: MapSuggestion[];
  isNew?: boolean;
}

export interface MapEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
}

interface AppMapData {
  nodes: MapNode[];
  edges: MapEdge[];
  unlinkedSuggestions: MapNode['pendingSuggestions'];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAppMap(agentId: string): AppMapData {
  const { getAccessToken } = useAuth();
  const ws = useWS();
  const mode = useGraphStore(state => state.mode);
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [unlinkedSuggestions, setUnlinkedSuggestions] = useState<MapNode['pendingSuggestions']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevNodeIdsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMap = useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/agents/${agentId}/map?mode=${mode}`, token);
      if (!res.ok) throw new Error('Failed to load map');
      const data = await res.json();

      const prevIds = prevNodeIdsRef.current;
      const newNodes: MapNode[] = data.nodes.map((n: MapNode) => ({
        ...n,
        isNew: prevIds.size > 0 && !prevIds.has(n.id),
      }));

      prevNodeIdsRef.current = new Set(newNodes.map((n: MapNode) => n.id));
      setNodes(newNodes);
      setEdges(data.edges);

      // Feed the graph pipeline into the zustand store based on mode
      if (mode === 'capabilities' && data.capabilityClusters) {
        const projected = projectCapabilities(data.capabilityClusters);
        useGraphStore.getState().setGraph(projected.nodes, projected.edges);
      } else {
        const canonical = buildCanonicalGraph(data);
        const projected = projectNavigation(canonical);
        useGraphStore.getState().setGraph(projected.nodes, projected.edges);

        // Auto-expand the root node so the initial view shows sections
        const rootNode = projected.nodes.find(n => n.type === 'root');
        if (rootNode) {
          const { expandedNodeIds, toggleExpand } = useGraphStore.getState();
          if (!expandedNodeIds.has(rootNode.id)) {
            toggleExpand(rootNode.id);
          }
        }
      }

      setUnlinkedSuggestions(data.unlinkedSuggestions || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [agentId, getAccessToken, mode]);

  // Initial fetch
  useEffect(() => {
    fetchMap();
  }, [fetchMap]);

  // Debounced re-fetch to avoid hammering the server on rapid WS events
  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchMap();
    }, 200);
  }, [fetchMap]);

  // Re-fetch when agent navigates to a new URL
  useEffect(() => {
    if (ws.currentUrl) {
      debouncedRefresh();
    }
  }, [ws.currentUrl, debouncedRefresh]);

  // Re-fetch when new suggestions arrive
  useEffect(() => {
    if (ws.pendingSuggestionCount > 0) {
      debouncedRefresh();
    }
  }, [ws.pendingSuggestionCount, debouncedRefresh]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    nodes,
    edges,
    unlinkedSuggestions,
    loading,
    error,
    refresh: fetchMap,
  };
}
