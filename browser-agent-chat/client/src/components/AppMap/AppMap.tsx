import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import RootNode from './nodes/RootNode'
import SectionNode from './nodes/SectionNode'
import FeatureNode from './nodes/FeatureNode'
import NavEdge from './NavEdge'
import GraphToolbar from './GraphToolbar'
import GraphTreePanel from './GraphTreePanel'
import GraphDetailPanel from './GraphDetailPanel'
import { useAppMap } from './useAppMap'
import { useExpandCollapse } from './useExpandCollapse'
import { useELKLayout } from './useELKLayout'
import { useGraphStore } from './GraphStore'
import './AppMap.css'

const EXPLORATION_ICONS: Record<string, string> = {
  explored: '\u25CF', unknown: '\u25CB', exploring: '\u27F3', failed: '\u26A0',
}

const nodeTypes = { root: RootNode, section: SectionNode, feature: FeatureNode }
const edgeTypes = { nav: NavEdge }

interface AppMapProps {
  agentId: string
  onSendTask: (task: string) => void
  onExplore?: () => void
}

function AppMapInner({ agentId, onSendTask, onExplore }: AppMapProps) {
  const { nodes: mapNodes, edges: mapEdges, unlinkedSuggestions, loading, error, refresh } = useAppMap(agentId)
  const { visibleNodes, visibleEdges } = useExpandCollapse()
  const { computeLayout, isReady } = useELKLayout()
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const selectNode = useGraphStore(s => s.selectNode)
  const storeNodes = useGraphStore(s => s.nodes)
  const prevPositionsRef = useRef<Record<string, { x: number; y: number }>>({})
  const reactFlow = useReactFlow()

  const searchQuery = useGraphStore(s => s.searchQuery)

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([] as Node[])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[])

  const handleExploreNode = useCallback((nodeId: string) => {
    const node = storeNodes.find(n => n.id === nodeId)
    if (node?.urlPattern) {
      onSendTask(`Navigate to ${node.urlPattern} and explore the page. Identify interactive elements, forms, and available features.`)
    }
  }, [storeNodes, onSendTask])

  // Run ELK layout when visible nodes/edges change
  useEffect(() => {
    if (!isReady || visibleNodes.length === 0) return

    // Save previous positions for interpolation
    for (const n of rfNodes) {
      prevPositionsRef.current[n.id] = n.position
    }

    computeLayout(visibleNodes, visibleEdges).then(positions => {
      const lowerQuery = searchQuery.toLowerCase().trim()
      const newNodes: Node[] = visibleNodes.map(n => {
        // Find the original MapNode to pass existing data
        const mapNode = mapNodes.find(mn => mn.id === n.id)
        const isSearchMatch = lowerQuery.length > 0 && (
          n.label.toLowerCase().includes(lowerQuery) ||
          (n.urlPattern ?? '').toLowerCase().includes(lowerQuery)
        )
        return {
          id: n.id,
          type: n.type as string,
          position: positions[n.id] ?? prevPositionsRef.current[n.id] ?? { x: 0, y: 0 },
          data: {
            label: n.label,
            urlPattern: n.urlPattern,
            featureCount: n.featureCount,
            criticality: n.criticality,
            childIds: n.childIds,
            explorationIcon: EXPLORATION_ICONS[n.state.exploration] ?? '\u25CB',
            explorationLabel: n.state.exploration,
            isSelected: n.id === selectedNodeId,
            searchMatch: isSearchMatch,
            onExploreNode: handleExploreNode,
            // Backward compat for existing data
            pageTitle: mapNode?.pageTitle ?? n.label,
            features: mapNode?.features ?? [],
            pendingSuggestions: mapNode?.pendingSuggestions ?? [],
            isNew: mapNode?.isNew,
          },
          style: { transition: 'transform 250ms ease-out' },
        }
      })

      setRfNodes(newNodes)
      setRfEdges(visibleEdges.map(e => {
        const mapEdge = mapEdges.find(me => me.id === e.id)
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'nav' as const,
          data: { actionLabel: mapEdge?.actionLabel ?? e.label, isUnexplored: false },
        }
      }))
    })
  }, [visibleNodes, visibleEdges, isReady, selectedNodeId, searchQuery, handleExploreNode, mapNodes, mapEdges, computeLayout, setRfNodes, setRfEdges])

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    selectNode(node.id)
  }, [selectNode])

  const handleCenterNode = useCallback((nodeId: string) => {
    const targetNode = rfNodes.find(n => n.id === nodeId)
    if (targetNode) {
      reactFlow.setCenter(
        targetNode.position.x + 80,
        targetNode.position.y + 30,
        { zoom: 1.2, duration: 400 },
      )
    }
  }, [rfNodes, reactFlow])

  if (loading) return <div className="app-map-loading">Loading app map...</div>
  if (error) return <div className="app-map-error">Error: {error}</div>
  if (storeNodes.length === 0 && mapNodes.length === 0) {
    return (
      <div className="app-map-empty">
        <p>No map data yet.</p>
        <p>Start an exploration to build the app map.</p>
        {onExplore && <button className="btn-add" onClick={onExplore}>Explore &amp; Learn</button>}
      </div>
    )
  }

  return (
    <div className="app-map">
      <GraphToolbar />
      <div className="app-map-main">
        <GraphTreePanel onCenterNode={handleCenterNode} />
        <div className="app-map-graph">
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
      </div>
      <GraphDetailPanel
        agentId={agentId}
        onSendTask={onSendTask}
        onRefresh={refresh}
        mapNodes={mapNodes}
        mapEdges={mapEdges}
        unlinkedSuggestions={unlinkedSuggestions}
      />
    </div>
  )
}

// Wrap with ReactFlowProvider so useReactFlow() works
import { ReactFlowProvider } from '@xyflow/react'

export default function AppMap(props: AppMapProps) {
  return (
    <ReactFlowProvider>
      <AppMapInner {...props} />
    </ReactFlowProvider>
  )
}
