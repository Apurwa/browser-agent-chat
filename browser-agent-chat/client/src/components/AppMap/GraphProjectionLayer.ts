import type { CanonicalGraph, AppNode, AppEdge, NodeState, GraphEntity } from './types'
import { DEFAULT_NODE_STATE } from './types'

interface CapabilityCluster {
  id: string
  name: string
  sourcePageIds: string[]
  features: Array<{ id: string; name: string; criticality: string; [key: string]: unknown }>
  dependencies: string[]
}

export function projectCapabilities(
  clusters: readonly CapabilityCluster[],
): { nodes: AppNode[]; edges: AppEdge[] } {
  const nodes: AppNode[] = []
  const edges: AppEdge[] = []

  for (const cluster of clusters) {
    const featureIds = cluster.features.map(f => f.id)
    nodes.push({
      id: cluster.id,
      type: 'section',
      label: cluster.name,
      state: { ...DEFAULT_NODE_STATE, exploration: cluster.features.length > 0 ? 'explored' : 'unknown' },
      featureCount: cluster.features.length,
      criticality: getHighestCriticality(
        cluster.features.map(f => ({ id: f.id, kind: 'feature' as const, metadata: { criticality: f.criticality } }))
      ),
      childIds: featureIds,
    })

    for (const feature of cluster.features) {
      nodes.push({
        id: feature.id,
        type: 'feature',
        label: feature.name,
        parent: cluster.id,
        state: DEFAULT_NODE_STATE,
        childIds: [],
        criticality: feature.criticality as AppNode['criticality'],
      })
    }

    for (const depId of cluster.dependencies) {
      edges.push({
        id: `dep-${cluster.id}-${depId}`,
        source: cluster.id,
        target: depId,
        type: 'dependency',
      })
    }
  }

  return { nodes, edges }
}

const CRITICALITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

function getHighestCriticality(features: readonly GraphEntity[]): AppNode['criticality'] {
  if (features.length === 0) return undefined
  let highest = 'low'
  for (const f of features) {
    const crit = f.metadata.criticality as string
    if ((CRITICALITY_ORDER[crit] ?? 3) < (CRITICALITY_ORDER[highest] ?? 3)) {
      highest = crit
    }
  }
  return highest as AppNode['criticality']
}

export function projectNavigation(
  canonical: CanonicalGraph,
  currentUrl?: string,
): { nodes: AppNode[]; edges: AppEdge[] } {
  const pages = canonical.entities.filter(e => e.kind === 'page')
  const features = canonical.entities.filter(e => e.kind === 'feature')
  const navRelations = canonical.relations.filter(r => r.type === 'navigation')

  if (pages.length === 0) return { nodes: [], edges: [] }

  const sorted = [...pages].sort((a, b) => {
    const aTime = new Date(a.metadata.firstSeenAt as string).getTime()
    const bTime = new Date(b.metadata.firstSeenAt as string).getTime()
    return aTime - bTime
  })
  const rootId = sorted[0].id

  const childMap = new Map<string, string[]>()
  const parentMap = new Map<string, string>()
  for (const rel of navRelations) {
    const children = childMap.get(rel.from) ?? []
    childMap.set(rel.from, [...children, rel.to])
    if (!parentMap.has(rel.to)) {
      parentMap.set(rel.to, rel.from)
    }
  }

  const depth = new Map<string, number>()
  const queue = [rootId]
  depth.set(rootId, 0)
  while (queue.length > 0) {
    const current = queue.shift()!
    const d = depth.get(current)!
    for (const child of childMap.get(current) ?? []) {
      if (!depth.has(child)) {
        depth.set(child, d + 1)
        queue.push(child)
      }
    }
  }

  const featuresByPage = new Map<string, GraphEntity[]>()
  for (const f of features) {
    const pageId = f.metadata.pageId as string
    const list = featuresByPage.get(pageId) ?? []
    featuresByPage.set(pageId, [...list, f])
  }

  const nodes: AppNode[] = pages.map(page => {
    const pageFeatures = featuresByPage.get(page.id) ?? []
    const d = depth.get(page.id)
    const isExploring = currentUrl !== undefined &&
      (page.metadata.urlPattern as string) === currentUrl

    let explorationState: NodeState['exploration'] = 'unknown'
    if (isExploring) {
      explorationState = 'exploring'
    } else if (pageFeatures.length > 0) {
      explorationState = 'explored'
    }

    let nodeType: AppNode['type']
    if (page.id === rootId) {
      nodeType = 'root'
    } else if (d === 1) {
      nodeType = 'section'
    } else {
      nodeType = 'feature'
    }

    return {
      id: page.id,
      type: nodeType,
      label: (page.metadata.pageTitle as string) || (page.metadata.urlPattern as string),
      urlPattern: page.metadata.urlPattern as string,
      parent: parentMap.get(page.id),
      state: { ...DEFAULT_NODE_STATE, exploration: explorationState },
      featureCount: pageFeatures.length,
      criticality: getHighestCriticality(pageFeatures),
      childIds: childMap.get(page.id) ?? [],
      pendingSuggestions: page.metadata.pendingSuggestions as unknown[] ?? [],
    }
  })

  const edges: AppEdge[] = navRelations.map(rel => ({
    id: rel.id,
    source: rel.from,
    target: rel.to,
    type: 'navigation' as const,
    label: rel.metadata?.actionLabel as string,
  }))

  return { nodes, edges }
}
