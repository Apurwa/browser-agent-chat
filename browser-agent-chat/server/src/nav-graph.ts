import { supabase, isSupabaseEnabled } from './supabase.js';
import type { NavNode, NavEdge, NavGraph } from './types.js';

/**
 * Normalize a URL to a canonical pattern for deduplication.
 * Strips query params, hash fragments, collapses numeric/UUID path segments.
 */
export function normalizeUrl(url: string): string {
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
  } catch {
    // Not a full URL — treat as path, strip query/hash manually
    path = url.split('?')[0].split('#')[0];
  }

  // Remove trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // Collapse UUID segments (must run before numeric to avoid partial match)
  path = path.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '/:id'
  );

  // Collapse numeric-only segments
  path = path.replace(/\/\d+(?=\/|$)/g, '/:id');

  return path || '/';
}

export interface SerializeOptions {
  maxNodes?: number;
}

/**
 * Serialize a navigation graph into a prompt-friendly text block.
 * When maxNodes is set, only the first N nodes are rendered. Edges pointing
 * to or from excluded nodes are silently omitted.
 */
export function serializeGraph(graph: NavGraph, options?: SerializeOptions): string {
  if (graph.nodes.length === 0) return '';

  const nodes = options?.maxNodes
    ? graph.nodes.slice(0, options.maxNodes)
    : graph.nodes;

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edgesByFrom = new Map<string, NavEdge[]>();
  for (const edge of graph.edges) {
    const list = edgesByFrom.get(edge.fromNodeId) || [];
    list.push(edge);
    edgesByFrom.set(edge.fromNodeId, list);
  }

  const lines: string[] = ['SITE MAP:'];
  for (const node of nodes) {
    const features = node.features ?? [];
    const featurePart = features.length > 0
      ? ` [features: ${features.join(', ')}]`
      : '';
    lines.push(`${node.urlPattern} → "${node.pageTitle}"${featurePart}`);

    const edges = edgesByFrom.get(node.id) || [];
    for (const edge of edges) {
      const target = nodeMap.get(edge.toNodeId);
      if (target) {
        const actionPart = edge.actionLabel ? ` (${edge.actionLabel})` : '';
        lines.push(`  → ${target.urlPattern}${actionPart}`);
      }
    }
  }

  return lines.join('\n');
}
