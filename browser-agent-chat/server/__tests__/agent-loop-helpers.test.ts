import { describe, it, expect } from 'vitest';
import { getCurrentIntent, advanceIntent, checkHeuristicOverride } from '../src/agent-loop.js';
import type { Intent, TaskMemory, Perception, AgentAction } from '../src/agent-types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIntent(
  id: string,
  status: Intent['status'],
  confidence: number = 0.8,
): Intent {
  return {
    id,
    description: `Intent ${id}`,
    successCriteria: `${id} done`,
    status,
    confidence,
  };
}

function makeAction(type: AgentAction['type'], elementId = 'btn-1'): AgentAction {
  return {
    type,
    elementId,
    expectedOutcome: 'some outcome',
    intentId: 'intent-1',
  };
}

const emptyTaskMemory: TaskMemory = {
  taskId: 'task-1',
  goal: 'explore the app',
  intents: [],
  visitedPages: ['https://app.com'],
  actionsAttempted: [],
  failedActions: [],
  replanCount: 0,
  progressScore: 0,
  stuckSignals: {
    repeatedActionCount: 0,
    samePageCount: 0,
    failedExecutionCount: 0,
    stepsSinceProgress: 0,
  },
};

function makeTaskMemory(overrides: Partial<TaskMemory> = {}): TaskMemory {
  return { ...emptyTaskMemory, ...overrides };
}

const emptyPerception: Perception = {
  uiElements: [],
  url: 'https://app.com',
  pageTitle: 'App',
  activeIntent: null,
  relevantMemory: '',
};

// ---------------------------------------------------------------------------
// getCurrentIntent
// ---------------------------------------------------------------------------

describe('getCurrentIntent', () => {
  it('returns the first active intent', () => {
    const intents = [
      makeIntent('i-1', 'pending'),
      makeIntent('i-2', 'active'),
      makeIntent('i-3', 'pending'),
    ];
    const result = getCurrentIntent(intents);
    expect(result?.id).toBe('i-2');
  });

  it('falls back to first pending when no active intent', () => {
    const intents = [
      makeIntent('i-1', 'completed'),
      makeIntent('i-2', 'pending'),
      makeIntent('i-3', 'pending'),
    ];
    const result = getCurrentIntent(intents);
    expect(result?.id).toBe('i-2');
  });

  it('returns null when all intents are completed', () => {
    const intents = [
      makeIntent('i-1', 'completed'),
      makeIntent('i-2', 'completed'),
    ];
    const result = getCurrentIntent(intents);
    expect(result).toBeNull();
  });

  it('returns null for empty intents array', () => {
    const result = getCurrentIntent([]);
    expect(result).toBeNull();
  });

  it('returns the active intent even if earlier pending intents exist', () => {
    const intents = [
      makeIntent('i-1', 'pending'),
      makeIntent('i-2', 'pending'),
      makeIntent('i-3', 'active'),
    ];
    const result = getCurrentIntent(intents);
    expect(result?.id).toBe('i-3');
  });

  it('returns null when all intents are failed', () => {
    const intents = [
      makeIntent('i-1', 'failed'),
      makeIntent('i-2', 'failed'),
    ];
    const result = getCurrentIntent(intents);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// advanceIntent
// ---------------------------------------------------------------------------

describe('advanceIntent', () => {
  it('marks the active intent as completed and activates the next pending', () => {
    const intents = [
      makeIntent('i-1', 'active', 0.5),
      makeIntent('i-2', 'pending'),
    ];
    const result = advanceIntent(intents);
    expect(result[0].status).toBe('completed');
    expect(result[1].status).toBe('active');
  });

  it('returns a new array (does not mutate the input)', () => {
    const intents = [
      makeIntent('i-1', 'active'),
      makeIntent('i-2', 'pending'),
    ];
    const result = advanceIntent(intents);
    expect(result).not.toBe(intents);
    expect(intents[0].status).toBe('active'); // original unchanged
    expect(result[0].status).toBe('completed');
  });

  it('bumps confidence to at least 0.7 when completing an intent with low confidence', () => {
    const intents = [makeIntent('i-1', 'active', 0.3)];
    const result = advanceIntent(intents);
    expect(result[0].status).toBe('completed');
    expect(result[0].confidence).toBe(0.7);
  });

  it('preserves original confidence when it is already above 0.7', () => {
    const intents = [makeIntent('i-1', 'active', 0.9)];
    const result = advanceIntent(intents);
    expect(result[0].confidence).toBe(0.9);
  });

  it('handles a single intent: marks it completed, no next pending', () => {
    const intents = [makeIntent('i-1', 'active')];
    const result = advanceIntent(intents);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('completed');
  });

  it('returns a copy with no changes when there is no active intent', () => {
    const intents = [
      makeIntent('i-1', 'pending'),
      makeIntent('i-2', 'pending'),
    ];
    const result = advanceIntent(intents);
    expect(result[0].status).toBe('pending');
    expect(result[1].status).toBe('pending');
    expect(result).not.toBe(intents); // still a new array
  });

  it('activates only the FIRST pending intent when multiple pending exist', () => {
    const intents = [
      makeIntent('i-1', 'active'),
      makeIntent('i-2', 'pending'),
      makeIntent('i-3', 'pending'),
    ];
    const result = advanceIntent(intents);
    expect(result[0].status).toBe('completed');
    expect(result[1].status).toBe('active');
    expect(result[2].status).toBe('pending');
  });

  it('skips already-completed intents when looking for next pending', () => {
    const intents = [
      makeIntent('i-1', 'active'),
      makeIntent('i-2', 'completed'),
      makeIntent('i-3', 'pending'),
    ];
    const result = advanceIntent(intents);
    expect(result[0].status).toBe('completed');
    expect(result[1].status).toBe('completed');
    expect(result[2].status).toBe('active');
  });

  it('handles all-already-completed array: returns unchanged copy', () => {
    const intents = [
      makeIntent('i-1', 'completed'),
      makeIntent('i-2', 'completed'),
    ];
    const result = advanceIntent(intents);
    expect(result[0].status).toBe('completed');
    expect(result[1].status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// checkHeuristicOverride
// ---------------------------------------------------------------------------

describe('checkHeuristicOverride', () => {
  const navElement = {
    id: 'nav-link-1',
    role: 'a',
    label: 'Dashboard',
    interactable: true,
  };

  const perceptionWithNav: Perception = {
    ...emptyPerception,
    uiElements: [navElement],
  };

  it('returns null when fewer than 3 actions attempted', () => {
    const memory = makeTaskMemory({
      actionsAttempted: [makeAction('click'), makeAction('click')],
      stuckSignals: { repeatedActionCount: 2, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 5 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result).toBeNull();
  });

  it('returns null when last 3 actions are NOT all the same type', () => {
    const memory = makeTaskMemory({
      actionsAttempted: [makeAction('click'), makeAction('type'), makeAction('click')],
      stuckSignals: { repeatedActionCount: 1, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 5 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result).toBeNull();
  });

  it('returns null when stepsSinceProgress < 3 even with 3 same-type actions', () => {
    const memory = makeTaskMemory({
      actionsAttempted: [makeAction('click'), makeAction('click'), makeAction('click')],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 2 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result).toBeNull();
  });

  it('returns null when thresholds met but no unexplored navigation elements', () => {
    const memory = makeTaskMemory({
      actionsAttempted: [makeAction('click'), makeAction('click'), makeAction('click')],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 3 },
    });
    const perceptionNoNav: Perception = { ...emptyPerception, uiElements: [] };
    const result = checkHeuristicOverride(memory, perceptionNoNav, new Set());
    expect(result).toBeNull();
  });

  it('returns null when the only nav element is already in clickedElementIds', () => {
    const memory = makeTaskMemory({
      actionsAttempted: [makeAction('click'), makeAction('click'), makeAction('click')],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 3 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set(['nav-link-1']));
    expect(result).toBeNull();
  });

  it('fires when 3 same-type actions + stepsSinceProgress >= 3 + nav available', () => {
    const memory = makeTaskMemory({
      actionsAttempted: [makeAction('click'), makeAction('click'), makeAction('click')],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 3 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result).not.toBeNull();
    expect(result?.action.type).toBe('click');
    expect(result?.action.elementId).toBe('nav-link-1');
  });

  it('returned action uses active intent id when available', () => {
    const memory = makeTaskMemory({
      intents: [makeIntent('active-intent', 'active')],
      actionsAttempted: [makeAction('type'), makeAction('type'), makeAction('type')],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 3 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result?.action.intentId).toBe('active-intent');
  });

  it('falls back to "unknown" intentId when no active or pending intent', () => {
    const memory = makeTaskMemory({
      intents: [makeIntent('done-intent', 'completed')],
      actionsAttempted: [makeAction('extract'), makeAction('extract'), makeAction('extract')],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 4 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result?.action.intentId).toBe('unknown');
  });

  it('only examines the LAST 3 actions (not the full history)', () => {
    // First 4 are 'extract', last 3 are 'click' — should fire for 'click' pattern
    const memory = makeTaskMemory({
      actionsAttempted: [
        makeAction('extract'), makeAction('extract'), makeAction('extract'), makeAction('extract'),
        makeAction('click'), makeAction('click'), makeAction('click'),
      ],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 3 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result).not.toBeNull();
  });

  it('fires on type "extract" repeated 3 times with progress stalled', () => {
    const memory = makeTaskMemory({
      actionsAttempted: [makeAction('extract'), makeAction('extract'), makeAction('extract')],
      stuckSignals: { repeatedActionCount: 3, samePageCount: 0, failedExecutionCount: 0, stepsSinceProgress: 5 },
    });
    const result = checkHeuristicOverride(memory, perceptionWithNav, new Set());
    expect(result).not.toBeNull();
    expect(result?.action.type).toBe('click');
  });
});
