import type { ErrorType, Check } from '../types.js';
import type { CheckResult } from './checks.js';

interface AnalysisInput {
  steps: Array<{ order: number; action: string; target?: string }>;
  finalUrl: string;
  failedChecks: CheckResult[];
  taskPrompt: string;
}

export function classifyError(input: AnalysisInput): ErrorType {
  const { steps, finalUrl, failedChecks, taskPrompt } = input;

  // No steps taken at all — likely a startup/connection issue
  if (steps.length === 0) {
    return 'unexpected_state';
  }

  // Check for URL-based failures first (navigation problems)
  const urlCheck = failedChecks.find(c => c.check.type === 'url_matches');
  if (urlCheck) {
    return 'navigation_failure';
  }

  // Check if agent stopped too early (partial completion)
  const lastStep = steps[steps.length - 1];
  if (steps.length <= 2 && failedChecks.length > 0) {
    return 'partial_completion';
  }

  // Check for element-related failures
  const elementChecks = failedChecks.filter(
    c => c.check.type === 'element_exists' || c.check.type === 'element_absent'
  );
  if (elementChecks.length > 0 && elementChecks.length === failedChecks.length) {
    // All failures are element-related
    // If agent navigated to the right page but elements are wrong
    if (!urlCheck) {
      return 'element_not_found';
    }
  }

  // Check for text content mismatches (could be wrong element or hallucination)
  const textChecks = failedChecks.filter(c => c.check.type === 'text_contains');
  if (textChecks.length > 0) {
    // Agent found the element but text is wrong — likely interacted with wrong thing
    const hasCorrectNav = !urlCheck;
    if (hasCorrectNav && steps.length > 3) {
      return 'wrong_element';
    }
    return 'hallucination';
  }

  // Check for timeout patterns in step descriptions
  const hasTimeout = steps.some(s =>
    s.action.toLowerCase().includes('timeout') ||
    s.action.toLowerCase().includes('timed out')
  );
  if (hasTimeout) {
    return 'action_timeout';
  }

  // Check for extract vs act confusion
  const hasExtractAfterAct = steps.some((s, i) =>
    s.action.includes('extract') && i > 0 && steps[i - 1].action.includes('act')
  );
  if (hasExtractAfterAct && failedChecks.length > 0) {
    return 'tool_misuse';
  }

  // If many steps taken but still failed — likely reasoning error
  if (steps.length > 5) {
    return 'reasoning_error';
  }

  // Default
  return 'partial_completion';
}
