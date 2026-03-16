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

  // 3. Fallback by label text (handles Radix/shadcn-style forms like Langfuse)
  const labelHints = kind === 'password'
    ? ['Password', 'password']
    : ['Email', 'email', 'Username', 'username', 'Email address'];
  for (const label of labelHints) {
    try {
      await page.getByLabel(label).first().fill(value, { timeout: 2000 });
      return true;
    } catch {
      // try next
    }
  }

  // 4. Fallback by placeholder text
  const placeholderHints = kind === 'password'
    ? ['password', 'Password', '••••••••']
    : ['email', 'Email', 'username', 'Username', 'jsdoe@example.com', 'name@example.com', 'you@example.com'];
  for (const hint of placeholderHints) {
    try {
      await page.getByPlaceholder(hint).first().fill(value, { timeout: 2000 });
      return true;
    } catch {
      // try next
    }
  }

  // 5. Last resort: first visible text input (for username) or password input
  try {
    if (kind === 'password') {
      await page.locator('input[type="password"]').first().fill(value, { timeout: 2000 });
    } else {
      await page.locator('input:visible').first().fill(value, { timeout: 2000 });
    }
    return true;
  } catch {
    // give up
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

  // Fallback: try role-based button matching (handles React/Radix components)
  const roleNames = [/sign in/i, /log in/i, /login/i, /submit/i, /continue/i];
  for (const name of roleNames) {
    try {
      await page.getByRole('button', { name }).first().click({ timeout: 2000 });
      return;
    } catch {
      // try next
    }
  }

  // Fallback: CSS selector patterns
  const fallbacks = [
    'button[type="submit"]:visible',
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

    // Wait for navigation — try waitForURL first (catches server-side redirects),
    // then fall back to networkidle for SPAs
    try {
      await page.waitForURL((url: URL) => url.href !== loginUrl, { timeout: 5000 });
      console.log('[LOGIN-STRATEGY] URL changed after submit');
      return { success: true };
    } catch {
      // URL didn't change within 5s — try networkidle for SPA apps
      await page.waitForLoadState('networkidle').catch(() => {});
    }

    // Poll for URL change or password field disappearance (up to 12 seconds)
    // SPAs often take several seconds to redirect after login
    let success = false;
    for (let attempt = 0; attempt < 6; attempt++) {
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
 * Check if login succeeded by verifying URL changed, password field disappeared,
 * or common post-login indicators appeared.
 * Uses page.evaluate(location.href) for SPA-aware URL detection.
 */
export async function verifyLoginSuccess(page: any, loginUrl: string): Promise<boolean> {
  // Use evaluate for SPA-aware URL (page.url() can be stale after client-side routing)
  let currentUrl: string;
  try {
    currentUrl = await page.evaluate('location.href');
    if (typeof currentUrl !== 'string') currentUrl = page.url();
  } catch {
    currentUrl = page.url();
  }

  // URL changed away from login page
  if (currentUrl !== loginUrl) return true;

  // Same URL — check DOM signals (runs in browser context)
  const domResult: { passwordGone: boolean; hasError: boolean } = await page.evaluate(`(() => {
    // 1. Password field gone?
    const pw = document.querySelector('input[type="password"]');
    const passwordGone = pw === null || pw.offsetParent === null;

    // 2. Error messages present?
    const errorTexts = ['invalid', 'incorrect', 'wrong', 'failed', 'error', 'denied', 'unauthorized'];
    const alertSelectors = '[role="alert"], .error, .alert-danger, .alert-error, .text-destructive, [data-testid="error"]';
    const alerts = [...document.querySelectorAll(alertSelectors)];
    const hasError = alerts.some(el => {
      const text = (el.textContent || '').toLowerCase();
      return errorTexts.some(e => text.includes(e));
    });

    return { passwordGone, hasError };
  })()`);

  // Password field gone → login succeeded (form removed)
  if (domResult.passwordGone) return true;

  // Error message visible → login definitely failed
  if (domResult.hasError) return false;

  // Still on login page with password field visible, no clear signal
  return false;
}
