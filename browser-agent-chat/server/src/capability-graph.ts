import type { Feature } from './types.js'

export interface CapabilityCluster {
  id: string
  name: string
  sourcePageIds: string[]
  features: Feature[]
  dependencies: string[]
}

interface MinimalNode {
  id: string
  urlPattern: string
  pageTitle: string
  features: Feature[]
}

interface MinimalEdge {
  fromNodeId: string
  toNodeId: string
}

function getPathSegments(urlPattern: string): string[] {
  return urlPattern.split('/').filter(Boolean)
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function buildCapabilityClusters(
  nodes: readonly MinimalNode[],
  edges: readonly MinimalEdge[],
): CapabilityCluster[] {
  if (nodes.length === 0) return []

  const groups = new Map<string, MinimalNode[]>()
  for (const node of nodes) {
    const segments = getPathSegments(node.urlPattern)
    const key = segments[0] ?? '/'
    const group = groups.get(key) ?? []
    groups.set(key, [...group, node])
  }

  const finalGroups = new Map<string, MinimalNode[]>()
  for (const [key, group] of groups) {
    if (group.length > 6) {
      for (const node of group) {
        const segments = getPathSegments(node.urlPattern)
        const subKey = segments.length > 1 ? `${key}/${segments[1]}` : key
        const subGroup = finalGroups.get(subKey) ?? []
        finalGroups.set(subKey, [...subGroup, node])
      }
    } else {
      finalGroups.set(key, group)
    }
  }

  const nodeToClusterId = new Map<string, string>()
  const clusters: CapabilityCluster[] = []

  for (const [key, group] of finalGroups) {
    const clusterId = `cluster-${key}`
    const rootNode = group[0]
    const allFeatures = group.flatMap(n => n.features)
    clusters.push({
      id: clusterId,
      name: rootNode.pageTitle || titleCase(key),
      sourcePageIds: group.map(n => n.id),
      features: allFeatures,
      dependencies: [],
    })
    for (const node of group) {
      nodeToClusterId.set(node.id, clusterId)
    }
  }

  for (const edge of edges) {
    const fromCluster = nodeToClusterId.get(edge.fromNodeId)
    const toCluster = nodeToClusterId.get(edge.toNodeId)
    if (fromCluster && toCluster && fromCluster !== toCluster) {
      const cluster = clusters.find(c => c.id === fromCluster)
      if (cluster && !cluster.dependencies.includes(toCluster)) {
        cluster.dependencies = [...cluster.dependencies, toCluster]
      }
    }
  }

  return clusters
}
