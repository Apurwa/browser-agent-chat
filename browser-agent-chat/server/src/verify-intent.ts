import type { Intent, IntentVerification } from './agent-types.js';

// ---------------------------------------------------------------------------
// verifyIntent — pure heuristic, no LLM, no I/O
// ---------------------------------------------------------------------------

/**
 * Verify whether the current browser state satisfies an intent's success criteria.
 *
 * Heuristics (priority order):
 *  1. Success criteria keywords found in page title → passed=true, confidence=0.7
 *  2. Success criteria keywords found in URL       → passed=true, confidence=0.6
 *  3. No match                                     → passed=false, confidence=0.3
 *
 * "Keywords" are the non-trivial tokens from the successCriteria string.
 * LLM-based semantic evaluation is a future enhancement.
 */
export async function verifyIntent(
  intent: Intent,
  currentUrl: string,
  pageTitle: string,
): Promise<IntentVerification> {
  const keywords = extractKeywords(intent.successCriteria);

  const titleLower = pageTitle.toLowerCase();
  const urlLower = currentUrl.toLowerCase();

  if (keywords.some(kw => titleLower.includes(kw))) {
    return { intentId: intent.id, passed: true, confidence: 0.7 };
  }

  if (keywords.some(kw => urlLower.includes(kw))) {
    return { intentId: intent.id, passed: true, confidence: 0.6 };
  }

  return { intentId: intent.id, passed: false, confidence: 0.3 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'to', 'of', 'in',
  'on', 'at', 'by', 'for', 'with', 'from', 'and', 'or', 'but', 'not',
  'it', 'its', 'this', 'that', 'these', 'those',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}
