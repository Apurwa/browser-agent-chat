import { useMemo, useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import PageNode from './PageNode';
import NavEdge from './NavEdge';
import DetailPanel from './DetailPanel';
import { useAppMap } from './useAppMap';
import type { MapNode, MapEdge } from './useAppMap';
import './AppMap.css';

const nodeTypes = { page: PageNode };
const edgeTypes = { nav: NavEdge };

/** BFS layout: place nodes in rows by distance from root. */
function layoutNodes(mapNodes: MapNode[], mapEdges: MapEdge[]): Node[] {
  if (mapNodes.length === 0) return [];

  const outDegree = new Map<string, number>();
  for (const e of mapEdges) {
    outDegree.set(e.fromNodeId, (outDegree.get(e.fromNodeId) || 0) + 1);
  }

  // Sort by firstSeenAt (earliest first), break ties by outDegree (highest first)
  const sorted = [...mapNodes].sort((a, b) => {
    const timeDiff = new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (outDegree.get(b.id) || 0) - (outDegree.get(a.id) || 0);
  });
  const rootId = sorted[0].id;

  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const e of mapEdges) {
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    adj.get(e.fromNodeId)!.push(e.toNodeId);
  }

  // BFS from root to compute depths
  const depth = new Map<string, number>();
  const queue = [rootId];
  depth.set(rootId, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const d = depth.get(current)!;
    for (const neighbor of adj.get(current) || []) {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, d + 1);
        queue.push(neighbor);
      }
    }
  }

  // Unreachable nodes get depth 999
  for (const n of mapNodes) {
    if (!depth.has(n.id)) depth.set(n.id, 999);
  }

  // Group by depth
  const byDepth = new Map<number, MapNode[]>();
  for (const n of mapNodes) {
    const d = depth.get(n.id)!;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n);
  }

  const Y_GAP = 180;
  const X_GAP = 220;
  const nodes: Node[] = [];

  for (const [d, group] of byDepth) {
    const totalWidth = (group.length - 1) * X_GAP;
    const startX = -totalWidth / 2;
    group.forEach((n, i) => {
      nodes.push({
        id: n.id,
        type: 'page' as const,
        position: {
          x: startX + i * X_GAP,
          y: d === 999 ? (byDepth.size - 1) * Y_GAP + 60 : d * Y_GAP,
        },
        data: {
          pageTitle: n.pageTitle,
          urlPattern: n.urlPattern,
          features: n.features,
          pendingSuggestions: n.pendingSuggestions,
          isNew: n.isNew,
        },
      });
    });
  }

  return nodes;
}

function layoutEdges(mapEdges: MapEdge[], mapNodes: MapNode[]): Edge[] {
  const nodeById = new Map(mapNodes.map(n => [n.id, n]));
  return mapEdges.map(e => {
    const targetNode = nodeById.get(e.toNodeId);
    const isUnexplored = targetNode
      ? targetNode.features.length === 0 && targetNode.pendingSuggestions.length === 0
      : false;
    return {
      id: e.id,
      source: e.fromNodeId,
      target: e.toNodeId,
      type: 'nav' as const,
      data: { actionLabel: e.actionLabel, isUnexplored },
    };
  });
}

interface AppMapProps {
  agentId: string;
  onSendTask: (task: string) => void;
  onExplore?: () => void;
}

export default function AppMap({ agentId, onSendTask, onExplore }: AppMapProps) {
  const { nodes: mapNodes, edges: mapEdges, unlinkedSuggestions, loading, error, refresh } = useAppMap(agentId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const initialNodes = useMemo(() => layoutNodes(mapNodes, mapEdges), [mapNodes, mapEdges]);
  const initialEdges = useMemo(() => layoutEdges(mapEdges, mapNodes), [mapEdges, mapNodes]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync layout when map data changes
  useEffect(() => {
    const newLayout = layoutNodes(mapNodes, mapEdges);
    setRfNodes(prev => {
      const prevPositions = new Map(prev.map(n => [n.id, n.position]));
      return newLayout.map(n => ({
        ...n,
        position: prevPositions.get(n.id) || n.position,
        data: {
          ...n.data,
          isSelected: n.id === selectedNodeId,
        },
      }));
    });
    setRfEdges(layoutEdges(mapEdges, mapNodes));
  }, [mapNodes, mapEdges, selectedNodeId, setRfNodes, setRfEdges]);

  const selectedNode = mapNodes.find(n => n.id === selectedNodeId) || null;

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNodeId(prev => prev === node.id ? null : node.id);
  }, []);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  if (loading) {
    return <div className="app-map-loading">Loading app map...</div>;
  }

  if (error) {
    return <div className="app-map-error">Error: {error}</div>;
  }

  if (mapNodes.length === 0) {
    return (
      <div className="app-map-empty">
        <p>No map data yet.</p>
        <p>Start an exploration to build the app map.</p>
        {onExplore && (
          <button className="btn-add" onClick={onExplore}>Explore & Learn</button>
        )}
      </div>
    );
  }

  return (
    <div className="app-map">
      <div className="app-map-graph">
        <div className="app-map-toolbar">
          <span className="app-map-stats">
            {mapNodes.length} pages &middot; {mapNodes.reduce((s, n) => s + n.features.length, 0)} features
          </span>
        </div>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.3}
          maxZoom={2}
        >
          <Background color="var(--border-subtle, #252218)" gap={24} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor="var(--brand, #3D6B4F)"
            maskColor="rgba(0,0,0,0.5)"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
          />
        </ReactFlow>
      </div>
      <DetailPanel
        selectedNode={selectedNode}
        unlinkedSuggestions={unlinkedSuggestions}
        agentId={agentId}
        onRefresh={refresh}
        onSendTask={onSendTask}
        onSelectNode={handleSelectNode}
        edges={mapEdges}
        nodes={mapNodes}
      />
    </div>
  );
}
