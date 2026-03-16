import { useCallback, useRef, useEffect, useState } from 'react'
import type { AppNode } from './types'

type NodePosition = { x: number; y: number }

const NODE_SIZES: Record<string, { width: number; height: number }> = {
  root: { width: 200, height: 70 },
  section: { width: 160, height: 60 },
  feature: { width: 130, height: 50 },
}

export function useELKLayout() {
  const workerRef = useRef<Worker | null>(null)
  const callbackRef = useRef<Map<string, (positions: Record<string, NodePosition>) => void>>(new Map())
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const worker = new Worker(
      new URL('./elk-worker.ts', import.meta.url),
      { type: 'module' },
    )
    worker.onmessage = (event) => {
      const { id, positions } = event.data
      const cb = callbackRef.current.get(id)
      if (cb) {
        cb(positions)
        callbackRef.current.delete(id)
      }
    }
    workerRef.current = worker
    setIsReady(true)

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const computeLayout = useCallback(
    (
      nodes: readonly AppNode[],
      edges: readonly { id: string; source: string; target: string }[],
    ): Promise<Record<string, NodePosition>> => {
      return new Promise((resolve) => {
        if (!workerRef.current) {
          resolve({})
          return
        }

        const id = `layout-${Date.now()}-${Math.random()}`
        callbackRef.current.set(id, resolve)

        workerRef.current.postMessage({
          id,
          nodes: nodes.map(n => ({
            id: n.id,
            ...(NODE_SIZES[n.type] ?? NODE_SIZES.feature),
          })),
          edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
        })
      })
    },
    [],
  )

  return { computeLayout, isReady }
}
