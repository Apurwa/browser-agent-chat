-- Migration 007: Credential Vault data migration
-- NOTE: Data migration is handled by server/scripts/migrate-credentials.ts
-- This file documents the schema change only.

-- After running the migration script, drop the old column:
-- ALTER TABLE agents DROP COLUMN IF EXISTS credentials;
