import type { Intent, IntentVerification } from './agent-types.js';

// ---------------------------------------------------------------------------
// verifyIntent — pure heuristic, no LLM, no I/O
// ---------------------------------------------------------------------------

/**
 * Verify whether the current browser state satisfies an intent's success criteria.
 *
 * Heuristics:
 *  1. ≥40% of criteria keywords found (fuzzy substring) in page title + URL → passed=true
 *  2. Any criteria keyword found in URL path segments → passed=true
 *  3. No match → passed=false
 *
 * Fuzzy matching uses substring containment (not exact token equality) to
 * tolerate plurals, suffixes, and partial matches.
 */
export async function verifyIntent(
  intent: Intent,
  currentUrl: string,
  pageTitle: string,
): Promise<IntentVerification> {
  const criteriaWords = extractKeywords(intent.successCriteria);
  const contextWords = extractKeywords(`${pageTitle} ${currentUrl}`);

  // Check overlap — ≥40% of criteria keywords found in context
  const matches = criteriaWords.filter(w =>
    contextWords.some(cw => cw.includes(w) || w.includes(cw))
  );
  const overlapRatio = criteriaWords.length > 0
    ? matches.length / criteriaWords.length
    : 0;

  // Also check URL path segments as a separate signal
  let urlSegments: string[] = [];
  try {
    urlSegments = new URL(currentUrl).pathname.split('/').filter(s => s.length > 2);
  } catch {
    // non-fatal: malformed URL
  }
  const urlMatch = criteriaWords.some(w =>
    urlSegments.some(seg => seg.toLowerCase().includes(w))
  );

  if (overlapRatio >= 0.4 || urlMatch) {
    return {
      intentId: intent.id,
      passed: true,
      confidence: Math.max(overlapRatio, 0.5),
    };
  }

  return { intentId: intent.id, passed: false, confidence: overlapRatio };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'for', 'of', 'and', 'in', 'on',
  'with', 'that', 'this', 'its', 'or', 'be', 'has', 'should', 'all', 'can',
  'was', 'were', 'been', 'being', 'have', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'may', 'might', 'must', 'could', 'at', 'by',
  'from', 'but', 'not', 'it', 'these', 'those',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}
