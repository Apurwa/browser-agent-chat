import type { LoginResult, PlaintextSecret } from './types.js';

interface Selectors {
  username: string | null;
  password: string | null;
  submit: string | null;
}

/**
 * Try to fill a field using the detected CSS selector. If it fails (e.g. React
 * generates IDs with special chars that Playwright can't resolve), fall back to
 * role-based or type-based locators.
 */
async function fillField(page: any, selector: string | null, value: string, kind: 'username' | 'password'): Promise<boolean> {
  // 1. Try detected selector
  if (selector) {
    try {
      await page.fill(selector, value, { timeout: 3000 });
      return true;
    } catch {
      console.log(`[LOGIN-STRATEGY] Selector "${selector}" failed for ${kind}, trying fallbacks`);
    }
  }

  // 2. Fallback by input type
  const typeSelector = kind === 'password'
    ? 'input[type="password"]:visible'
    : 'input[type="email"]:visible, input[type="text"][name*="user"]:visible, input[type="text"][name*="email"]:visible';
  try {
    await page.locator(typeSelector).first().fill(value, { timeout: 3000 });
    return true;
  } catch {
    // continue
  }

  // 3. Fallback by placeholder text
  const placeholderHints = kind === 'password'
    ? ['password', 'Password']
    : ['email', 'Email', 'username', 'Username'];
  for (const hint of placeholderHints) {
    try {
      await page.getByPlaceholder(hint).first().fill(value, { timeout: 2000 });
      return true;
    } catch {
      // try next
    }
  }

  return false;
}

/**
 * Click the submit button. Try detected selector first, then common fallbacks.
 */
async function clickSubmit(page: any, selector: string | null): Promise<void> {
  if (selector) {
    try {
      await page.click(selector, { timeout: 3000 });
      return;
    } catch {
      console.log(`[LOGIN-STRATEGY] Submit selector "${selector}" failed, trying fallbacks`);
    }
  }

  // Fallback: try common submit patterns
  const fallbacks = [
    'button[type="submit"]:visible',
    'button:has-text("Sign in"):visible',
    'button:has-text("Log in"):visible',
    'button:has-text("Login"):visible',
    'input[type="submit"]:visible',
  ];
  for (const fb of fallbacks) {
    try {
      await page.locator(fb).first().click({ timeout: 2000 });
      return;
    } catch {
      // try next
    }
  }
  console.warn('[LOGIN-STRATEGY] Could not find submit button');
}

/**
 * Execute a standard form login: fill username, fill password, click submit.
 * Security: password variable is zeroed after page.fill().
 */
export async function executeStandardLogin(
  page: any,
  selectors: Selectors,
  secret: PlaintextSecret,
  metadata: { username?: string },
  loginUrl: string,
): Promise<LoginResult> {
  try {
    // Fill username — try detected selector, fall back to role-based locators
    if (metadata.username) {
      const filled = await fillField(page, selectors.username, metadata.username, 'username');
      if (!filled) {
        console.warn('[LOGIN-STRATEGY] Could not fill username field');
      }
    }

    // Fill password — zero variable immediately after
    if (secret.password) {
      const filled = await fillField(page, selectors.password, secret.password, 'password');
      // Security: zero the reference (caller should also zero their copy)
      (secret as any).password = null;
      if (!filled) {
        console.warn('[LOGIN-STRATEGY] Could not fill password field');
      }
    }

    // Click submit — try detected selector, fall back to common patterns
    await clickSubmit(page, selectors.submit);

    // Wait for navigation/SPA route change — try multiple strategies
    await page.waitForLoadState('networkidle').catch(() => {});

    // Poll for URL change or password field disappearance (up to 8 seconds)
    // SPAs often take several seconds to redirect after login
    let success = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.waitForTimeout(2000);
      success = await verifyLoginSuccess(page, loginUrl);
      if (success) break;
    }

    return { success, error: success ? undefined : 'Login verification failed' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Check if login succeeded by verifying URL changed or password field disappeared.
 * Uses page.evaluate(location.href) for SPA-aware URL detection.
 */
export async function verifyLoginSuccess(page: any, loginUrl: string): Promise<boolean> {
  // Use evaluate for SPA-aware URL (page.url() can be stale after client-side routing)
  const currentUrl = await page.evaluate('location.href').catch(() => page.url());

  // URL changed away from login page
  if (currentUrl !== loginUrl) return true;

  // Same URL but check multiple signals (runs in browser context)
  const loginGone = await page.evaluate(`(() => {
    const pw = document.querySelector('input[type="password"]');
    const pwVisible = pw !== null && pw.offsetParent !== null;
    if (!pwVisible) return true;

    // Check for error messages that indicate a failed login
    const errorTexts = ['invalid', 'incorrect', 'wrong', 'failed', 'error', 'denied'];
    const alerts = [...document.querySelectorAll('[role="alert"], .error, .alert-danger, .alert-error')];
    const hasError = alerts.some(el => {
      const text = (el.textContent || '').toLowerCase();
      return errorTexts.some(e => text.includes(e));
    });
    if (hasError) return false;

    return false;
  })()`);

  return loginGone;
}
