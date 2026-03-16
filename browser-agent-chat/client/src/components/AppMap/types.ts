// --- Canonical Graph Model (internal representation) ---

export type GraphEntity = {
  readonly id: string
  readonly kind: 'page' | 'feature' | 'cluster'
  readonly sourceIds?: readonly string[]
  readonly metadata: Readonly<Record<string, unknown>>
}

export type GraphRelation = {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: 'navigation' | 'dependency' | 'cross-link'
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type CanonicalGraph = {
  readonly entities: readonly GraphEntity[]
  readonly relations: readonly GraphRelation[]
}

// --- Projected Graph (UI-ready) ---

export type NodeState = {
  readonly exploration: 'unknown' | 'exploring' | 'explored' | 'failed'
  readonly validation: 'untested' | 'tested' | 'verified'
}

export type AppNode = {
  readonly id: string
  readonly type: 'root' | 'section' | 'feature'
  readonly label: string
  readonly urlPattern?: string
  readonly parent?: string
  readonly state: NodeState
  readonly featureCount?: number
  readonly criticality?: 'critical' | 'high' | 'medium' | 'low'
  readonly childIds: readonly string[]
  readonly pendingSuggestions?: readonly unknown[]
}

export type AppEdge = {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly type: 'navigation' | 'dependency' | 'cross-link'
  readonly label?: string
}

export const DEFAULT_NODE_STATE: NodeState = {
  exploration: 'unknown',
  validation: 'untested',
} as const

export const MAX_VISIBLE_NODES = 300
export const MAX_CROSS_LINKS_PER_NODE = 3
