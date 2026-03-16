import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('../src/supabase.js', () => ({
  isSupabaseEnabled: vi.fn().mockReturnValue(true),
  supabase: { from: mockFrom },
}));

import {
  findSkillForIntent,
  recordSkillCandidate,
  promoteSkillIfReady,
  decaySkillIfNeeded,
  listActiveSkills,
} from '../src/skills.js';
import type { AgentAction, UIAnchor } from '../src/agent-types.js';

// Helper to build a chainable mock query result
function makeQuery(result: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockResolvedValue({ error: null });
  chain.then = undefined; // not a thenable itself
  // Allow awaiting the final call in the chain
  chain.eq = vi.fn().mockImplementation(() => {
    const inner: Record<string, unknown> = {};
    inner.eq = vi.fn().mockResolvedValue(result);
    inner.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    return inner;
  });
  return chain;
}

// ---------------------------------------------------------------------------
// findSkillForIntent
// ---------------------------------------------------------------------------

describe('findSkillForIntent', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns null when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const result = await findSkillForIntent('agent-1', 'login to the app');
    expect(result).toBeNull();
  });

  it('returns null when no active skills exist', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    });

    const result = await findSkillForIntent('agent-1', 'login to the app');
    expect(result).toBeNull();
  });

  it('returns the best matching skill above the threshold', async () => {
    const rows = [
      {
        id: 'skill-1',
        agent_id: 'agent-1',
        name: 'Login Skill',
        intent: 'login to the application',
        steps: JSON.stringify(['click login button', 'enter credentials']),
        anchors: JSON.stringify([]),
        preconditions: JSON.stringify([]),
        success_criteria: 'User is logged in',
        success_rate: 0.95,
        use_count: 10,
        last_used_at: null,
        learned_from: 'auto',
        pattern_state: 'active',
        pattern_type: 'task',
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    });

    const result = await findSkillForIntent('agent-1', 'login to the application now');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('skill-1');
  });

  it('returns null when best match is below the similarity threshold', async () => {
    const rows = [
      {
        id: 'skill-2',
        agent_id: 'agent-1',
        name: 'Checkout Skill',
        intent: 'complete the checkout process',
        steps: JSON.stringify(['add to cart', 'checkout']),
        anchors: JSON.stringify([]),
        preconditions: JSON.stringify([]),
        success_criteria: 'Order placed',
        success_rate: 0.9,
        use_count: 5,
        last_used_at: null,
        learned_from: 'auto',
        pattern_state: 'active',
        pattern_type: 'task',
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    });

    // completely unrelated intent
    const result = await findSkillForIntent('agent-1', 'upload a profile photo');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recordSkillCandidate
// ---------------------------------------------------------------------------

describe('recordSkillCandidate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('does nothing when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    await recordSkillCandidate('agent-1', 'login', [], [], 'logged in');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('inserts a candidate pattern with correct fields', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    const actions: AgentAction[] = [
      { type: 'click', elementId: 'btn-login', expectedOutcome: 'form shown', intentId: 'i-1' },
    ];
    const anchors: UIAnchor[] = [
      { type: 'label', value: 'Login Button', pageUrl: 'https://example.com/login' },
    ];

    await recordSkillCandidate('agent-1', 'login to app', actions, anchors, 'user is logged in');

    expect(mockFrom).toHaveBeenCalledWith('learned_patterns');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'agent-1',
        pattern_type: 'task',
        pattern_state: 'candidate',
        learned_from: 'auto',
        intent: 'login to app',
        success_criteria: 'user is logged in',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// promoteSkillIfReady
// ---------------------------------------------------------------------------

describe('promoteSkillIfReady', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('promotes when use_count >= 3 and success_rate >= 0.9', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEq });
    const selectResult = { data: { use_count: 3, success_rate: 0.92 }, error: null };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(selectResult),
      }),
      update: updateMock,
    });

    const promoted = await promoteSkillIfReady('pattern-1');
    expect(promoted).toBe(true);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ pattern_state: 'active' })
    );
  });

  it('does not promote when use_count < 3', async () => {
    const updateMock = vi.fn();
    const selectResult = { data: { use_count: 2, success_rate: 0.95 }, error: null };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(selectResult),
      }),
      update: updateMock,
    });

    const promoted = await promoteSkillIfReady('pattern-1');
    expect(promoted).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not promote when success_rate < 0.9', async () => {
    const updateMock = vi.fn();
    const selectResult = { data: { use_count: 5, success_rate: 0.85 }, error: null };

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(selectResult),
      }),
      update: updateMock,
    });

    const promoted = await promoteSkillIfReady('pattern-1');
    expect(promoted).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// decaySkillIfNeeded
// ---------------------------------------------------------------------------

describe('decaySkillIfNeeded', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets stale when successRate < 0.7', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEq });

    mockFrom.mockReturnValue({ update: updateMock });

    await decaySkillIfNeeded('pattern-1', 0.65);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ pattern_state: 'stale' })
    );
  });

  it('does not decay when successRate >= 0.7', async () => {
    const updateMock = vi.fn();
    mockFrom.mockReturnValue({ update: updateMock });

    await decaySkillIfNeeded('pattern-1', 0.75);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listActiveSkills
// ---------------------------------------------------------------------------

describe('listActiveSkills', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns empty array when supabase is disabled', async () => {
    const { isSupabaseEnabled } = await import('../src/supabase.js');
    (isSupabaseEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const result = await listActiveSkills('agent-1');
    expect(result).toEqual([]);
  });

  it('maps database rows to Skill type', async () => {
    const rows = [
      {
        id: 'skill-1',
        agent_id: 'agent-1',
        name: 'Login Skill',
        intent: 'login to the application',
        steps: JSON.stringify(['click login', 'fill password']),
        anchors: JSON.stringify([{ type: 'label', value: 'Login', pageUrl: 'https://ex.com' }]),
        preconditions: JSON.stringify([]),
        success_criteria: 'User is logged in',
        success_rate: 0.95,
        use_count: 10,
        last_used_at: '2026-01-01T00:00:00.000Z',
        learned_from: 'auto',
        pattern_state: 'active',
        pattern_type: 'task',
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    });

    const result = await listActiveSkills('agent-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('skill-1');
    expect(result[0].intent).toBe('login to the application');
    expect(result[0].successCriteria).toBe('User is logged in');
  });
});
