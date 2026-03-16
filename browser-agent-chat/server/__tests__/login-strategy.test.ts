import { describe, it, expect, vi } from 'vitest';
import { executeStandardLogin, verifyLoginSuccess } from '../src/login-strategy.js';

describe('Login Strategy', () => {
  /**
   * Build a mock Playwright page. `evaluate` returns different values
   * depending on what script is passed:
   *   'location.href' → urlAfter
   *   DOM check script  → { passwordGone, hasError, hasPostLoginUI }
   */
  function mockPage(opts: {
    urlAfter?: string;
    passwordGone?: boolean;
    hasError?: boolean;
  } = {}) {
    const url = opts.urlAfter ?? 'https://app.example.com/dashboard';
    return {
      url: vi.fn().mockReturnValue(url),
      fill: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          fill: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      waitForURL: vi.fn().mockImplementation(async (pred: (url: URL) => boolean) => {
        // Simulate: if URL changed, resolve; if not, reject (timeout)
        const changed = pred(new URL(url));
        if (!changed) throw new Error('Timeout');
      }),
      evaluate: vi.fn().mockImplementation(async (script: string) => {
        if (script === 'location.href') return url;
        // DOM check script — return structured result
        return {
          passwordGone: opts.passwordGone ?? true,
          hasError: opts.hasError ?? false,
        };
      }),
    };
  }

  it('executeStandardLogin fills fields and clicks submit', async () => {
    const page = mockPage();
    const selectors = { username: '#email', password: '#pass', submit: '#login-btn' };
    const secret = { password: 'secret123' };
    const metadata = { username: 'admin@test.com' };

    const result = await executeStandardLogin(page, selectors, secret, metadata, 'https://example.com/login');

    // fillField tries detected selector first (with timeout option)
    expect(page.fill).toHaveBeenCalledWith('#email', 'admin@test.com', { timeout: 3000 });
    expect(page.fill).toHaveBeenCalledWith('#pass', 'secret123', { timeout: 3000 });
    // clickSubmit tries detected selector first
    expect(page.click).toHaveBeenCalledWith('#login-btn', { timeout: 3000 });
    expect(result.success).toBe(true);
  });

  it('executeStandardLogin reports failure if still on login page', async () => {
    const page = mockPage({
      urlAfter: 'https://example.com/login',
      passwordGone: false,
      hasError: false,
    });
    const selectors = { username: '#email', password: '#pass', submit: '#login-btn' };

    const result = await executeStandardLogin(page, selectors, { password: 'wrong' }, { username: 'admin' }, 'https://example.com/login');

    expect(result.success).toBe(false);
  });

  it('verifyLoginSuccess detects URL change', async () => {
    const page = mockPage({ urlAfter: 'https://example.com/dashboard' });
    const success = await verifyLoginSuccess(page, 'https://example.com/login');
    expect(success).toBe(true);
  });

  it('verifyLoginSuccess detects same URL with password field still visible', async () => {
    const page = mockPage({
      urlAfter: 'https://example.com/login',
      passwordGone: false,
      hasError: false,
    });
    const success = await verifyLoginSuccess(page, 'https://example.com/login');
    expect(success).toBe(false);
  });

  it('verifyLoginSuccess detects password field gone (SPA login)', async () => {
    const page = mockPage({
      urlAfter: 'https://example.com/login',
      passwordGone: true,
    });
    const success = await verifyLoginSuccess(page, 'https://example.com/login');
    expect(success).toBe(true);
  });

  it('verifyLoginSuccess detects error messages as failure', async () => {
    const page = mockPage({
      urlAfter: 'https://example.com/login',
      passwordGone: false,
      hasError: true,
    });
    const success = await verifyLoginSuccess(page, 'https://example.com/login');
    expect(success).toBe(false);
  });

});
