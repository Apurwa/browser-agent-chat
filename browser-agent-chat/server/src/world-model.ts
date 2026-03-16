import { supabase, isSupabaseEnabled } from './supabase.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface WorldPage {
  id: string;
  agentId: string;
  urlPattern: string;
  pageTitle: string;
  description: string;
  purpose: string | null;
  availableActions: any[];
  visited: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface WorldEdge {
  id: string;
  agentId: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
  selector: string | null;
  rawTarget: string | null;
  discoveredAt: string;
}

interface WorldFeature {
  id: string;
  agentId: string;
  name: string;
  description: string | null;
  criticality: string;
}

interface DiscoveryStats {
  pagesDiscovered: number;
  flowsDiscovered: number;
  elementsIndexed: number;
}

interface WorldModel {
  pages: WorldPage[];
  edges: WorldEdge[];
  features: WorldFeature[];
  discoveryStats: DiscoveryStats;
}

function mapPage(row: any): WorldPage {
  return {
    id: row.id,
    agentId: row.agent_id,
    urlPattern: row.url_pattern,
    pageTitle: row.page_title ?? '',
    description: row.description ?? '',
    purpose: row.purpose ?? null,
    availableActions: Array.isArray(row.available_actions) ? row.available_actions : [],
    visited: row.visited === true,
    firstSeenAt: row.first_seen_at ?? '',
    lastSeenAt: row.last_seen_at ?? '',
  };
}

function mapEdge(row: any): WorldEdge {
  return {
    id: row.id,
    agentId: row.agent_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    actionLabel: row.action_label ?? '',
    selector: row.selector ?? null,
    rawTarget: row.raw_target ?? null,
    discoveredAt: row.discovered_at ?? '',
  };
}

function mapFeature(row: any): WorldFeature {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description ?? null,
    criticality: row.criticality ?? 'medium',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load full world model for an agent: known pages, edges, memory features,
 * and discovery statistics.
 */
export async function loadWorldModel(agentId: string): Promise<WorldModel> {
  const empty: WorldModel = {
    pages: [],
    edges: [],
    features: [],
    discoveryStats: { pagesDiscovered: 0, flowsDiscovered: 0, elementsIndexed: 0 },
  };

  if (!isSupabaseEnabled()) return empty;

  // 1. Load pages (nav_nodes with extended columns)
  const { data: nodeRows, error: nodeErr } = await supabase!
    .from('nav_nodes')
    .select('*')
    .eq('agent_id', agentId)
    .order('first_seen_at', { ascending: true });

  if (nodeErr || !nodeRows) {
    console.error('[WORLD-MODEL] loadWorldModel nodes error:', nodeErr);
    return empty;
  }

  const pages = nodeRows.map(mapPage);

  // 2. Load edges (nav_edges)
  const { data: edgeRows, error: edgeErr } = await supabase!
    .from('nav_edges')
    .select('*')
    .eq('agent_id', agentId);

  if (edgeErr) {
    console.error('[WORLD-MODEL] loadWorldModel edges error:', edgeErr);
    return { ...empty, pages };
  }

  const edges = (edgeRows || []).map(mapEdge);

  // 3. Load memory features
  const { data: featureRows, error: featureErr } = await supabase!
    .from('memory_features')
    .select('*')
    .eq('agent_id', agentId);

  if (featureErr) {
    console.error('[WORLD-MODEL] loadWorldModel features error:', featureErr);
  }

  const features = (featureRows || []).map(mapFeature);

  // 4. Compute discovery stats
  const elementsIndexed = pages.reduce(
    (sum, page) => sum + page.availableActions.length,
    0,
  );

  return {
    pages,
    edges,
    features,
    discoveryStats: {
      pagesDiscovered: pages.length,
      flowsDiscovered: features.length,
      elementsIndexed,
    },
  };
}

/**
 * Update the semantic purpose and available actions for a known page node.
 */
export async function updatePagePurpose(
  nodeId: string,
  purpose: string,
  availableActions: any[],
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('nav_nodes')
    .update({ purpose, available_actions: availableActions })
    .eq('id', nodeId);

  if (error) {
    console.error('[WORLD-MODEL] updatePagePurpose error:', error);
  }
}

/**
 * Mark a page node as visited by the agent.
 */
export async function markPageVisited(nodeId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('nav_nodes')
    .update({ visited: true })
    .eq('id', nodeId);

  if (error) {
    console.error('[WORLD-MODEL] markPageVisited error:', error);
  }
}

/**
 * Serialize the world model into a human-readable text block suitable for
 * inclusion in an LLM context window.
 */
export async function getWorldContext(agentId: string): Promise<string> {
  if (!isSupabaseEnabled()) return '';

  const model = await loadWorldModel(agentId);

  if (model.pages.length === 0) return '';

  const lines: string[] = [];

  // Pages section
  lines.push('WORLD MODEL — KNOWN PAGES:');
  for (const page of model.pages) {
    const status = page.visited ? '[visited]' : '[unvisited]';
    const purposePart = page.purpose ? ` — ${page.purpose}` : '';
    lines.push(`  ${page.urlPattern} "${page.pageTitle}" ${status}${purposePart}`);
  }

  // Edges section
  if (model.edges.length > 0) {
    lines.push('TRANSITIONS:');
    for (const edge of model.edges) {
      const label = edge.actionLabel ? ` (${edge.actionLabel})` : '';
      lines.push(`  ${edge.fromNodeId} → ${edge.toNodeId}${label}`);
    }
  }

  // Features section
  if (model.features.length > 0) {
    lines.push('FEATURES:');
    for (const feature of model.features) {
      const desc = feature.description ? ` — ${feature.description}` : '';
      lines.push(`  ${feature.name} [${feature.criticality}]${desc}`);
    }
  }

  // Stats summary
  const { discoveryStats: ds } = model;
  lines.push(
    `STATS: ${ds.pagesDiscovered} pages discovered, ${ds.flowsDiscovered} features, ${ds.elementsIndexed} elements indexed`,
  );

  return lines.join('\n');
}
