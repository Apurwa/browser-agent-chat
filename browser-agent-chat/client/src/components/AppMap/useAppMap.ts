import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useWS } from '../../contexts/WebSocketContext';
import { apiAuthFetch } from '../../lib/api';

export interface MapNode {
  id: string;
  urlPattern: string;
  pageTitle: string;
  firstSeenAt: string;
  lastSeenAt: string;
  features: Array<{
    id: string;
    name: string;
    description: string | null;
    criticality: string;
    expected_behaviors: string[];
    flows: Array<{
      id: string;
      name: string;
      steps: Array<{ action: string; target?: string }>;
      checkpoints: string[];
      criticality: string;
    }>;
  }>;
  pendingSuggestions: Array<{
    id: string;
    type: string;
    status: string;
    data: Record<string, unknown>;
    project_id: string;
  }>;
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

export function useAppMap(projectId: string): AppMapData {
  const { getAccessToken } = useAuth();
  const ws = useWS();
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
      const res = await apiAuthFetch(`/api/projects/${projectId}/map`, token);
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
      setUnlinkedSuggestions(data.unlinkedSuggestions || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId, getAccessToken]);

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
