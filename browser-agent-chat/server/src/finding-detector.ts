import { createFinding, uploadScreenshot } from './db.js';
import type { Finding, FindingType, Criticality, ServerMessage } from './types.js';

interface RawFinding {
  title: string;
  type: FindingType;
  severity: Criticality;
  feature?: string;
  flow?: string;
  expected_behavior?: string;
  actual_behavior?: string;
}

const FINDING_REGEX = /FINDING_JSON:(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g;
const MEMORY_REGEX = /MEMORY_JSON:(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/g;

/**
 * Parse agent thought/response text for finding JSON blocks.
 */
export function parseFindingsFromText(text: string): RawFinding[] {
  const findings: RawFinding[] = [];
  let match;

  FINDING_REGEX.lastIndex = 0;
  while ((match = FINDING_REGEX.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.title && parsed.type && parsed.severity) {
        findings.push(parsed);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return findings;
}

/**
 * Parse agent text for memory update instructions.
 */
export function parseMemoryUpdatesFromText(text: string): Array<{ action: string; data: Record<string, unknown> }> {
  const updates: Array<{ action: string; data: Record<string, unknown> }> = [];
  let match;

  MEMORY_REGEX.lastIndex = 0;
  while ((match = MEMORY_REGEX.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.action && parsed.data) {
        updates.push(parsed);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return updates;
}

/**
 * Process a detected finding: upload screenshot, save to DB, return the finding.
 */
export async function processFinding(
  raw: RawFinding,
  projectId: string,
  sessionId: string,
  stepsHistory: Array<{ order: number; action: string; target?: string }>,
  getScreenshot: () => Promise<string | null>
): Promise<Finding | null> {
  // Capture screenshot evidence
  let screenshotUrl: string | null = null;
  const screenshotBase64 = await getScreenshot();
  if (screenshotBase64) {
    screenshotUrl = await uploadScreenshot(projectId, screenshotBase64);
  }

  const finding = await createFinding({
    project_id: projectId,
    session_id: sessionId,
    title: raw.title,
    description: null,
    type: raw.type,
    severity: raw.severity,
    feature: raw.feature ?? null,
    flow: raw.flow ?? null,
    steps_to_reproduce: stepsHistory,
    expected_behavior: raw.expected_behavior ?? null,
    actual_behavior: raw.actual_behavior ?? null,
    screenshot_url: screenshotUrl,
    status: 'new',
  });

  return finding;
}
