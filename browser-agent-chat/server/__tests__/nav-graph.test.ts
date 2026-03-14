import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../src/nav-graph.js';

describe('normalizeUrl', () => {
  it('strips query parameters', () => {
    expect(normalizeUrl('https://app.com/settings?tab=general')).toBe('/settings');
  });

  it('strips hash fragments', () => {
    expect(normalizeUrl('https://app.com/docs#section-2')).toBe('/docs');
  });

  it('collapses numeric path segments to :id', () => {
    expect(normalizeUrl('https://app.com/users/123')).toBe('/users/:id');
    expect(normalizeUrl('https://app.com/users/456/posts/789')).toBe('/users/:id/posts/:id');
  });

  it('collapses UUID path segments to :id', () => {
    expect(normalizeUrl('https://app.com/orders/a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('/orders/:id');
  });

  it('preserves meaningful path structure', () => {
    expect(normalizeUrl('https://app.com/settings/billing')).toBe('/settings/billing');
    expect(normalizeUrl('https://app.com/admin/users')).toBe('/admin/users');
  });

  it('handles root URL', () => {
    expect(normalizeUrl('https://app.com/')).toBe('/');
    expect(normalizeUrl('https://app.com')).toBe('/');
  });

  it('handles relative paths', () => {
    expect(normalizeUrl('/users/123?page=2')).toBe('/users/:id');
  });

  it('removes trailing slashes except root', () => {
    expect(normalizeUrl('https://app.com/settings/')).toBe('/settings');
  });

  it('handles both query params and hash together', () => {
    expect(normalizeUrl('https://app.com/page?q=search#results')).toBe('/page');
  });

  it('handles mixed numeric and text segments', () => {
    expect(normalizeUrl('https://app.com/projects/42/settings')).toBe('/projects/:id/settings');
  });
});
