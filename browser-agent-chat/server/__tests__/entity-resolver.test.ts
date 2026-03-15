import { describe, it, expect } from 'vitest';
import { canonicalize, tokenize, jaccardSimilarity, isDuplicate } from '../src/entity-resolver.js';
import type { DuplicateMatch } from '../src/entity-resolver.js';

describe('canonicalize', () => {
  it('lowercases and trims whitespace', () => {
    expect(canonicalize('  Navigation Bar  ')).toBe('navigation bar');
  });

  it('removes UI stopwords', () => {
    expect(canonicalize('Main Navigation')).toBe('navigation');
    // 'primary' and 'header' are both stopwords → empty
    expect(canonicalize('Primary Header')).toBe('');
    expect(canonicalize('The Login Page')).toBe('login');
  });

  it('normalizes synonyms: menu/nav/navbar → navigation', () => {
    expect(canonicalize('Top Menu')).toBe('navigation');
    expect(canonicalize('nav bar')).toBe('navigation bar');
    expect(canonicalize('Navbar')).toBe('navigation');
  });

  it('normalizes synonyms: panel/pane/area → section', () => {
    expect(canonicalize('Settings Panel')).toBe('settings section');
    expect(canonicalize('Left Pane')).toBe('section');
    expect(canonicalize('Content Area')).toBe('content section');
  });

  it('normalizes synonyms: dialog/popup/overlay → modal', () => {
    expect(canonicalize('Confirmation Dialog')).toBe('confirmation modal');
    expect(canonicalize('Login Popup')).toBe('login modal');
    // 'dark' is not a stopword, so it remains alongside 'modal'
    expect(canonicalize('Dark Overlay')).toBe('dark modal');
  });

  it('normalizes synonyms: btn/cta → button', () => {
    expect(canonicalize('Submit Btn')).toBe('submit button');
    expect(canonicalize('Action CTA')).toBe('action button');
  });

  it('normalizes synonyms: input/textbox/textarea → field', () => {
    expect(canonicalize('Email Input')).toBe('email field');
    expect(canonicalize('Message Textbox')).toBe('message field');
    expect(canonicalize('Notes Textarea')).toBe('notes field');
  });

  it('normalizes synonyms: dropdown/picker → select', () => {
    expect(canonicalize('Country Dropdown')).toBe('country select');
    expect(canonicalize('Date Picker')).toBe('date select');
  });

  it('normalizes synonyms: img/pic/photo → image', () => {
    expect(canonicalize('Profile Img')).toBe('profile image');
    expect(canonicalize('Cover Pic')).toBe('cover image');
    expect(canonicalize('Avatar Photo')).toBe('avatar image');
  });

  it('splits on hyphens and underscores', () => {
    expect(canonicalize('user-profile')).toBe('user profile');
    expect(canonicalize('account_settings')).toBe('account settings');
  });

  it('collapses whitespace', () => {
    expect(canonicalize('user   profile')).toBe('user profile');
  });

  it('returns empty string for all-stopwords input', () => {
    expect(canonicalize('main primary the')).toBe('');
    expect(canonicalize('a an of for')).toBe('');
  });

  it('handles single non-stopword', () => {
    expect(canonicalize('Dashboard')).toBe('dashboard');
  });

  it('deduplicates adjacent identical tokens', () => {
    // e.g. "navigation navigation" → "navigation"
    expect(canonicalize('nav navigation')).toBe('navigation');
  });

  it('does not treat list/table/grid as synonyms', () => {
    expect(canonicalize('User List')).toBe('user list');
    expect(canonicalize('Data Table')).toBe('data table');
    expect(canonicalize('Product Grid')).toBe('product grid');
  });

  it('does not treat tab as a synonym', () => {
    expect(canonicalize('Settings Tab')).toBe('settings tab');
  });
});

describe('tokenize', () => {
  it('splits on whitespace', () => {
    const result = tokenize('hello world');
    expect(result).toEqual(new Set(['hello', 'world']));
  });

  it('splits on hyphens, underscores, and punctuation', () => {
    const result = tokenize('foo-bar_baz.qux,quux;corge:grault(garply)');
    expect(result).toEqual(new Set(['foo', 'bar', 'baz', 'qux', 'quux', 'corge', 'grault', 'garply']));
  });

  it('returns unique lowercase tokens', () => {
    const result = tokenize('Hello HELLO hello');
    expect(result).toEqual(new Set(['hello']));
  });

  it('returns empty set for empty string', () => {
    expect(tokenize('')).toEqual(new Set());
  });

  it('filters out empty tokens from consecutive delimiters', () => {
    const result = tokenize('foo--bar');
    expect(result).toEqual(new Set(['foo', 'bar']));
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(jaccardSimilarity('account settings', 'account settings')).toBe(1.0);
  });

  it('returns 0 for completely disjoint strings', () => {
    expect(jaccardSimilarity('login form', 'dashboard graph')).toBe(0);
  });

  it('returns partial overlap correctly', () => {
    // "account settings" vs "account settings panel"
    // tokens: {account, settings} vs {account, settings, panel}
    // intersection = 2, union = 3 → 2/3 ≈ 0.667
    const sim = jaccardSimilarity('account settings', 'account settings panel');
    expect(sim).toBeCloseTo(2 / 3, 5);
  });

  it('returns 0.5 for 1-of-2 overlap', () => {
    // "user profile" vs "user dashboard"
    // intersection = {user}, union = {user, profile, dashboard} → 1/3
    const sim = jaccardSimilarity('user profile', 'user dashboard');
    expect(sim).toBeCloseTo(1 / 3, 5);
  });

  it('returns 0 when both strings are empty', () => {
    expect(jaccardSimilarity('', '')).toBe(0);
  });

  it('returns 0 when one string is empty', () => {
    expect(jaccardSimilarity('hello', '')).toBe(0);
    expect(jaccardSimilarity('', 'world')).toBe(0);
  });
});

describe('isDuplicate', () => {
  it('returns canonical match for semantically same names', () => {
    // "Main Navigation" → canonicalize → "navigation"
    // "Navigation Menu" → canonicalize → "navigation"
    const result = isDuplicate('Main Navigation', ['Navigation Menu', 'User Profile']);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('canonical');
    expect(result!.matchedName).toBe('Navigation Menu');
    expect(result!.similarity).toBe(1.0);
  });

  it('returns fuzzy match for similar but not canonically identical names', () => {
    // "Account Settings" vs "Account Settings Panel"
    // canonical: "account settings" vs "account settings section" — not identical
    // fuzzy jaccard on canonical forms should be ≥ 0.6
    const result = isDuplicate('Account Settings', ['Account Settings Panel', 'Login Form']);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('fuzzy');
    expect(result!.matchedName).toBe('Account Settings Panel');
    expect(result!.similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('returns null for clearly different names', () => {
    const result = isDuplicate('Login Form', ['Dashboard Overview', 'User Profile']);
    expect(result).toBeNull();
  });

  it('returns null for empty existing names list', () => {
    const result = isDuplicate('Navigation', []);
    expect(result).toBeNull();
  });

  it('prefers canonical match over fuzzy when both apply', () => {
    // "Main Nav" → canonical → "navigation"
    // "Navigation" → canonical → "navigation" (exact canonical match)
    // "Navigation Bar" → canonical → "navigation bar" (fuzzy match)
    const result = isDuplicate('Main Nav', ['Navigation Bar', 'Navigation']);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('canonical');
    expect(result!.matchedName).toBe('Navigation');
  });

  it('respects custom threshold', () => {
    // With threshold=0.9, "Account Settings" vs "Account Settings Panel" should not match
    const result = isDuplicate('Account Settings', ['Account Settings Panel'], 0.9);
    expect(result).toBeNull();
  });

  it('returns the matched name from existingNames (not canonical form)', () => {
    const result = isDuplicate('Main Navigation', ['Navigation Menu']);
    expect(result!.matchedName).toBe('Navigation Menu');
  });

  it('returns null when canonical form is empty', () => {
    // All stopwords → canonical is empty → should not match anything
    const result = isDuplicate('main the a', ['primary the an']);
    expect(result).toBeNull();
  });
});

describe('real-world dedup scenarios', () => {
  const existingFeatures = [
    'Main Navigation',
    'User Profile',
    'Dashboard Analytics',
    'Account Settings',
    'Login Form',
  ];

  it('catches LLM naming variations (canonical match)', () => {
    expect(isDuplicate('Navigation Menu', existingFeatures)).not.toBeNull();
    expect(isDuplicate('Top Navigation', existingFeatures)).not.toBeNull();
    expect(isDuplicate('Login Authentication Form', existingFeatures)).not.toBeNull();
  });

  it('catches fuzzy matches above threshold', () => {
    expect(isDuplicate('Account Settings Panel', existingFeatures)).not.toBeNull();
  });

  it('allows genuinely different features', () => {
    expect(isDuplicate('Shopping Cart', existingFeatures)).toBeNull();
    expect(isDuplicate('Payment Processing', existingFeatures)).toBeNull();
    expect(isDuplicate('File Upload', existingFeatures)).toBeNull();
  });

  it('does not false-positive on partial word overlap', () => {
    expect(isDuplicate('User Billing', existingFeatures)).toBeNull();
  });

  it('handles edge cases', () => {
    expect(isDuplicate('', existingFeatures)).toBeNull();
    expect(isDuplicate('  ', existingFeatures)).toBeNull();
  });

  it('does not match when both inputs canonicalize to empty', () => {
    expect(isDuplicate('Main Top', ['Primary Header'])).toBeNull();
  });
});
