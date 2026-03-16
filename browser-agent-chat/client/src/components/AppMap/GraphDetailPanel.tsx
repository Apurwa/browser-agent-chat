import { useState, useCallback, useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { apiAuthFetch } from '../../lib/api'
import FeatureCard from './FeatureCard'
import { useGraphStore } from './GraphStore'
import type { MapNode, MapEdge } from './useAppMap'

interface GraphDetailPanelProps {
  agentId: string
  onSendTask: (task: string) => void
  onRefresh: () => void
  mapNodes: MapNode[]
  mapEdges: MapEdge[]
  unlinkedSuggestions: MapNode['pendingSuggestions']
}

const CRITICALITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

export default function GraphDetailPanel({
  agentId, onSendTask, onRefresh, mapNodes, mapEdges, unlinkedSuggestions,
}: GraphDetailPanelProps) {
  const { getAccessToken } = useAuth()
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const selectNode = useGraphStore(s => s.selectNode)
  const [collapsed, setCollapsed] = useState(false)

  const selectedNode = useMemo(
    () => mapNodes.find(n => n.id === selectedNodeId) ?? null,
    [mapNodes, selectedNodeId],
  )

  const connectedNodes = useMemo(() => {
    if (!selectedNode) return []
    const outbound = mapEdges
      .filter(e => e.fromNodeId === selectedNode.id)
      .map(e => ({ nodeId: e.toNodeId, direction: 'to' as const }))
    const inbound = mapEdges
      .filter(e => e.toNodeId === selectedNode.id)
      .map(e => ({ nodeId: e.fromNodeId, direction: 'from' as const }))
    return [...inbound, ...outbound]
      .map(c => ({ ...c, node: mapNodes.find(n => n.id === c.nodeId) }))
      .filter(c => c.node)
  }, [selectedNode, mapEdges, mapNodes])

  const sortedFeatures = useMemo(() => {
    if (!selectedNode) return []
    return [...selectedNode.features].sort((a, b) =>
      (CRITICALITY_ORDER[a.criticality] ?? 3) - (CRITICALITY_ORDER[b.criticality] ?? 3)
    )
  }, [selectedNode])

  const handleAccept = useCallback(async (suggestionId: string) => {
    try {
      const token = await getAccessToken()
      await apiAuthFetch(`/api/agents/${agentId}/suggestions/${suggestionId}/accept`, token, {
        method: 'PUT',
      })
      onRefresh()
    } catch (err) {
      console.error('Failed to accept suggestion:', err)
    }
  }, [agentId, getAccessToken, onRefresh])

  const handleDismiss = useCallback(async (suggestionId: string) => {
    try {
      const token = await getAccessToken()
      await apiAuthFetch(`/api/agents/${agentId}/suggestions/${suggestionId}/dismiss`, token, {
        method: 'PUT',
      })
      onRefresh()
    } catch (err) {
      console.error('Failed to dismiss suggestion:', err)
    }
  }, [agentId, getAccessToken, onRefresh])

  const handleReExplore = useCallback(() => {
    if (!selectedNode) return
    onSendTask(`Navigate to ${selectedNode.urlPattern} and identify all features, interactions, and flows on this page.`)
  }, [selectedNode, onSendTask])

  const handleSelectNode = useCallback((nodeId: string) => {
    selectNode(nodeId)
  }, [selectNode])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => !prev)
  }, [])

  // Combine pending suggestions from selected node + unlinked
  const allSuggestions = useMemo(() => {
    const nodeSuggestions = selectedNode?.pendingSuggestions ?? []
    return [...nodeSuggestions, ...unlinkedSuggestions]
  }, [selectedNode, unlinkedSuggestions])

  return (
    <div className={`graph-detail-panel ${collapsed ? 'graph-detail-panel--collapsed' : ''}`}>
      <div className="graph-detail-panel-header">
        <span className="graph-detail-panel-header-title">
          {selectedNode ? (selectedNode.pageTitle || 'Untitled') : 'Details'}
        </span>
        {selectedNode && (
          <span className="graph-detail-panel-header-url">{selectedNode.urlPattern}</span>
        )}
        <div className="graph-detail-panel-header-actions">
          {selectedNode && (
            <button className="detail-action" onClick={handleReExplore}>Re-explore</button>
          )}
          <button
            className="graph-detail-panel-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand detail panel' : 'Collapse detail panel'}
          >
            {collapsed ? '\u25B2' : '\u25BC'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="graph-detail-panel-body">
          {/* Section 1: Features */}
          <div className="graph-detail-panel-section">
            <div className="detail-panel-label">
              FEATURES {selectedNode ? `(${selectedNode.features.length})` : ''}
            </div>
            {!selectedNode && (
              <div className="detail-panel-empty-features">Select a node to see features</div>
            )}
            {selectedNode && selectedNode.features.length === 0 && (
              <div className="detail-panel-empty-features">No features discovered yet</div>
            )}
            <div className="graph-detail-panel-scroll">
              {sortedFeatures.map(f => (
                <FeatureCard
                  key={f.id}
                  feature={f}
                  agentId={agentId}
                  pageTitle={selectedNode?.pageTitle ?? ''}
                  urlPattern={selectedNode?.urlPattern ?? ''}
                  onSendTask={onSendTask}
                  onRefresh={onRefresh}
                />
              ))}
            </div>
          </div>

          {/* Section 2: Suggestions */}
          <div className="graph-detail-panel-section">
            <div className={`detail-panel-label ${allSuggestions.length > 0 ? 'detail-panel-label--pending' : ''}`}>
              SUGGESTIONS {allSuggestions.length > 0 ? `(${allSuggestions.length})` : ''}
            </div>
            <div className="graph-detail-panel-scroll">
              {allSuggestions.length === 0 && (
                <div className="detail-panel-empty-features">No pending suggestions</div>
              )}
              {allSuggestions.map(s => (
                <SuggestionItem
                  key={s.id}
                  suggestion={s}
                  onAccept={handleAccept}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          </div>

          {/* Section 3: Connected Nodes */}
          <div className="graph-detail-panel-section">
            <div className="detail-panel-label">CONNECTIONS</div>
            <div className="graph-detail-panel-scroll">
              {connectedNodes.length === 0 && (
                <div className="detail-panel-empty-features">
                  {selectedNode ? 'No connections' : 'Select a node'}
                </div>
              )}
              {connectedNodes.length > 0 && (
                <div className="connected-chips">
                  {connectedNodes.map(c => (
                    <button
                      key={`${c.direction}-${c.nodeId}`}
                      className="connected-chip"
                      onClick={() => handleSelectNode(c.nodeId)}
                    >
                      {c.direction === 'from' ? '\u2190 ' : ''}{c.node!.pageTitle || c.node!.urlPattern}{c.direction === 'to' ? ' \u2192' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionItem({ suggestion, onAccept, onDismiss }: {
  suggestion: MapNode['pendingSuggestions'][number]
  onAccept: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const data = suggestion.data
  const name = (data.name || data.feature_name || data.behavior || 'Unknown') as string

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
  )
}
