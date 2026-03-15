/**
 * entity-resolver.ts
 *
 * Utilities for entity name deduplication. Provides canonical normalization,
 * tokenization, Jaccard similarity, and duplicate detection.
 */

export interface DuplicateMatch {
  matchedName: string;
  method: 'canonical' | 'fuzzy';
  similarity: number;
}

// UI stopwords to remove during canonicalization
const STOPWORDS = new Set([
  'main', 'primary', 'secondary', 'top', 'bottom', 'left', 'right',
  'header', 'footer', 'sidebar',
  'the', 'a', 'an', 'of', 'for', 'in', 'with', 'and', 'or', 'to', 'is',
  'are', 'this', 'that', 'its',
  'key', 'core', 'basic', 'advanced', 'simple', 'full', 'complete',
  'current', 'new', 'existing', 'general', 'overall', 'detailed',
  'page', 'view', 'screen',
]);

// Synonym normalization map: token → canonical form
// NOTE: list/table/grid and tab are intentionally excluded — they are distinct UI components
const SYNONYMS: Record<string, string> = {
  menu:      'navigation',
  nav:       'navigation',
  navbar:    'navigation',
  panel:     'section',
  pane:      'section',
  area:      'section',
  dialog:    'modal',
  popup:     'modal',
  overlay:   'modal',
  btn:       'button',
  cta:       'button',
  input:     'field',
  textbox:   'field',
  textarea:  'field',
  dropdown:  'select',
  picker:    'select',
  img:       'image',
  pic:       'image',
  photo:     'image',
};

/**
 * Normalize an entity name to a canonical token string.
 * - Lowercase + trim
 * - Split on whitespace, hyphens, underscores
 * - Remove stopwords
 * - Apply synonym normalization
 * - Deduplicate adjacent identical tokens
 * - Return joined string
 */
export function canonicalize(name: string): string {
  const rawTokens = name
    .toLowerCase()
    .trim()
    .split(/[\s\-_]+/)
    .filter(t => t.length > 0);

  const normalized = rawTokens.map(token => SYNONYMS[token] ?? token);

  const filtered = normalized.filter(token => !STOPWORDS.has(token));

  // Deduplicate adjacent identical tokens
  const deduped: string[] = [];
  for (const token of filtered) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== token) {
      deduped.push(token);
    }
  }

  return deduped.join(' ');
}

/**
 * Tokenize a string into a set of unique lowercase tokens.
 * Splits on whitespace, hyphens, underscores, and common punctuation.
 */
export function tokenize(text: string): Set<string> {
  if (!text) return new Set();

  const tokens = text
    .toLowerCase()
    .split(/[\s\-_/.,;:()+]+/)
    .filter(t => t.length > 0);

  return new Set(tokens);
}

/**
 * Compute Jaccard similarity between two strings based on their token sets.
 * Returns a value in [0.0, 1.0].
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 0;

  const intersection = new Set([...setA].filter(t => setB.has(t)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}

/**
 * Check whether `name` is a duplicate of any name in `existingNames`.
 *
 * Stage 1 — Canonical exact match: both names canonicalize to the same non-empty string.
 * Stage 2 — Fuzzy Jaccard: Jaccard similarity of canonical forms >= threshold.
 *
 * Returns the first match found, preferring canonical matches over fuzzy ones.
 * Returns null if no match meets the threshold.
 */
export function isDuplicate(
  name: string,
  existingNames: string[],
  threshold = 0.6,
): DuplicateMatch | null {
  const canonicalName = canonicalize(name);

  // Cannot match if canonical form is empty (all stopwords)
  if (canonicalName === '') return null;

  // Stage 1: look for a canonical exact match first
  for (const existing of existingNames) {
    const canonicalExisting = canonicalize(existing);
    if (canonicalExisting !== '' && canonicalExisting === canonicalName) {
      return {
        matchedName: existing,
        method: 'canonical',
        similarity: 1.0,
      };
    }
  }

  // Stage 2: fuzzy Jaccard on canonical forms
  let bestMatch: DuplicateMatch | null = null;

  for (const existing of existingNames) {
    const canonicalExisting = canonicalize(existing);
    if (canonicalExisting === '') continue;

    const sim = jaccardSimilarity(canonicalName, canonicalExisting);
    if (sim >= threshold) {
      if (bestMatch === null || sim > bestMatch.similarity) {
        bestMatch = {
          matchedName: existing,
          method: 'fuzzy',
          similarity: sim,
        };
      }
    }
  }

  return bestMatch;
}
