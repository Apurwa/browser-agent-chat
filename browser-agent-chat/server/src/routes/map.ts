import { Router } from 'express';
import { getGraph, normalizeUrl } from '../nav-graph.js';
import { listFeatures, listPendingSuggestions } from '../db.js';
import { requireAuth } from '../auth.js';
import type { Feature, Suggestion, FeatureSuggestionData, FlowSuggestionData, BehaviorSuggestionData } from '../types.js';

const router = Router({ mergeParams: true });

export interface AppMapNode {
  id: string;
  urlPattern: string;
  pageTitle: string;
  firstSeenAt: string;
  lastSeenAt: string;
  features: Feature[];
  pendingSuggestions: Suggestion[];
}

export interface AppMapEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
}

export interface AppMapResponse {
  nodes: AppMapNode[];
  edges: AppMapEdge[];
  unlinkedSuggestions: Suggestion[];
}

export async function buildAppMapResponse(agentId: string): Promise<AppMapResponse> {
  const [graph, allFeatures, pendingSuggestions] = await Promise.all([
    getGraph(agentId),
    listFeatures(agentId),
    listPendingSuggestions(agentId),
  ]);

  const featureByName = new Map<string, Feature>();
  for (const f of allFeatures) {
    featureByName.set(f.name.toLowerCase(), f);
  }

  const featureNameToNodeId = new Map<string, string>();

  const nodes: AppMapNode[] = graph.nodes.map(n => {
    const features: Feature[] = [];
    for (const fname of n.features) {
      const f = featureByName.get(fname.toLowerCase());
      if (f) {
        features.push(f);
        featureNameToNodeId.set(fname.toLowerCase(), n.id);
      }
    }
    return {
      id: n.id,
      urlPattern: n.urlPattern,
      pageTitle: n.pageTitle,
      firstSeenAt: n.firstSeenAt,
      lastSeenAt: n.lastSeenAt,
      features,
      pendingSuggestions: [],
    };
  });

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const nodeByUrlPattern = new Map(nodes.map(n => [n.urlPattern, n]));

  const unlinkedSuggestions: Suggestion[] = [];

  for (const suggestion of pendingSuggestions) {
    let attached = false;

    if (suggestion.type === 'feature') {
      const data = suggestion.data as FeatureSuggestionData;
      if (data.discovered_at_url) {
        const pattern = normalizeUrl(data.discovered_at_url);
        const node = nodeByUrlPattern.get(pattern);
        if (node) {
          node.pendingSuggestions.push(suggestion);
          attached = true;
        }
      }
    } else if (suggestion.type === 'flow' || suggestion.type === 'behavior') {
      const data = suggestion.data as FlowSuggestionData | BehaviorSuggestionData;
      const nodeId = featureNameToNodeId.get(data.feature_name.toLowerCase());
      if (nodeId) {
        const node = nodeById.get(nodeId);
        if (node) {
          node.pendingSuggestions.push(suggestion);
          attached = true;
        }
      }
    }

    if (!attached) {
      unlinkedSuggestions.push(suggestion);
    }
  }

  const edges: AppMapEdge[] = graph.edges.map(e => ({
    id: e.id,
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    actionLabel: e.actionLabel,
  }));

  return { nodes, edges, unlinkedSuggestions };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const agentId = req.params.id as string;
    const mode = (req.query.mode as string) || 'navigation';
    const result = await buildAppMapResponse(agentId);

    const explorationStatus = {
      explored: result.nodes.filter(n => n.features.length > 0).length,
      unexplored: result.nodes.filter(n => n.features.length === 0).length,
      exploring: 0,
      total: result.nodes.length,
    };

    if (mode === 'capabilities') {
      const { buildCapabilityClusters } = await import('../capability-graph.js');
      const clusters = buildCapabilityClusters(result.nodes, result.edges);
      res.json({ ...result, capabilityClusters: clusters, explorationStatus });
    } else {
      res.json({ ...result, explorationStatus });
    }
  } catch (err) {
    console.error('[MAP] Error:', err);
    res.status(500).json({ error: 'Failed to load app map' });
  }
});

export default router;
