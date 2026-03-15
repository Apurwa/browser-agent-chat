import 'dotenv/config';
import { supabase } from '../src/supabase.js';
import { decryptCredentials } from '../src/crypto.js';
import { encryptSecret } from '../src/crypto.js';

async function migrate() {
  if (!supabase) { console.error('Supabase not configured'); process.exit(1); }

  // 1. Fetch all agents with credentials
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, user_id, name, url, credentials')
    .not('credentials', 'is', null);

  if (error) { console.error('Failed to fetch agents:', error); process.exit(1); }
  if (!agents?.length) { console.log('No agents with credentials to migrate.'); return; }

  console.log(`Migrating ${agents.length} agent(s) with credentials...`);

  for (const agent of agents) {
    try {
      // 2. Decrypt old credentials
      const plain = decryptCredentials(agent.credentials);

      // 3. Extract domain from agent URL
      let domain = '';
      try { domain = new URL(agent.url).hostname; } catch {}

      // 4. Create vault entry
      const encrypted = encryptSecret({ password: plain.password });
      const { data: vaultEntry, error: vaultError } = await supabase
        .from('credentials_vault')
        .insert({
          user_id: agent.user_id,
          label: agent.name,
          credential_type: 'username_password',
          encrypted_secret: encrypted,
          metadata: { username: plain.username },
          domains: domain ? [domain] : [],
        })
        .select('id')
        .single();

      if (vaultError) { console.error(`Failed to create vault entry for agent ${agent.id}:`, vaultError); continue; }

      // 5. Create binding
      await supabase
        .from('agent_credential_bindings')
        .insert({
          agent_id: agent.id,
          credential_id: vaultEntry.id,
          usage_context: 'Migrated from agent credentials',
          priority: 0,
        });

      // 6. Clear old credentials
      await supabase
        .from('agents')
        .update({ credentials: null })
        .eq('id', agent.id);

      console.log(`  Migrated agent "${agent.name}" (${agent.id})`);
    } catch (err) {
      console.error(`  Failed to migrate agent ${agent.id}:`, err);
    }
  }

  console.log('Migration complete.');
}

migrate();
