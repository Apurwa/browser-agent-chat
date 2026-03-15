-- Migration: Credential Vault tables
-- Run this in Supabase SQL Editor

-- 1. Credential Vault table
CREATE TABLE credentials_vault (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  label text NOT NULL,
  credential_type text NOT NULL DEFAULT 'username_password',
  encrypted_secret jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  domains text[] NOT NULL DEFAULT '{}',
  scope text NOT NULL DEFAULT 'personal',
  version integer NOT NULL DEFAULT 1,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_used_by_agent uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_by_agent uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE credentials_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own credentials"
  ON credentials_vault FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_credentials_vault_user_id ON credentials_vault(user_id);
CREATE INDEX idx_credentials_vault_domains ON credentials_vault USING GIN(domains);

-- 2. Agent-Credential Bindings table
CREATE TABLE agent_credential_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES credentials_vault(id) ON DELETE CASCADE,
  usage_context text,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, credential_id)
);

ALTER TABLE agent_credential_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agent bindings"
  ON agent_credential_bindings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM credentials_vault cv
      WHERE cv.id = credential_id AND cv.user_id = auth.uid()
    )
  );

CREATE INDEX idx_agent_cred_bindings_agent ON agent_credential_bindings(agent_id);
CREATE INDEX idx_agent_cred_bindings_cred ON agent_credential_bindings(credential_id);

-- 3. RPC for atomic use_count increment
CREATE OR REPLACE FUNCTION increment_vault_use(vault_uuid UUID, agent_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE credentials_vault
  SET use_count = use_count + 1,
      last_used_at = now(),
      last_used_by_agent = agent_uuid,
      updated_at = now()
  WHERE id = vault_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RPC for atomic version increment (used by rotateCredential)
CREATE OR REPLACE FUNCTION increment_vault_version(vault_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE credentials_vault
  SET version = version + 1,
      updated_at = now()
  WHERE id = vault_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Add credential_id and domain columns to learned_patterns for vault integration
ALTER TABLE learned_patterns
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES credentials_vault(id) ON DELETE SET NULL;

-- Unique constraint for upsert in recordLoginPattern
CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_patterns_agent_domain_type
  ON learned_patterns(agent_id, domain, pattern_type)
  WHERE domain IS NOT NULL;
