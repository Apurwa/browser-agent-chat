# Entity Deduplication for Suggestions — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate feature/flow/behavior suggestions by adding a cascading entity resolution pipeline: canonicalize → exact match → fuzzy Jaccard → (future: embedding similarity).

**Architecture:** New `entity-resolver.ts` module with pure functions for canonicalization and fuzzy matching. Integrated into `createSuggestion()` in `db.ts` to replace the current exact-match-only dedup. Aliases stored in the suggestion/feature `data` JSONB (no schema migration needed). Also check dismissed suggestions to prevent re-creation.

**Tech Stack:** TypeScript, Vitest (unit tests), Supabase JSONB

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `server/src/entity-resolver.ts` | Create | Canonicalize, tokenize, Jaccard similarity, `isDuplicate()` |
| `server/__tests__/entity-resolver.test.ts` | Create | Unit tests for all resolver functions |
| `server/src/db.ts` | Modify (lines 349-434) | Replace exact-match dedup with `findDuplicate()` cascade, alias storage |
| `server/src/types.ts` | Modify (lines 311-331) | Add `aliases?: string[]` to suggestion data interfaces |

No database migration needed — aliases stored in existing `data JSONB` column.

---

## Chunk 1: Entity Resolver Module

### Task 1: Canonicalize function

**Files:**
- Create: `server/src/entity-resolver.ts`
- Create: `server/__tests__/entity-resolver.test.ts`

- [ ] **Step 1: Write failing tests for `canonicalize()`**

```typescript
// server/__tests__/entity-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { canonicalize } from '../src/entity-resolver.js';

describe('canonicalize', () => {
  it('lowercases and trims', () => {
    expect(canonicalize('  Main Navigation  ')).toBe('navigation');
  });

  it('removes UI stopwords', () => {
    expect(canonicalize('Main Navigation Menu')).toBe('navigation');
    expect(canonicalize('Top Header Links')).toBe('links');
    expect(canonicalize('Primary Action Button')).toBe('action button');
  });

  it('normalizes synonyms', () => {
    expect(canonicalize('User Menu')).toBe('user navigation');
    expect(canonicalize('Settings Panel')).toBe('settings section');
    expect(canonicalize('Login Form')).toBe('login form');
  });

  it('collapses whitespace', () => {
    expect(canonicalize('  navigation   menu  ')).toBe('navigation');
  });

  it('returns empty string for all-stopwords input', () => {
    expect(canonicalize('Main Top')).toBe('');
  });

  it('handles single-word names', () => {
    expect(canonicalize('Dashboard')).toBe('dashboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/entity-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `canonicalize()`**

```typescript
// server/src/entity-resolver.ts

/**
 * UI-domain stopwords that add no semantic value for dedup purposes.
 * These are common prefixes/modifiers LLMs add inconsistently.
 */
const STOPWORDS = new Set([
  'main', 'primary', 'secondary', 'top', 'bottom', 'left', 'right',
  'header', 'footer', 'sidebar', 'the', 'a', 'an', 'of', 'for', 'in',
  'with', 'and', 'or', 'to', 'is', 'are', 'this', 'that', 'its',
  'key', 'core', 'basic', 'advanced', 'simple', 'full', 'complete',
  'current', 'new', 'existing', 'general', 'overall', 'detailed',
  'page', 'view', 'screen',
]);

/**
 * Synonym map: LLMs use these interchangeably.
 * Maps variant → canonical form.
 * Conservative: only merge truly interchangeable terms.
 * NOTE: list/table/grid are intentionally NOT synonyms — they are
 * structurally different UI components with different testing needs.
 */
const SYNONYMS: Record<string, string> = {
  'menu': 'navigation',
  'nav': 'navigation',
  'navbar': 'navigation',
  'panel': 'section',
  'pane': 'section',
  'area': 'section',
  'dialog': 'modal',
  'popup': 'modal',
  'overlay': 'modal',
  'btn': 'button',
  'cta': 'button',
  'input': 'field',
  'textbox': 'field',
  'textarea': 'field',
  'dropdown': 'select',
  'picker': 'select',
  'img': 'image',
  'pic': 'image',
  'photo': 'image',
};

/**
 * Canonicalize a feature/flow name for dedup comparison.
 * Split on whitespace/hyphens/underscores → lowercase → remove stopwords →
 * normalize synonyms → deduplicate adjacent tokens → collapse whitespace.
 */
export function canonicalize(name: string): string {
  const tokens = name.toLowerCase().trim().split(/[\s\-_]+/);
  const result = tokens
    .filter(t => t.length > 0 && !STOPWORDS.has(t))
    .map(t => SYNONYMS[t] ?? t);
  // Deduplicate adjacent identical tokens (e.g., "navigation navigation")
  const deduped = result.filter((t, i) => i === 0 || t !== result[i - 1]);
  return deduped.join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run __tests__/entity-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/entity-resolver.ts server/__tests__/entity-resolver.test.ts
git commit -m "feat(dedup): add canonicalize function for entity name normalization"
```

---

### Task 2: Tokenize and Jaccard similarity

**Files:**
- Modify: `server/src/entity-resolver.ts`
- Modify: `server/src/entity-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Append to server/__tests__/entity-resolver.test.ts
import { tokenize, jaccardSimilarity } from '../src/entity-resolver.js';

describe('tokenize', () => {
  it('splits on whitespace and punctuation', () => {
    expect(tokenize('user-profile settings')).toEqual(new Set(['user', 'profile', 'settings']));
  });

  it('returns empty set for empty string', () => {
    expect(tokenize('')).toEqual(new Set());
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    expect(jaccardSimilarity('navigation', 'navigation')).toBe(1.0);
  });

  it('returns 0 for completely different sets', () => {
    expect(jaccardSimilarity('login form', 'dashboard chart')).toBe(0);
  });

  it('returns correct similarity for overlapping sets', () => {
    // {navigation, menu} vs {navigation} → intersection=1, union=2 → 0.5
    expect(jaccardSimilarity('navigation menu', 'navigation')).toBeCloseTo(0.5);
  });

  it('catches similar feature names', () => {
    // "main navigation menu" → canonical "navigation"
    // "navigation menu" → canonical "navigation"
    // After canonicalization both become "navigation" → Jaccard = 1.0
    // But jaccardSimilarity works on raw canonical strings
    expect(jaccardSimilarity('navigation', 'navigation')).toBe(1.0);
  });

  it('returns 0.67 for 2/3 overlap', () => {
    // {a, b, c} vs {a, b} → 2/3
    expect(jaccardSimilarity('a b c', 'a b')).toBeCloseTo(0.667, 2);
  });

  it('handles empty inputs', () => {
    expect(jaccardSimilarity('', 'something')).toBe(0);
    expect(jaccardSimilarity('', '')).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/entity-resolver.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement `tokenize()` and `jaccardSimilarity()`**

```typescript
// Append to server/src/entity-resolver.ts

/**
 * Split a string into a set of unique lowercase tokens.
 * Splits on whitespace, hyphens, underscores, and other non-alpha.
 */
export function tokenize(text: string): Set<string> {
  if (!text.trim()) return new Set();
  return new Set(text.toLowerCase().split(/[\s\-_/.,;:()]+/).filter(Boolean));
}

/**
 * Jaccard similarity between two token sets.
 * Returns 0.0–1.0 (1.0 = identical).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run __tests__/entity-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/entity-resolver.ts server/__tests__/entity-resolver.test.ts
git commit -m "feat(dedup): add tokenize and Jaccard similarity functions"
```

---

### Task 3: isDuplicate — the cascade function

**Files:**
- Modify: `server/src/entity-resolver.ts`
- Modify: `server/src/entity-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Append to server/__tests__/entity-resolver.test.ts
import { isDuplicate } from '../src/entity-resolver.js';

describe('isDuplicate', () => {
  const THRESHOLD = 0.6;

  it('matches exact canonical names', () => {
    const result = isDuplicate('Main Navigation', ['Navigation Menu'], THRESHOLD);
    // Both canonicalize to "navigation"
    expect(result).not.toBeNull();
    expect(result!.matchedName).toBe('Navigation Menu');
    expect(result!.method).toBe('canonical');
  });

  it('matches fuzzy similar names above threshold', () => {
    const result = isDuplicate('User Profile Settings', ['Profile Settings Page'], THRESHOLD);
    // canonical: "user profile settings" vs "profile settings page"
    // tokens overlap: {profile, settings} / {user, profile, settings, page} = 2/4 = 0.5
    // Hmm, that's below 0.6. Let's use a better example.
    const result2 = isDuplicate('Account Settings', ['Account Settings Panel'], THRESHOLD);
    // canonical: "account settings" vs "account settings section"
    // tokens: {account, settings} vs {account, settings, section} = 2/3 = 0.67
    expect(result2).not.toBeNull();
    expect(result2!.method).toBe('fuzzy');
  });

  it('rejects clearly different names', () => {
    const result = isDuplicate('Login Form', ['Dashboard Analytics', 'User Profile'], THRESHOLD);
    expect(result).toBeNull();
  });

  it('handles empty existing list', () => {
    const result = isDuplicate('Anything', [], THRESHOLD);
    expect(result).toBeNull();
  });

  it('prefers canonical match over fuzzy', () => {
    const result = isDuplicate('Navigation Menu', ['Navigation Menu', 'Nav Panel'], THRESHOLD);
    // Both would match, but canonical should win
    expect(result).not.toBeNull();
    expect(result!.method).toBe('canonical');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run __tests__/entity-resolver.test.ts`
Expected: FAIL — isDuplicate not found

- [ ] **Step 3: Implement `isDuplicate()`**

```typescript
// Append to server/src/entity-resolver.ts

export interface DuplicateMatch {
  matchedName: string;
  method: 'canonical' | 'fuzzy';
  similarity: number;
}

/**
 * Check if a name is a duplicate of any name in the existing list.
 * Cascade: canonical exact match → fuzzy Jaccard above threshold.
 * Returns the match info or null if no duplicate found.
 */
export function isDuplicate(
  name: string,
  existingNames: string[],
  threshold: number = 0.6
): DuplicateMatch | null {
  if (existingNames.length === 0) return null;

  const canonical = canonicalize(name);

  // Stage 1: Canonical exact match
  for (const existing of existingNames) {
    const existingCanonical = canonicalize(existing);
    if (canonical && existingCanonical && canonical === existingCanonical) {
      return { matchedName: existing, method: 'canonical', similarity: 1.0 };
    }
  }

  // Stage 2: Fuzzy Jaccard on canonical forms
  if (!canonical) return null;

  let bestMatch: DuplicateMatch | null = null;
  for (const existing of existingNames) {
    const existingCanonical = canonicalize(existing);
    if (!existingCanonical) continue;

    const sim = jaccardSimilarity(canonical, existingCanonical);
    if (sim >= threshold && (!bestMatch || sim > bestMatch.similarity)) {
      bestMatch = { matchedName: existing, method: 'fuzzy', similarity: sim };
    }
  }

  return bestMatch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run __tests__/entity-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/entity-resolver.ts server/__tests__/entity-resolver.test.ts
git commit -m "feat(dedup): add isDuplicate cascade (canonical + fuzzy Jaccard)"
```

---

## Chunk 2: Integration into createSuggestion

### Task 4: Add aliases to suggestion data types

**Files:**
- Modify: `server/src/types.ts` (lines 311-331)

- [ ] **Step 1: Add `aliases` field to suggestion data interfaces**

In `server/src/types.ts`, add `aliases?: string[]` to `FeatureSuggestionData` and `FlowSuggestionData`:

```typescript
export interface FeatureSuggestionData {
  name: string;
  description: string;
  criticality: Criticality;
  expected_behaviors: string[];
  discovered_at_url?: string;
  aliases?: string[]; // Alternative names detected by entity resolver
}

export interface FlowSuggestionData {
  feature_name: string;
  name: string;
  steps: FlowStep[];
  checkpoints: Checkpoint[];
  criticality: Criticality;
  discovered_at_url?: string;
  aliases?: string[]; // Alternative names detected by entity resolver
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(dedup): add aliases field to suggestion data types"
```

---

### Task 5: Replace exact-match dedup with entity resolver in createSuggestion

**Files:**
- Modify: `server/src/db.ts` (lines 349-434)

This is the core integration. Replace the current dedup logic with the entity resolver cascade. Key changes:

1. Also check `dismissed` suggestions (not just pending) to prevent re-creation
2. Use `isDuplicate()` instead of exact name match
3. When a fuzzy match is found on a pending suggestion, add the new name as an alias

- [ ] **Step 1: Import entity resolver at top of db.ts**

Add to imports in `server/src/db.ts`:

```typescript
import { isDuplicate } from './entity-resolver.js';
```

- [ ] **Step 2: Replace the dedup block in `createSuggestion()`**

Replace lines 357-418 (the `// --- Deduplication ---` section) with:

```typescript
  // --- Deduplication (cascading entity resolution) ---
  const name = 'name' in data ? (data as any).name : ('feature_name' in data ? (data as any).feature_name : null);

  if (name) {
    // 1. Check pending AND dismissed suggestions for duplicates
    const { data: existingSuggs } = await supabase!
      .from('memory_suggestions')
      .select('id, data, status')
      .eq('agent_id', agentId)
      .eq('type', type)
      .in('status', ['pending', 'dismissed']);

    if (existingSuggs && existingSuggs.length > 0) {
      if (type === 'behavior') {
        // For behaviors, check feature_name + behavior text (exact)
        const bd = data as BehaviorSuggestionData;
        const isDupe = existingSuggs.some((s: any) =>
          s.data?.feature_name?.toLowerCase() === bd.feature_name.toLowerCase()
          && s.data?.behavior === bd.behavior
        );
        if (isDupe) return null;
      } else {
        // For features/flows, use cascading entity resolution
        const existingNames = existingSuggs.map((s: any) => s.data?.name).filter(Boolean);
        const match = isDuplicate(name, existingNames);

        if (match) {
          // If it's a pending suggestion and match is fuzzy, add alias
          const matchedSugg = existingSuggs.find((s: any) =>
            s.data?.name === match.matchedName && s.status === 'pending'
          );
          if (matchedSugg && match.method === 'fuzzy') {
            const aliases: string[] = (matchedSugg as any).data?.aliases || [];
            if (!aliases.includes(name)) {
              aliases.push(name);
              await supabase!
                .from('memory_suggestions')
                .update({ data: { ...matchedSugg.data, aliases } })
                .eq('id', matchedSugg.id);
              console.log(`[DEDUP] Added alias "${name}" to suggestion "${match.matchedName}"`);
            }
          } else {
            console.log(`[DEDUP] Rejected duplicate "${name}" (matched "${match.matchedName}" via ${match.method})`);
          }
          return null;
        }
      }
    }

    // 2. Check already-accepted entities (features/flows in DB)
    if (type === 'feature') {
      // Check accepted features — need fuzzy match here too
      const { data: features } = await supabase!
        .from('memory_features')
        .select('name')
        .eq('agent_id', agentId);
      if (features) {
        const featureNames = features.map((f: any) => f.name);
        const match = isDuplicate(name, featureNames);
        if (match) {
          console.log(`[DEDUP] Rejected "${name}" — accepted feature "${match.matchedName}" exists`);
          return null;
        }
      }
    }

    if (type === 'flow') {
      const fd = data as FlowSuggestionData;
      const feature = await findFeatureByName(agentId, fd.feature_name);
      if (feature) {
        const { data: flows } = await supabase!
          .from('memory_flows')
          .select('name')
          .eq('feature_id', feature.id);
        if (flows) {
          const flowNames = flows.map((f: any) => f.name);
          const match = isDuplicate(name, flowNames);
          if (match) {
            console.log(`[DEDUP] Rejected flow "${name}" — accepted flow "${match.matchedName}" exists`);
            return null;
          }
        }
      }
    }

    if (type === 'behavior') {
      const bd = data as BehaviorSuggestionData;
      const feature = await findFeatureByName(agentId, bd.feature_name);
      if (feature && feature.expected_behaviors?.includes(bd.behavior)) {
        return null;
      }
    }
  }
```

- [ ] **Step 3: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Run full test suite to verify no regressions**

Run: `cd server && npx vitest run`
Expected: ALL PASS

Note: The replacement code above replaces ONLY the dedup section (lines 357-418). The `isSupabaseEnabled()` guard at line 355 and the `// --- Insert ---` section from line 420 onward MUST remain unchanged. The closing `}` for `if (name)` block is the final line of the replacement.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts
git commit -m "feat(dedup): integrate cascading entity resolution into createSuggestion

Replace exact-match dedup with canonicalize → fuzzy Jaccard cascade.
Also checks dismissed suggestions to prevent re-creation.
Adds aliases when fuzzy match found on pending suggestions."
```

---

### Task 6: Carry aliases forward on acceptance + check aliases during dedup

**Files:**
- Modify: `server/src/db.ts` (acceptSuggestion function + feature dedup in createSuggestion)

When a suggestion with aliases is accepted and creates a feature, the accepted-entity dedup check (Level 2) must also compare against alias names, not just the primary feature name. This prevents a feature accepted as "Main Navigation" (with alias "Navigation Menu") from being re-created when a 3rd exploration finds "Nav Bar".

- [ ] **Step 1: Update feature dedup to include aliases from pending suggestions**

In the Level 2 feature dedup check inside `createSuggestion()` (the `type === 'feature'` block that queries `memory_features`), also collect alias names from pending suggestions to pass to `isDuplicate()`:

```typescript
    if (type === 'feature') {
      const { data: features } = await supabase!
        .from('memory_features')
        .select('name')
        .eq('agent_id', agentId);
      if (features) {
        const featureNames = features.map((f: any) => f.name);
        // Also include aliases from pending suggestions so their alternate names are checked
        if (existingSuggs) {
          for (const s of existingSuggs as any[]) {
            if (s.data?.aliases) {
              featureNames.push(...s.data.aliases);
            }
          }
        }
        const match = isDuplicate(name, featureNames);
        if (match) {
          console.log(`[DEDUP] Rejected "${name}" — accepted feature "${match.matchedName}" exists`);
          return null;
        }
      }
    }
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add server/src/db.ts
git commit -m "feat(dedup): check suggestion aliases during accepted-entity dedup"
```

---

## Chunk 3: End-to-End Verification

### Task 7: Integration test — real dedup scenarios

**Files:**
- Modify: `server/__tests__/entity-resolver.test.ts`

- [ ] **Step 1: Add integration-style tests for real-world scenarios**

```typescript
describe('real-world dedup scenarios', () => {
  const existingFeatures = [
    'Main Navigation',
    'User Profile',
    'Dashboard Analytics',
    'Account Settings',
    'Login Form',
  ];

  it('catches LLM naming variations (canonical match)', () => {
    // Both canonicalize to "navigation"
    expect(isDuplicate('Navigation Menu', existingFeatures)).not.toBeNull();
    expect(isDuplicate('Top Navigation', existingFeatures)).not.toBeNull();
    // Both canonicalize to "login form"
    expect(isDuplicate('Login Authentication Form', existingFeatures)).not.toBeNull();
  });

  it('catches fuzzy matches above threshold', () => {
    // "account settings section" vs "account settings" → Jaccard 2/3 = 0.67
    expect(isDuplicate('Account Settings Panel', existingFeatures)).not.toBeNull();
  });

  it('allows genuinely different features', () => {
    expect(isDuplicate('Shopping Cart', existingFeatures)).toBeNull();
    expect(isDuplicate('Payment Processing', existingFeatures)).toBeNull();
    expect(isDuplicate('File Upload', existingFeatures)).toBeNull();
  });

  it('does not false-positive on partial word overlap', () => {
    // "User Profile" exists, but "User Billing" is different
    expect(isDuplicate('User Billing', existingFeatures)).toBeNull();
  });

  it('handles edge cases', () => {
    expect(isDuplicate('', existingFeatures)).toBeNull();
    expect(isDuplicate('  ', existingFeatures)).toBeNull();
  });

  it('does not match when both inputs canonicalize to empty', () => {
    // All stopwords → empty canonical → should NOT match
    expect(isDuplicate('Main Top', ['Primary Header'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `cd server && npx vitest run __tests__/entity-resolver.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Run TypeScript compilation for both workspaces**

Run: `npx tsc --noEmit --project client/tsconfig.json && npx tsc --noEmit --project server/tsconfig.json`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add server/__tests__/entity-resolver.test.ts
git commit -m "test(dedup): add real-world entity resolution scenarios"
```

---

## Performance Note

The `isDuplicate` function performs O(N) canonicalization against all existing suggestions of the same type per agent. At current scale (~100s of suggestions per agent) this is negligible (<1ms). If suggestion counts grow to 1000+, consider:
- Storing pre-computed canonical names in an indexed column
- Caching canonical forms in memory during batch operations (explore sessions)

---

## Design Decisions

- **Type-aware resolution:** Dedup only compares within the same entity type (`feature` vs `feature`, `flow` vs `flow`). A feature called "Login" and a flow called "Login" are intentionally allowed to coexist.
- **Flow scoping:** Flow dedup compares flow names within the parent feature only (via `findFeatureByName` → query flows under that feature). A flow "Happy Path" under "Login" won't conflict with "Happy Path" under "Checkout".
- **Conservative synonyms:** `list`/`table`/`grid` are NOT merged — they are structurally different UI components. `tab` is NOT mapped to `section` — tabs and sections are different UI patterns.
- **Hyphen handling:** `canonicalize()` splits on hyphens (so "Sign-In" and "Sign In" produce the same canonical form). `tokenize()` also splits on hyphens for consistency.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | `canonicalize()` — stopwords, synonyms | entity-resolver.ts + test |
| 2 | `tokenize()` + `jaccardSimilarity()` | entity-resolver.ts + test |
| 3 | `isDuplicate()` — cascade function | entity-resolver.ts + test |
| 4 | Add `aliases` to types | types.ts |
| 5 | Integrate into `createSuggestion()` | db.ts |
| 6 | Check aliases during accepted-entity dedup | db.ts |
| 7 | E2E verification tests | entity-resolver.test.ts |

**Total: 7 tasks, ~25 steps, estimated 4 commits of substance + 1 test commit**
