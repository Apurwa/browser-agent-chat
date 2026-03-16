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
// Keyword match in page title
// ---------------------------------------------------------------------------

describe('verifyIntent — page title matching', () => {
  it('returns passed=true with confidence 0.7 when page title contains keyword', async () => {
    const result = await verifyIntent(baseIntent, 'https://ex.com/dashboard', 'My Dashboard - App');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.7);
    expect(result.intentId).toBe('intent-1');
  });

  it('matches case-insensitively against page title', async () => {
    const result = await verifyIntent(baseIntent, 'https://ex.com/home', 'DASHBOARD Overview');
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Keyword match in URL
// ---------------------------------------------------------------------------

describe('verifyIntent — URL matching', () => {
  it('returns passed=true with confidence 0.6 when URL contains keyword', async () => {
    const result = await verifyIntent(baseIntent, 'https://ex.com/dashboard/overview', 'Home Page');
    expect(result.passed).toBe(true);
    expect(result.confidence).toBe(0.6);
  });

  it('prefers page title match (higher confidence) over URL match', async () => {
    // Title matches "dashboard" AND URL matches "dashboard"
    const result = await verifyIntent(baseIntent, 'https://ex.com/dashboard', 'Dashboard Main');
    expect(result.confidence).toBe(0.7); // title match takes precedence
  });
});

// ---------------------------------------------------------------------------
// No match
// ---------------------------------------------------------------------------

describe('verifyIntent — no match', () => {
  it('returns passed=false with confidence 0.3 when no keyword matches', async () => {
    const result = await verifyIntent(
      baseIntent,
      'https://ex.com/profile',
      'User Profile Settings',
    );
    expect(result.passed).toBe(false);
    expect(result.confidence).toBe(0.3);
  });

  it('handles multi-word success criteria', async () => {
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
});
