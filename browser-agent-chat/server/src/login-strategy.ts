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

    // Wait for navigation
    await page.waitForLoadState('networkidle').catch(() => {});

    // Verify success
    const success = await verifyLoginSuccess(page, loginUrl);
    return { success, error: success ? undefined : 'Login verification failed' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Check if login succeeded by verifying URL changed or password field disappeared.
 */
export async function verifyLoginSuccess(page: any, loginUrl: string): Promise<boolean> {
  const currentUrl = page.url();

  // URL changed away from login page
  if (currentUrl !== loginUrl) return true;

  // Same URL but check if password field is gone (runs in browser context)
  const hasPasswordField = await page.evaluate(`(() => {
    const pw = document.querySelector('input[type="password"]');
    return pw !== null && pw.offsetParent !== null;
  })()`);

  return !hasPasswordField;
}
