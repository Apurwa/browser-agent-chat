import { describe, it, expect, vi } from 'vitest';
import { executeStandardLogin, verifyLoginSuccess } from '../src/login-strategy.js';

describe('Login Strategy', () => {
  function mockPage(opts: { urlAfter?: string; hasPassword?: boolean } = {}) {
    return {
      url: vi.fn().mockReturnValue(opts.urlAfter ?? 'https://app.example.com/dashboard'),
      fill: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      // evaluate returns whether a visible password field exists
      // verifyLoginSuccess checks: if URL changed → success; if same URL and password field gone → success
      evaluate: vi.fn().mockResolvedValue(opts.hasPassword ?? false),
    };
  }

  it('executeStandardLogin fills fields and clicks submit', async () => {
    const page = mockPage();
    const selectors = { username: '#email', password: '#pass', submit: '#login-btn' };
    const secret = { password: 'secret123' };
    const metadata = { username: 'admin@test.com' };

    const result = await executeStandardLogin(page, selectors, secret, metadata, 'https://example.com/login');

    expect(page.fill).toHaveBeenCalledWith('#email', 'admin@test.com');
    expect(page.fill).toHaveBeenCalledWith('#pass', 'secret123');
    expect(page.click).toHaveBeenCalledWith('#login-btn');
    expect(result.success).toBe(true);
  });

  it('executeStandardLogin reports failure if still on login page', async () => {
    const page = mockPage({ urlAfter: 'https://example.com/login', hasPassword: true });
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
    const page = mockPage({ urlAfter: 'https://example.com/login', hasPassword: true });
    const success = await verifyLoginSuccess(page, 'https://example.com/login');
    expect(success).toBe(false);
  });
});
