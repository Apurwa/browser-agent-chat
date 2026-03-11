-- Migration: Add user_id to sessions for auth
-- Run this in Supabase SQL Editor

-- Add user_id column (nullable for existing rows)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id text;

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Policy: users can only access their own sessions
CREATE POLICY "users_own_sessions" ON sessions
  FOR ALL USING (user_id = auth.uid()::text);

-- Index for faster user-scoped queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
