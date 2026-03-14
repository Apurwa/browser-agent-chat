import { supabase, isSupabaseEnabled } from './supabase.js';
import type { NavNode, NavEdge, NavGraph } from './types.js';

/**
 * Normalize a URL to a canonical pattern for deduplication.
 * Strips query params, hash fragments, collapses numeric/UUID path segments.
 */
export function normalizeUrl(url: string): string {
  let path: string;
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
  } catch {
    // Not a full URL — treat as path, strip query/hash manually
    path = url.split('?')[0].split('#')[0];
  }

  // Remove trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // Collapse UUID segments (must run before numeric to avoid partial match)
  path = path.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '/:id'
  );

  // Collapse numeric-only segments
  path = path.replace(/\/\d+(?=\/|$)/g, '/:id');

  return path || '/';
}
