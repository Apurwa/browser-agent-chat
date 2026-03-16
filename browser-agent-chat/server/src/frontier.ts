import { supabase, isSupabaseEnabled } from './supabase.js';
import type { FrontierItem } from './agent-types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mapFrontierItem(row: any): FrontierItem {
  return {
    id: row.id,
    pageId: row.page_id,
    targetUrlHash: row.target_url_hash ?? undefined,
    elementLabel: row.element_label,
    action: row.action,
    priority: row.priority,
    intentRelevance: row.intent_relevance ?? undefined,
    discoveredAtStep: row.discovered_at_step,
    explored: row.explored === true,
    persistent: row.persistent === true,
    category: row.category,
  };
}

function toDbRow(agentId: string, item: Omit<FrontierItem, 'id'>): Record<string, any> {
  const row: Record<string, any> = {
    agent_id: agentId,
    page_id: item.pageId,
    element_label: item.elementLabel,
    action: item.action,
    priority: item.priority,
    discovered_at_step: item.discoveredAtStep,
    explored: item.explored,
    persistent: item.persistent,
    category: item.category,
  };
  if (item.targetUrlHash !== undefined) row.target_url_hash = item.targetUrlHash;
  if (item.intentRelevance !== undefined) row.intent_relevance = item.intentRelevance;
  return row;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add new frontier items for an agent.
 * Deduplicates by (agent_id, target_url_hash) — existing entries are kept
 * unchanged (ignoreDuplicates: true).
 */
export async function addFrontierItems(
  agentId: string,
  items: Omit<FrontierItem, 'id'>[],
): Promise<void> {
  if (!isSupabaseEnabled()) return;
  if (items.length === 0) return;

  const rows = items.map((item) => toDbRow(agentId, item));

  const { error } = await supabase!
    .from('frontier_items')
    .upsert(rows, {
      onConflict: 'agent_id,target_url_hash',
      ignoreDuplicates: true,
    });

  if (error) {
    console.error('[FRONTIER] addFrontierItems error:', error);
  }
}

/**
 * Get the highest-priority unexplored frontier item for an agent.
 * If intentId is provided, items with matching intent_relevance are naturally
 * boosted because priority was stored with the relevance score already applied.
 */
export async function getNextFrontier(
  agentId: string,
  _intentId?: string,
): Promise<FrontierItem | null> {
  if (!isSupabaseEnabled()) return null;

  const { data, error } = await supabase!
    .from('frontier_items')
    .select('*')
    .eq('agent_id', agentId)
    .eq('explored', false)
    .order('priority', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // PGRST116 = no rows returned — not a real error
    if (error.code !== 'PGRST116') {
      console.error('[FRONTIER] getNextFrontier error:', error);
    }
    return null;
  }

  return data ? mapFrontierItem(data) : null;
}

/**
 * Mark a frontier item as explored so it is not returned again by getNextFrontier.
 */
export async function markExplored(itemId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('frontier_items')
    .update({ explored: true })
    .eq('id', itemId);

  if (error) {
    console.error('[FRONTIER] markExplored error:', error);
  }
}

/**
 * Get statistics about the frontier for an agent.
 */
export async function getFrontierStats(agentId: string): Promise<{
  total: number;
  explored: number;
  remaining: number;
}> {
  if (!isSupabaseEnabled()) return { total: 0, explored: 0, remaining: 0 };

  // Total count
  const { data: totalData, error: totalErr } = await supabase!
    .from('frontier_items')
    .select('id')
    .eq('agent_id', agentId);

  const total = totalErr || !totalData ? 0 : totalData.length;

  // Explored count
  const { data: exploredData, error: exploredErr } = await supabase!
    .from('frontier_items')
    .select('id')
    .eq('agent_id', agentId)
    .eq('explored', true);

  const explored = exploredErr || !exploredData ? 0 : exploredData.length;

  return {
    total,
    explored,
    remaining: total - explored,
  };
}
