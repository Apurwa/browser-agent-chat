import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

type LayoutRequest = {
  id: string
  nodes: Array<{ id: string; width: number; height: number }>
  edges: Array<{ id: string; source: string; target: string }>
  options?: Record<string, string>
}

self.onmessage = async (event: MessageEvent<LayoutRequest>) => {
  const { id, nodes, edges, options } = event.data

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.layered.spacing.edgeNodeBetweenLayers': '40',
      'elk.spacing.nodeNode': '60',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      ...options,
    },
    children: nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  try {
    const result = await elk.layout(elkGraph)
    const positions: Record<string, { x: number; y: number }> = {}
    for (const child of result.children ?? []) {
      positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }
    }
    self.postMessage({ id, positions })
  } catch (err) {
    self.postMessage({ id, positions: {}, error: String(err) })
  }
}
