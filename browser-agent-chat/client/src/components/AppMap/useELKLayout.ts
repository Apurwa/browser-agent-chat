import { useCallback } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { AppNode } from './types'

type NodePosition = { x: number; y: number }

const NODE_SIZES: Record<string, { width: number; height: number }> = {
  root: { width: 200, height: 70 },
  section: { width: 160, height: 60 },
  feature: { width: 130, height: 50 },
}

const elk = new ELK()

export function useELKLayout() {
  const computeLayout = useCallback(
    async (
      nodes: readonly AppNode[],
      edges: readonly { id: string; source: string; target: string }[],
    ): Promise<Record<string, NodePosition>> => {
      if (nodes.length === 0) return {}

      const elkGraph = {
        id: 'elk-root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.layered.spacing.nodeNodeBetweenLayers': '80',
          'elk.layered.spacing.edgeNodeBetweenLayers': '40',
          'elk.spacing.nodeNode': '60',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        },
        children: nodes.map(n => ({
          id: n.id,
          width: (NODE_SIZES[n.type] ?? NODE_SIZES.feature).width,
          height: (NODE_SIZES[n.type] ?? NODE_SIZES.feature).height,
        })),
        edges: edges.map(e => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
      }

      try {
        const result = await elk.layout(elkGraph)
        const positions: Record<string, NodePosition> = {}
        for (const child of result.children ?? []) {
          positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
        }
        return positions
      } catch (err) {
        console.error('[ELK] Layout failed:', err)
        return {}
      }
    },
    [],
  )

  return { computeLayout, isReady: true }
}
