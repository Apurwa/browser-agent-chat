-- ============================================================
-- Migration 008: Agent Architecture Foundation
-- - New table: frontier_items (unexplored UI elements queue)
-- - Extend nav_nodes: purpose, available_actions, visited
-- - Extend learned_patterns: intent, anchors, preconditions,
--                            success_criteria, learned_from
-- ============================================================

-- -------------------------------------------------------
-- 1. frontier_items table
-- -------------------------------------------------------
CREATE TABLE frontier_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  page_id UUID REFERENCES nav_nodes(id) ON DELETE SET NULL,
  target_url_hash TEXT,
  element_label TEXT NOT NULL,
  action JSONB NOT NULL,
  priority NUMERIC NOT NULL DEFAULT 0,
  intent_relevance NUMERIC,
  discovered_at_step INTEGER NOT NULL DEFAULT 0,
  explored BOOLEAN NOT NULL DEFAULT false,
  persistent BOOLEAN NOT NULL DEFAULT false,
  category TEXT NOT NULL CHECK (category IN ('navigation', 'form', 'modal', 'button', 'link')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE frontier_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage frontier_items for their agents"
  ON frontier_items FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

-- Index for fetching unexplored items by agent
CREATE INDEX idx_frontier_agent_explored
  ON frontier_items (agent_id, explored);

-- Partial index for priority queue: unexplored items sorted by priority
CREATE INDEX idx_frontier_agent_priority_unexplored
  ON frontier_items (agent_id, priority DESC)
  WHERE NOT explored;

-- Deduplication index: one entry per (agent, target URL)
CREATE UNIQUE INDEX idx_frontier_agent_url_dedup
  ON frontier_items (agent_id, target_url_hash)
  WHERE target_url_hash IS NOT NULL;

-- -------------------------------------------------------
-- 2. Extend nav_nodes
-- -------------------------------------------------------
ALTER TABLE nav_nodes ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE nav_nodes ADD COLUMN IF NOT EXISTS available_actions JSONB DEFAULT '[]';
ALTER TABLE nav_nodes ADD COLUMN IF NOT EXISTS visited BOOLEAN DEFAULT false;

-- -------------------------------------------------------
-- 3. Extend learned_patterns
-- -------------------------------------------------------
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS anchors JSONB DEFAULT '[]';
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS preconditions JSONB DEFAULT '[]';
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS success_criteria TEXT;
ALTER TABLE learned_patterns ADD COLUMN IF NOT EXISTS learned_from TEXT DEFAULT 'auto'
  CHECK (learned_from IN ('auto', 'user'));
