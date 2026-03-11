import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Prefer service role key (bypasses RLS), fall back to anon key
const supabaseKey = supabaseServiceRoleKey || supabaseAnonKey;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase credentials not configured. Database persistence disabled.');
}

export const supabase: SupabaseClient | null = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export const isSupabaseEnabled = (): boolean => supabase !== null;

export interface AuthenticatedUser {
  id: string;
  githubUsername: string;
}

const ALLOWED_GITHUB_USERS = (process.env.ALLOWED_GITHUB_USERS || '')
  .split(',')
  .map(u => u.trim().toLowerCase())
  .filter(Boolean);

export async function verifyToken(token: string): Promise<AuthenticatedUser> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error('Invalid or expired token');
  }

  const githubUsername = (data.user.user_metadata?.user_name as string) || '';

  if (ALLOWED_GITHUB_USERS.length > 0 && !ALLOWED_GITHUB_USERS.includes(githubUsername.toLowerCase())) {
    throw new Error('User not in allowlist');
  }

  return {
    id: data.user.id,
    githubUsername,
  };
}
