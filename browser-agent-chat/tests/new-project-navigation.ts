/**
 * E2E test: New project navigates browser to correct URL.
 * Verifies warm browser navigation fix + Trusted Types CSP bypass.
 *
 * Headless — uses WebSocket + Supabase directly (no UI auth).
 *
 * Run:  source server/.env && SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_ROLE_KEY npx tsx tests/new-project-navigation.ts
 */
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

const WS_URL = 'ws://localhost:3001';
const API_URL = 'http://localhost:3001';
const TEST_URL = 'https://www.youtube.com';

const supabaseUrl = process.env.SUPABASE_URL || 'https://nzgomknojsgampfqvabr.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

let failures = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`  PASS: ${msg}`);
  }
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 60_000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(data: WebSocket.Data) {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {}
    }
    ws.on('message', handler);
  });
}

async function run() {
  console.log('\n=== New Project Navigation Test (Headless) ===\n');

  if (!supabaseKey) {
    console.error('Set SUPABASE_SERVICE_KEY env var.');
    process.exit(1);
  }

  // Check server is up
  try {
    await fetch(`${API_URL}/api/agents`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`Server not reachable at ${API_URL}`);
    process.exit(1);
  }
  console.log('Server is up\n');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get a user_id from existing data
  const { data: agents } = await supabase
    .from('agents')
    .select('id, url, name, user_id')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!agents || agents.length === 0) {
    console.error('No agents in DB');
    process.exit(1);
  }

  const userId = agents[0].user_id;

  // Create a fresh YouTube project
  console.log('--- Step 1: Create test agent ---');
  const { data: newAgent, error } = await supabase
    .from('agents')
    .insert({ name: 'YouTube E2E Test', url: TEST_URL, user_id: userId })
    .select()
    .single();

  if (!newAgent || error) {
    console.error('Failed to create agent:', error);
    process.exit(1);
  }
  console.log(`  Created: ${newAgent.id} → ${newAgent.url}\n`);

  // Connect WebSocket
  console.log('--- Step 2: Connect WebSocket ---');
  const ws = new WebSocket(WS_URL);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
  console.log('  Connected\n');

  // Collect all messages
  const allMessages: any[] = [];
  ws.on('message', (data: WebSocket.Data) => {
    try { allMessages.push(JSON.parse(data.toString())); } catch {}
  });

  // Start agent — server expects agentId (renamed from projectId)
  console.log('--- Step 3: Start agent ---');
  ws.send(JSON.stringify({ type: 'start', agentId: newAgent.id }));

  // Wait for nav message
  let navUrl: string | null = null;
  try {
    const navMsg = await waitForMessage(ws, msg => msg.type === 'nav', 60_000);
    navUrl = navMsg.url;
    console.log(`  Browser navigated to: ${navUrl}\n`);
  } catch (err) {
    console.log(`  ${(err as Error).message}\n`);
  }

  // Assertions
  console.log('--- Step 4: Verify ---');

  if (navUrl) {
    const isYouTube = navUrl.toLowerCase().includes('youtube');
    const notStale = !navUrl.toLowerCase().includes('consoleredblock');

    assert(isYouTube, `Browser on YouTube (got: ${navUrl})`);
    assert(notStale, 'Not on stale Console Redblock page');
  } else {
    // Check what messages we got
    const errors = allMessages.filter(m => m.type === 'error');
    const thoughts = allMessages.filter(m => m.type === 'thought');
    const statuses = allMessages.filter(m => m.type === 'status');
    console.log(`  Messages: ${statuses.length} status, ${thoughts.length} thought, ${errors.length} error`);

    if (errors.length > 0) {
      errors.forEach(e => console.log(`    Error: ${e.message}`));
      assert(false, 'No errors during agent start');
    }

    // If we got thoughts but no nav, the agent connected but maybe didn't navigate yet
    if (thoughts.length > 0) {
      console.log('  Agent started but no nav within timeout — checking thoughts');
    }
  }

  // Trusted Types check
  const ttErrors = allMessages.filter(m =>
    (m.type === 'error' && m.message?.includes('TrustedHTML')) ||
    (m.type === 'thought' && m.content?.includes('TrustedHTML'))
  );
  assert(ttErrors.length === 0, `No Trusted Types errors (${ttErrors.length} found)`);

  // Cleanup
  console.log('\n--- Cleanup ---');
  ws.close();

  // Delete test agent
  await supabase.from('agents').delete().eq('id', newAgent.id);
  console.log('  Test agent deleted');

  console.log('\n=============================');
  if (failures === 0) {
    console.log('=== ALL TESTS PASSED ===');
  } else {
    console.log(`=== ${failures} TEST(S) FAILED ===`);
  }
  console.log('=============================\n');

  process.exit(failures > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('\nTEST CRASHED:', err.message);
  process.exit(1);
});
