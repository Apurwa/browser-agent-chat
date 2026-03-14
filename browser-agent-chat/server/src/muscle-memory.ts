import { supabase, isSupabaseEnabled } from './supabase.js';
import { getGraph, normalizeUrl } from './nav-graph.js';
import type { LearnedPattern, PlaywrightStep, NavNode, NavEdge, NavGraph } from './types.js';

// ─── DB Operations ────────────────────────────────────────────────

/** Load active patterns for a project. */
export async function loadPatterns(projectId: string): Promise<LearnedPattern[]> {
  if (!isSupabaseEnabled()) return [];

  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'active');

  if (error || !data) {
    console.error('[MUSCLE-MEMORY] loadPatterns error:', error);
    return [];
  }
  return data;
}

/** Mark a pattern as stale (stop attempting replay). */
export async function markStale(patternId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const { error } = await supabase!
    .from('learned_patterns')
    .update({ status: 'stale', updated_at: new Date().toISOString() })
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] markStale error:', error);
}

/** Reset failures and increment use count on successful replay. */
export async function markSuccess(patternId: string): Promise<void> {
  if (!isSupabaseEnabled()) return;

  // Reset failures and update timestamps; use_count incremented atomically via RPC
  const { error } = await supabase!
    .from('learned_patterns')
    .update({
      consecutive_failures: 0,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] markSuccess error:', error);

  // Atomically increment use_count
  await supabase!.rpc('increment_pattern_use_count', { pattern_uuid: patternId }).catch(() => {});
}

/** Increment consecutive_failures; mark stale if >= 3. */
export async function incrementFailures(patternId: string, currentFailures: number): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const newCount = currentFailures + 1;
  const updates: Record<string, unknown> = {
    consecutive_failures: newCount,
    updated_at: new Date().toISOString(),
  };
  if (newCount >= 3) {
    updates.status = 'stale';
  }

  const { error } = await supabase!
    .from('learned_patterns')
    .update(updates)
    .eq('id', patternId);

  if (error) console.error('[MUSCLE-MEMORY] incrementFailures error:', error);
}

/** Upsert a login pattern for a project (manual query since partial unique index). */
export async function upsertLoginPattern(
  projectId: string,
  loginUrl: string,
  steps: PlaywrightStep[],
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const urlPattern = normalizeUrl(loginUrl);

  // Check for existing login pattern (partial unique index can't be used with .upsert())
  const { data: existing } = await supabase!
    .from('learned_patterns')
    .select('id')
    .eq('project_id', projectId)
    .eq('pattern_type', 'login')
    .limit(1)
    .maybeSingle();

  const payload = {
    project_id: projectId,
    pattern_type: 'login' as const,
    trigger: { type: 'login', url_pattern: urlPattern },
    steps,
    consecutive_failures: 0,
    status: 'active' as const,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase!
      .from('learned_patterns')
      .update(payload)
      .eq('id', existing.id);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern update error:', error);
  } else {
    const { error } = await supabase!
      .from('learned_patterns')
      .insert(payload);
    if (error) console.error('[MUSCLE-MEMORY] upsertLoginPattern insert error:', error);
  }
}
