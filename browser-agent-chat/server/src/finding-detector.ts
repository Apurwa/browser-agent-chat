import { createFinding, uploadScreenshot } from './db.js';
import type { Finding, FindingType, Criticality, ServerMessage } from './types.js';
import { extractJsonBlocks } from './json-parser.js';

interface RawFinding {
  title: string;
  type: FindingType;
  severity: Criticality;
  feature?: string;
  flow?: string;
  expected_behavior?: string;
  actual_behavior?: string;
}

/**
 * Parse agent thought/response text for finding JSON blocks.
 */
export function parseFindingsFromText(text: string): RawFinding[] {
  const findings: RawFinding[] = [];
  const blocks = extractJsonBlocks(text, 'FINDING_JSON:');

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
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
