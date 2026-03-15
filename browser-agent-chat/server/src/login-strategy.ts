import type { LoginResult, PlaintextSecret } from './types.js';

interface Selectors {
  username: string | null;
  password: string | null;
  submit: string | null;
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
    // Fill username
    if (selectors.username && metadata.username) {
      await page.fill(selectors.username, metadata.username);
    }

    // Fill password — zero variable immediately after
    if (selectors.password && secret.password) {
      await page.fill(selectors.password, secret.password);
      // Security: zero the reference (caller should also zero their copy)
      (secret as any).password = null;
    }

    // Click submit
    if (selectors.submit) {
      await page.click(selectors.submit);
    }

    // Wait for navigation/SPA route change — try multiple strategies
    await page.waitForLoadState('networkidle').catch(() => {});
    // Extra wait for SPAs that do client-side routing after submit
    await page.waitForTimeout(2000);

    // Verify success
    const success = await verifyLoginSuccess(page, loginUrl);
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
