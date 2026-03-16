import type { CanonicalGraph, GraphEntity, GraphRelation } from './types'
import type { MapNode, MapEdge } from './useAppMap'

interface ApiResponse {
  readonly nodes: readonly MapNode[]
  readonly edges: readonly MapEdge[]
  readonly unlinkedSuggestions: readonly unknown[]
}

export function buildCanonicalGraph(api: ApiResponse): CanonicalGraph {
  const entities: GraphEntity[] = []
  const relations: GraphRelation[] = []

  for (const node of api.nodes) {
    entities.push({
      id: node.id,
      kind: 'page',
      metadata: {
        urlPattern: node.urlPattern,
        pageTitle: node.pageTitle,
        firstSeenAt: node.firstSeenAt,
        lastSeenAt: node.lastSeenAt,
        pendingSuggestions: node.pendingSuggestions,
      },
    })

    for (const feature of node.features) {
      entities.push({
        id: feature.id,
        kind: 'feature',
        sourceIds: [node.id],
        metadata: {
          name: feature.name,
          description: feature.description,
          criticality: feature.criticality,
          expected_behaviors: feature.expected_behaviors,
          flows: feature.flows,
          pageId: node.id,
        },
      })
    }
  }

  for (const edge of api.edges) {
    relations.push({
      id: edge.id,
      from: edge.fromNodeId,
      to: edge.toNodeId,
      type: 'navigation',
      metadata: { actionLabel: edge.actionLabel },
    })
  }

  return { entities, relations }
}
