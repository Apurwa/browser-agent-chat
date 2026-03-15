import type { LoginDetectionResult } from './types.js';

export const LOGIN_THRESHOLD = 5;

interface DetectionSignals {
  hasVisiblePasswordField: boolean;
  hasLoginFormAction: boolean;
  hasSignInButton: boolean;
  hasPasswordNameField: boolean;
  hasUsernameField: boolean;
}

const WEIGHTS = {
  hasVisiblePasswordField: 5,
  hasLoginFormAction: 3,
  hasSignInButton: 2,
  hasPasswordNameField: 2,
  hasUsernameField: 2,
};

export function computeScore(signals: DetectionSignals): number {
  let score = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (signals[key as keyof DetectionSignals]) score += weight;
  }
  return score;
}

/**
 * Returns a script to be run via page.evaluate() that inspects the DOM
 * for login form signals and returns selectors.
 */
export function buildDetectionScript(): string {
  return `(() => {
    const isVisible = (el) => el && el.offsetParent !== null;

    // Password field
    const pwFields = [...document.querySelectorAll('input[type="password"]')].filter(isVisible);
    const hasVisiblePasswordField = pwFields.length > 0;

    // Form action
    const forms = [...document.querySelectorAll('form')];
    const loginForm = forms.find(f => {
      const action = (f.getAttribute('action') || '').toLowerCase();
      return action.includes('login') || action.includes('signin') || action.includes('sign-in') || action.includes('auth');
    });
    const hasLoginFormAction = !!loginForm;

    // Sign-in button
    const buttons = [...document.querySelectorAll('button, input[type="submit"], a[role="button"]')];
    const signInBtn = buttons.find(b => {
      const text = (b.textContent || b.getAttribute('value') || '').toLowerCase().trim();
      return /^(sign\\s*in|log\\s*in|submit|login)$/i.test(text) || text.includes('sign in') || text.includes('log in');
    });
    const hasSignInButton = !!signInBtn && isVisible(signInBtn);

    // Password-like name attribute
    const namedPwFields = [...document.querySelectorAll('input[name*="password"], input[name*="passwd"], input[name*="pass"]')].filter(isVisible);
    const hasPasswordNameField = namedPwFields.length > 0 && !hasVisiblePasswordField;

    // Username-like field
    const userFields = [...document.querySelectorAll('input[type="email"], input[type="text"][name*="user"], input[type="text"][name*="email"], input[type="text"][name*="login"], input[id*="user"], input[id*="email"], input[id*="login"]')].filter(isVisible);
    const hasUsernameField = userFields.length > 0;

    // Build selectors
    const pwSelector = pwFields[0] ? buildSelector(pwFields[0]) : null;
    const userSelector = userFields[0] ? buildSelector(userFields[0]) : null;
    const submitSelector = signInBtn ? buildSelector(signInBtn) : null;

    function buildSelector(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
      // Fallback: type + index
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || 'text';
      const siblings = [...document.querySelectorAll(tag + '[type="' + type + '"]')];
      const idx = siblings.indexOf(el);
      return tag + '[type="' + type + '"]:nth-of-type(' + (idx + 1) + ')';
    }

    // Detect strategy
    let strategy = 'unknown';
    if (hasVisiblePasswordField && hasUsernameField) {
      strategy = 'standard_form';
    } else if (hasUsernameField && !hasVisiblePasswordField) {
      strategy = 'two_step';
    }

    return {
      hasVisiblePasswordField,
      hasLoginFormAction,
      hasSignInButton,
      hasPasswordNameField,
      hasUsernameField,
      selectors: { username: userSelector, password: pwSelector, submit: submitSelector },
      strategy,
    };
  })()`;
}

/**
 * Detect login page by running DOM heuristic via page.evaluate().
 * Returns LoginDetectionResult with score, selectors, and strategy.
 */
export async function detectLoginPage(page: any): Promise<LoginDetectionResult> {
  const url = new URL(page.url());
  const domain = url.hostname;

  const result = await page.evaluate(buildDetectionScript());
  const score = computeScore(result);

  return {
    score,
    isLoginPage: score >= LOGIN_THRESHOLD,
    selectors: result.selectors,
    domain,
    strategy: result.strategy as LoginDetectionResult['strategy'],
  };
}
