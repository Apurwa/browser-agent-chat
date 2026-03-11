import { supabase, isSupabaseEnabled } from './supabase.js';

export type MessageType = 'user' | 'agent' | 'system' | 'thought' | 'action';

export interface Session {
  id: string;
  url: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  user_id: string | null;
}

export interface Message {
  id: string;
  session_id: string;
  type: MessageType;
  content: string;
  created_at: string;
}

export interface Screenshot {
  id: string;
  session_id: string;
  data: string;
  created_at: string;
}

export async function createSession(url: string, userId: string | null = null): Promise<string | null> {
  if (!isSupabaseEnabled() || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('sessions')
    .insert({ url, user_id: userId })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to create session:', error);
    throw error;
  }

  return data.id;
}

export async function endSession(sessionId: string): Promise<void> {
  if (!isSupabaseEnabled() || !supabase) {
    return;
  }

  const { error } = await supabase
    .from('sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) {
    console.error('Failed to end session:', error);
  }
}

export async function saveMessage(
  sessionId: string,
  type: MessageType,
  content: string
): Promise<void> {
  if (!isSupabaseEnabled() || !supabase) {
    return;
  }

  const { error } = await supabase
    .from('messages')
    .insert({ session_id: sessionId, type, content });

  if (error) {
    console.error('Failed to save message:', error);
  }
}

export async function saveScreenshot(
  sessionId: string,
  data: string
): Promise<void> {
  if (!isSupabaseEnabled() || !supabase) {
    return;
  }

  const { error } = await supabase
    .from('screenshots')
    .insert({ session_id: sessionId, data });

  if (error) {
    console.error('Failed to save screenshot:', error);
  }
}

export async function getSessionHistory(sessionId: string, userId?: string): Promise<{
  session: Session | null;
  messages: Message[];
  screenshots: Screenshot[];
}> {
  if (!isSupabaseEnabled() || !supabase) {
    return { session: null, messages: [], screenshots: [] };
  }

  let sessionQuery = supabase.from('sessions').select('*').eq('id', sessionId);
  if (userId) {
    sessionQuery = sessionQuery.eq('user_id', userId);
  }

  const [sessionResult, messagesResult, screenshotsResult] = await Promise.all([
    sessionQuery.single(),
    supabase.from('messages').select('*').eq('session_id', sessionId).order('created_at', { ascending: true }),
    supabase.from('screenshots').select('*').eq('session_id', sessionId).order('created_at', { ascending: true })
  ]);

  return {
    session: sessionResult.data as Session | null,
    messages: sessionResult.data ? (messagesResult.data || []) as Message[] : [],
    screenshots: sessionResult.data ? (screenshotsResult.data || []) as Screenshot[] : []
  };
}

export async function listSessions(limit = 50, userId?: string): Promise<Session[]> {
  if (!isSupabaseEnabled() || !supabase) {
    return [];
  }

  let query = supabase
    .from('sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to list sessions:', error);
    return [];
  }

  return (data || []) as Session[];
}
