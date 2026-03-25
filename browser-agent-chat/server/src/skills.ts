import { supabase, isSupabaseEnabled } from './supabase.js';
import type { Skill, AgentAction, UIAnchor } from './agent-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROMOTE_MIN_USE_COUNT = 3;
const PROMOTE_MIN_SUCCESS_RATE = 0.9;
const DECAY_MAX_SUCCESS_RATE = 0.7;
const INTENT_MATCH_THRESHOLD = 0.2; // minimum word-overlap score

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find the best skill matching the given intent description using word-overlap
 * similarity. Returns null if no skill exceeds the threshold.
 */
export async function findSkillForIntent(
  agentId: string,
  intentDescription: string,
): Promise<Skill | null> {
  if (!isSupabaseEnabled()) return null;

  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('agent_id', agentId)
    .eq('pattern_state', 'active')
    .eq('pattern_type', 'task');

  if (error || !data || data.length === 0) return null;

  let bestScore = 0;
  let bestRow: Record<string, unknown> | null = null;

  for (const row of data) {
    const score = wordOverlapScore(intentDescription, row.intent as string ?? '');
    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  if (bestScore < INTENT_MATCH_THRESHOLD || bestRow === null) return null;

  return rowToSkill(bestRow);
}

/**
 * Insert a new candidate pattern derived from a successful action sequence.
 */
export async function recordSkillCandidate(
  agentId: string,
  intent: string,
  steps: AgentAction[],
  anchors: UIAnchor[],
  successCriteria: string,
): Promise<void> {
  if (!isSupabaseEnabled()) return;

  const now = new Date().toISOString();

  const { error } = await supabase!
    .from('learned_patterns')
    .insert({
      agent_id: agentId,
      pattern_type: 'task',
      pattern_state: 'candidate',
      learned_from: 'auto',
      intent,
      steps: JSON.stringify(steps),
      anchors: JSON.stringify(anchors),
      preconditions: JSON.stringify([]),
      success_criteria: successCriteria,
      use_count: 1,
      success_rate: 1.0,
      created_at: now,
      updated_at: now,
    });

  if (error) {
    console.error('[SKILLS] recordSkillCandidate error:', error);
  }
}

/**
 * Promote a candidate pattern to 'active' if it meets the quality thresholds:
 *  - use_count >= 3
 *  - success_rate >= 0.9
 *
 * Returns true if the pattern was promoted.
 */
export async function promoteSkillIfReady(patternId: string): Promise<boolean> {
  if (!isSupabaseEnabled()) return false;

  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('use_count, success_rate')
    .eq('id', patternId);

  if (error || !data) return false;

  const row = data as unknown as { use_count: number; success_rate: number };
  if (row.use_count < PROMOTE_MIN_USE_COUNT || row.success_rate < PROMOTE_MIN_SUCCESS_RATE) {
    return false;
  }

  const { error: updateError } = await supabase!
    .from('learned_patterns')
    .update({ pattern_state: 'active', updated_at: new Date().toISOString() })
    .eq('id', patternId);

  if (updateError) {
    console.error('[SKILLS] promoteSkillIfReady update error:', updateError);
    return false;
  }

  return true;
}

/**
 * Mark a pattern as 'stale' if its success rate has dropped below the threshold.
 */
export async function decaySkillIfNeeded(patternId: string, successRate: number): Promise<void> {
  if (!isSupabaseEnabled()) return;
  if (successRate >= DECAY_MAX_SUCCESS_RATE) return;

  const { error } = await supabase!
    .from('learned_patterns')
    .update({ pattern_state: 'stale', updated_at: new Date().toISOString() })
    .eq('id', patternId);

  if (error) {
    console.error('[SKILLS] decaySkillIfNeeded error:', error);
  }
}

/**
 * List all active task skills for an agent.
 */
export async function listActiveSkills(agentId: string): Promise<Skill[]> {
  if (!isSupabaseEnabled()) return [];

  const { data, error } = await supabase!
    .from('learned_patterns')
    .select('*')
    .eq('agent_id', agentId)
    .eq('pattern_state', 'active')
    .eq('pattern_type', 'task');

  if (error || !data) {
    console.error('[SKILLS] listActiveSkills error:', error);
    return [];
  }

  return data.map(rowToSkill);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a word-overlap similarity score between two strings.
 * Score = |intersection| / |union| (Jaccard index on word bags).
 */
function wordOverlapScore(a: string, b: string): number {
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length >= 2),
  );
}

function rowToSkill(row: Record<string, unknown>): Skill {
  const parseJson = <T>(value: unknown, fallback: T): T => {
    if (typeof value === 'string') {
      try { return JSON.parse(value) as T; } catch { return fallback; }
    }
    if (Array.isArray(value)) return value as unknown as T;
    return fallback;
  };

  return {
    id: String(row.id),
    appId: String(row.agent_id),
    name: String(row.name ?? row.intent ?? ''),
    intent: String(row.intent ?? ''),
    steps: parseJson<string[]>(row.steps, []),
    anchors: parseJson<UIAnchor[]>(row.anchors, []),
    preconditions: parseJson<Array<{ type: 'ui_state' | 'data_state'; expression: string }>>(
      row.preconditions, []
    ),
    successCriteria: String(row.success_criteria ?? ''),
    successRate: typeof row.success_rate === 'number' ? row.success_rate : 1.0,
    executionCount: typeof row.use_count === 'number' ? row.use_count : 0,
    lastUsed: row.last_used_at != null ? String(row.last_used_at) : undefined,
    learnedFrom: (row.learned_from === 'user' ? 'user' : 'auto') as 'auto' | 'user',
  };
}
