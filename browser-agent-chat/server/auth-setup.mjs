#!/usr/bin/env node
/**
 * One-time OAuth setup for magnitude-core's claude-code provider.
 * Saves token to ~/.magnitude/credentials/claudeCode.json
 */
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import readline from 'readline';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CREDS_PATH = join(homedir(), '.magnitude', 'credentials', 'claudeCode.json');

const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

const url = new URL('https://claude.ai/oauth/authorize');
url.searchParams.set('code', 'true');
url.searchParams.set('client_id', CLIENT_ID);
url.searchParams.set('response_type', 'code');
url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback');
url.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
url.searchParams.set('code_challenge', challenge);
url.searchParams.set('code_challenge_method', 'S256');
url.searchParams.set('state', verifier);

console.log('\nOpen this URL in your browser:\n');
console.log(url.toString());
console.log('\nAfter authorizing, paste the code here:');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = await new Promise(resolve => rl.question('> ', resolve));
rl.close();

const [authCode, state] = code.split('#');
const res = await fetch('https://console.anthropic.com/v1/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: authCode, state, grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
    code_verifier: verifier,
  }),
});

if (!res.ok) {
  console.error('Token exchange failed:', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const creds = {
  access_token: data.access_token,
  refresh_token: data.refresh_token,
  expires_at: Date.now() + (data.expires_in * 1000),
};

await fs.mkdir(dirname(CREDS_PATH), { recursive: true });
await fs.writeFile(CREDS_PATH, JSON.stringify(creds, null, 2));
await fs.chmod(CREDS_PATH, 0o600);

console.log(`\nCredentials saved to ${CREDS_PATH}`);
console.log('You can now start the server with: npm run dev:server');
