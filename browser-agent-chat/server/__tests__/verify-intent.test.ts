import { describe, it, expect } from 'vitest';
import { verifyIntent } from '../src/verify-intent.js';
import type { Intent } from '../src/agent-types.js';

const baseIntent: Intent = {
  id: 'intent-1',
  description: 'Log in to the dashboard',
  successCriteria: 'dashboard visible',
  status: 'active',
  confidence: 0.8,
};

// ---------------------------------------------------------------------------
// Overlap-based matching (new fuzzy logic)
// ---------------------------------------------------------------------------

describe('verifyIntent — overlap matching', () => {
  it('passes when page title contains criteria keyword', async () => {
    const result = await verifyIntent(baseIntent, 'https://ex.com/home', 'My Dashboard - App');
    expect(result.passed).toBe(true);
    expect(result.intentId).toBe('intent-1');
  });

  it('passes when URL contains criteria keyword', async () => {
    const result = await verifyIntent(baseIntent, 'https://ex.com/dashboard/overview', 'Home Page');
    expect(result.passed).toBe(true);
  });

  it('matches case-insensitively', async () => {
    const result = await verifyIntent(baseIntent, 'https://ex.com/home', 'DASHBOARD Overview');
    expect(result.passed).toBe(true);
  });

  it('returns confidence >= 0.5 on pass', async () => {
    const result = await verifyIntent(baseIntent, 'https://ex.com/home', 'Dashboard Main');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// New: explore Tools section scenario
// ---------------------------------------------------------------------------

describe('verifyIntent — explore Tools section', () => {
  it('passes when intent is "explore Tools section" and page title is "Tools"', async () => {
    const intent: Intent = {
      id: 'intent-tools',
      description: 'Explore the Tools section',
      successCriteria: 'explore Tools section',
      status: 'active',
      confidence: 0.5,
    };
    const result = await verifyIntent(intent, 'https://app.com/tools', 'Tools');
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// New: URL path segment matching
// ---------------------------------------------------------------------------

describe('verifyIntent — URL path segment matching', () => {
  it('passes when intent about "agents" matches URL "/ai-studio/agents"', async () => {
    const intent: Intent = {
      id: 'intent-agents',
      description: 'View the agents list',
      successCriteria: 'agents list visible',
      status: 'active',
      confidence: 0.5,
    };
    const result = await verifyIntent(intent, 'https://app.com/ai-studio/agents', 'AI Studio');
    expect(result.passed).toBe(true);
  });

  it('passes when URL path contains matching segment even if title does not', async () => {
    const intent: Intent = {
      id: 'intent-reports',
      description: 'Navigate to reports',
      successCriteria: 'reports page',
      status: 'active',
      confidence: 0.5,
    };
    const result = await verifyIntent(intent, 'https://app.com/analytics/reports', 'Analytics');
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No match — completely unrelated
// ---------------------------------------------------------------------------

describe('verifyIntent — no match', () => {
  it('returns passed=false when no keyword matches', async () => {
    const intent: Intent = {
      id: 'intent-checkout',
      description: 'Complete checkout',
      successCriteria: 'checkout payment confirmation',
      status: 'active',
      confidence: 0.8,
    };
    const result = await verifyIntent(
      intent,
      'https://app.com/profile/settings',
      'User Profile Settings',
    );
    expect(result.passed).toBe(false);
  });

  it('handles multi-word success criteria with majority matching', async () => {
    const intent: Intent = {
      id: 'intent-2',
      description: 'Submit the contact form',
      successCriteria: 'thank you confirmation sent',
      status: 'active',
      confidence: 0.9,
    };
    const result = await verifyIntent(intent, 'https://ex.com/thank-you', 'Thank You for Contacting Us');
    expect(result.passed).toBe(true);
  });

  it('returns low confidence on no match', async () => {
    const intent: Intent = {
      id: 'intent-xyz',
      description: 'Find the billing page',
      successCriteria: 'billing invoice payment',
      status: 'active',
      confidence: 0.8,
    };
    const result = await verifyIntent(
      intent,
      'https://ex.com/profile',
      'User Profile',
    );
    expect(result.passed).toBe(false);
    expect(result.confidence).toBeLessThan(0.4);
  });
});
