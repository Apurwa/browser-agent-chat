-- 009_vault_audit_log.sql
-- Adds credential locking (enabled field) and audit logging

ALTER TABLE credentials_vault
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS credential_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES credentials_vault(id),
  agent_id uuid REFERENCES agents(id),
  session_id text,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_credential ON credential_audit_log(credential_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON credential_audit_log(created_at);

ALTER TABLE credential_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select ON credential_audit_log
  FOR SELECT USING (
    credential_id IN (SELECT id FROM credentials_vault WHERE user_id = auth.uid())
  );

CREATE POLICY audit_log_insert ON credential_audit_log
  FOR INSERT WITH CHECK (
    credential_id IN (SELECT id FROM credentials_vault WHERE user_id = auth.uid())
  );
