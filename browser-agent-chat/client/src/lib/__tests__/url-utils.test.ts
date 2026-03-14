import { describe, it, expect } from 'vitest';
import { deriveProjectName } from '../url-utils';

describe('deriveProjectName', () => {
  it('extracts domain name from full URL', () => {
    expect(deriveProjectName('https://app.acme.com/dashboard')).toBe('Acme');
  });

  it('strips www prefix', () => {
    expect(deriveProjectName('https://www.acme.com')).toBe('Acme');
  });

  it('strips common prefixes: app, dashboard, staging, dev', () => {
    expect(deriveProjectName('https://dashboard.stripe.com')).toBe('Stripe');
    expect(deriveProjectName('https://staging.myapp.io')).toBe('Myapp');
    expect(deriveProjectName('https://dev.product.co')).toBe('Product');
  });

  it('handles URLs without protocol', () => {
    expect(deriveProjectName('acme.com')).toBe('Acme');
  });

  it('handles localhost with port', () => {
    expect(deriveProjectName('http://localhost:3000')).toBe('Localhost 3000');
  });

  it('handles IP addresses', () => {
    expect(deriveProjectName('http://192.168.1.1:8080')).toBe('192.168.1.1 8080');
  });

  it('capitalizes the first letter', () => {
    expect(deriveProjectName('https://myapp.com')).toBe('Myapp');
  });

  it('handles single-word domains', () => {
    expect(deriveProjectName('https://example.com')).toBe('Example');
  });
});
