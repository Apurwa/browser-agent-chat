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

// --- Internal helpers ---

function mapNavNode(row: any): NavNode {
  return {
    id: row.id,
    projectId: row.project_id,
    urlPattern: row.url_pattern,
    pageTitle: row.page_title,
    description: row.description,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    features: [],
  };
}

function mapNavEdge(row: any): NavEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    actionLabel: row.action_label,
    selector: row.selector,
    discoveredAt: row.discovered_at,
  };
}

// --- Database operations ---

export async function upsertNode(
  projectId: string,
  url: string,
  title?: string,
  description?: string,
): Promise<NavNode | null> {
  if (!isSupabaseEnabled()) return null;

  const urlPattern = normalizeUrl(url);
  const payload: Record<string, string> = {
    project_id: projectId,
    url_pattern: urlPattern,
    last_seen_at: new Date().toISOString(),
  };
  if (title !== undefined) payload.page_title = title;
  if (description !== undefined) payload.description = description;

  const { data, error } = await supabase!
    .from('nav_nodes')
    .upsert(payload, { onConflict: 'project_id,url_pattern' })
    .select()
    .single();

  if (error) {
    console.error('[NAV-GRAPH] upsertNode error:', error);
    return null;
  }
  return mapNavNode(data);
}

export async function upsertEdge(
  projectId: string,
  fromNodeId: string,
  toNodeId: string,
  actionLabel: string,
  selector?: string,
): Promise<NavEdge | null> {
  if (!isSupabaseEnabled()) return null;

  const payload: Record<string, string> = {
    project_id: projectId,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    action_label: actionLabel || '',
  };
  if (selector) payload.selector = selector;

  const { data, error } = await supabase!
    .from('nav_edges')
    .upsert(payload, { onConflict: 'project_id,from_node_id,to_node_id,action_label' })
    .select()
    .single();

  if (error) {
    console.error('[NAV-GRAPH] upsertEdge error:', error);
    return null;
  }
  return mapNavEdge(data);
}

export async function linkFeatureToNode(nodeId: string, featureId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('nav_node_features')
    .upsert(
      { nav_node_id: nodeId, feature_id: featureId },
      { onConflict: 'nav_node_id,feature_id', ignoreDuplicates: true }
    );

  if (error) {
    console.error('[NAV-GRAPH] linkFeatureToNode error:', error);
  }
}

/**
 * High-level helper: record a navigation from one URL to another.
 * Creates/updates nodes and edge. Fire-and-forget — errors are logged, never thrown.
 */
export async function recordNavigation(
  projectId: string,
  fromUrl: string | null,
  toUrl: string,
  action?: string,
  selector?: string,
): Promise<void> {
  try {
    const toNode = await upsertNode(projectId, toUrl);
    if (!toNode) return;

    if (fromUrl) {
      const fromNode = await upsertNode(projectId, fromUrl);
      if (fromNode && fromNode.id !== toNode.id) {
        await upsertEdge(projectId, fromNode.id, toNode.id, action || '', selector);
      }
    }
  } catch (err) {
    console.error('[NAV-GRAPH] recordNavigation error:', err);
  }
}

export async function getGraph(projectId: string): Promise<NavGraph> {
  if (!isSupabaseEnabled()) return { nodes: [], edges: [] };

  // 1. Load nodes
  const { data: nodeRows, error: nodeErr } = await supabase!
    .from('nav_nodes')
    .select('*')
    .eq('project_id', projectId)
    .order('first_seen_at', { ascending: true });

  if (nodeErr || !nodeRows) {
    console.error('[NAV-GRAPH] getGraph nodes error:', nodeErr);
    return { nodes: [], edges: [] };
  }

  // 2. Load edges
  const { data: edgeRows, error: edgeErr } = await supabase!
    .from('nav_edges')
    .select('*')
    .eq('project_id', projectId);

  if (edgeErr) {
    console.error('[NAV-GRAPH] getGraph edges error:', edgeErr);
    return { nodes: [], edges: [] };
  }

  // 3. Load feature links (join with memory_features for names)
  const nodeIds = nodeRows.map((r: any) => r.id);
  const featuresByNode = new Map<string, string[]>();

  if (nodeIds.length > 0) {
    const { data: featureLinks, error: linkErr } = await supabase!
      .from('nav_node_features')
      .select('nav_node_id, memory_features(name)')
      .in('nav_node_id', nodeIds);

    if (!linkErr && featureLinks) {
      for (const link of featureLinks as any[]) {
        const nodeId = link.nav_node_id;
        const featureName = link.memory_features?.name;
        if (featureName) {
          const list = featuresByNode.get(nodeId) || [];
          list.push(featureName);
          featuresByNode.set(nodeId, list);
        }
      }
    }
  }

  return {
    nodes: nodeRows.map((r: any) => ({
      ...mapNavNode(r),
      features: featuresByNode.get(r.id) || [],
    })),
    edges: (edgeRows || []).map((r: any) => mapNavEdge(r)),
  };
}
