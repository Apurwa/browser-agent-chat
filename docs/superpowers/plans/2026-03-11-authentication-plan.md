# GitHub OAuth Authentication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub OAuth authentication via Supabase Auth so only allowlisted GitHub users can access the app.

**Architecture:** Supabase Auth handles the OAuth flow and session management. The client gets a JWT after GitHub login and passes it on WebSocket connection. The server validates the JWT and checks the GitHub username against an allowlist env var. Sessions are tied to users via `user_id`.

**Tech Stack:** Supabase Auth (`@supabase/supabase-js`), React hooks, Express, ws (WebSocket)

**Spec:** `docs/superpowers/specs/2026-03-11-authentication-design.md`

---

## Chunk 1: Server-Side Auth Infrastructure

### Task 1: Update Supabase client to use service role key

**Files:**
- Modify: `browser-agent-chat/server/src/supabase.ts`

- [ ] **Step 1: Update the Supabase client initialization**

Replace the anon key with the service role key. Keep the anon key as fallback for backwards compat (dev environments without auth).

```typescript
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
```

- [ ] **Step 2: Verify server still starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts without errors (Supabase will be disabled if no env vars set)

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/src/supabase.ts
git commit -m "feat(auth): update supabase client to prefer service role key"
```

---

### Task 2: Add token verification function

**Files:**
- Modify: `browser-agent-chat/server/src/supabase.ts`

- [ ] **Step 1: Add the verifyToken function**

Append to `supabase.ts`:

```typescript
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
```

- [ ] **Step 2: Verify server still starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts without errors

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/src/supabase.ts
git commit -m "feat(auth): add token verification with GitHub allowlist"
```

---

### Task 3: Add user_id to Session interface and database functions

**Files:**
- Modify: `browser-agent-chat/server/src/db.ts`

- [ ] **Step 1: Update the Session interface**

Add `user_id` field:

```typescript
export interface Session {
  id: string;
  url: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  user_id: string | null;
}
```

- [ ] **Step 2: Update createSession to accept user_id**

```typescript
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
```

- [ ] **Step 3: Update listSessions to filter by user_id**

```typescript
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
```

- [ ] **Step 4: Update getSessionHistory to accept userId and verify ownership**

```typescript
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
```

- [ ] **Step 5: Verify server still starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts without errors

- [ ] **Step 6: Commit**

```bash
git add browser-agent-chat/server/src/db.ts
git commit -m "feat(auth): add user_id to session model and queries"
```

---

### Task 4: Update AgentSession type to include user info

**Files:**
- Modify: `browser-agent-chat/server/src/agent.ts`

- [ ] **Step 1: Update the AgentSession interface**

Add `userId` field:

```typescript
export interface AgentSession {
  agent: BrowserAgent;
  connector: BrowserConnector;
  sessionId: string | null;
  userId: string | null;
  close: () => Promise<void>;
}
```

- [ ] **Step 2: Update createAgent to accept and store userId**

Update the function signature and return value:

```typescript
export async function createAgent(
  url: string,
  broadcast: (msg: ServerMessage) => void,
  sessionId: string | null = null,
  userId: string | null = null
): Promise<AgentSession> {
```

Update the return object at the end of the function:

```typescript
  return {
    agent,
    connector,
    sessionId,
    userId,
    close: async () => {
      await agent.stop();
    }
  };
```

- [ ] **Step 3: Verify server still starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts without errors

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/agent.ts
git commit -m "feat(auth): add userId to AgentSession type"
```

---

### Task 5: Add WebSocket authentication to server

**Files:**
- Modify: `browser-agent-chat/server/src/index.ts`

- [ ] **Step 1: Import verifyToken and update imports**

Update the import from supabase.ts:

```typescript
import { isSupabaseEnabled, verifyToken, type AuthenticatedUser } from './supabase.js';
```

- [ ] **Step 2: Add auth to WebSocket connection handler**

Replace the `wss.on('connection', (ws) => {` block opening with authentication logic. The WebSocket upgrade needs to extract and validate the token before allowing messages:

```typescript
wss.on('connection', async (ws, req) => {
  // Extract token from query string
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  let authenticatedUser: AuthenticatedUser | null = null;

  if (token) {
    try {
      authenticatedUser = await verifyToken(token);
      console.log(`Client authenticated: ${authenticatedUser.githubUsername}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      if (message === 'User not in allowlist') {
        ws.close(4003, 'Forbidden: user not in allowlist');
      } else {
        ws.close(4001, 'Unauthorized: invalid token');
      }
      return;
    }
  } else if (process.env.ALLOWED_GITHUB_USERS) {
    // If allowlist is configured but no token provided, reject
    ws.close(4001, 'Unauthorized: token required');
    return;
  }

  console.log('Client connected');
```

- [ ] **Step 3: Update the createSession call to pass userId**

In the `case 'start'` block, update the `createSession` call:

```typescript
            const dbSessionId = await createSession(message.url, authenticatedUser?.id || null);
            const session = await createAgent(message.url, broadcast, dbSessionId, authenticatedUser?.id || null);
```

- [ ] **Step 4: Verify server still starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts without errors. Without `ALLOWED_GITHUB_USERS` env var, unauthenticated connections still work (backwards compat for local dev).

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/index.ts
git commit -m "feat(auth): add WebSocket authentication with token verification"
```

---

### Task 6: Add auth to REST endpoints

**Files:**
- Modify: `browser-agent-chat/server/src/index.ts`

- [ ] **Step 1: Add auth middleware helper**

Add this before the route handlers:

```typescript
async function authenticateRequest(req: express.Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  return verifyToken(token);
}
```

- [ ] **Step 2: Update GET /api/sessions**

```typescript
app.get('/api/sessions', async (req, res) => {
  try {
    let userId: string | undefined;
    if (process.env.ALLOWED_GITHUB_USERS) {
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      userId = user.id;
    }
    const sessions = await listSessions(50, userId);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});
```

- [ ] **Step 3: Update GET /api/sessions/:sessionId (verify session belongs to user)**

```typescript
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    let userId: string | undefined;
    if (process.env.ALLOWED_GITHUB_USERS) {
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      userId = user.id;
    }
    const history = await getSessionHistory(req.params.sessionId, userId);
    if (!history.session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch session history' });
  }
});
```

- [ ] **Step 4: Verify server still starts**

Run: `cd browser-agent-chat && npm run dev:server`
Expected: Server starts. Health endpoint still works without auth.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/server/src/index.ts
git commit -m "feat(auth): add authentication to REST session endpoints"
```

---

## Chunk 2: Client-Side Auth

### Task 7: Install Supabase client dependency

**Files:**
- Modify: `browser-agent-chat/client/package.json`

- [ ] **Step 1: Install @supabase/supabase-js**

```bash
cd browser-agent-chat/client && npm install @supabase/supabase-js
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/package.json browser-agent-chat/package-lock.json
git commit -m "feat(auth): add supabase-js client dependency"
```

---

### Task 8: Create Supabase client lib

**Files:**
- Create: `browser-agent-chat/client/src/lib/supabase.ts`

- [ ] **Step 1: Create the Supabase client file**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Authentication disabled.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isAuthEnabled = (): boolean => supabase !== null;
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/lib/supabase.ts
git commit -m "feat(auth): add client-side supabase initialization"
```

---

### Task 9: Create useAuth hook

**Files:**
- Create: `browser-agent-chat/client/src/hooks/useAuth.ts`

- [ ] **Step 1: Create the auth hook**

```typescript
import { useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isAuthEnabled } from '../lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGitHub = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: 'github' });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  return { user, session, loading, signInWithGitHub, signOut };
}
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/client/src/hooks/useAuth.ts
git commit -m "feat(auth): add useAuth hook for session management"
```

---

### Task 10: Create LoginPage component

**Files:**
- Create: `browser-agent-chat/client/src/components/LoginPage.tsx`
- Create: `browser-agent-chat/client/src/components/LoginPage.css`

- [ ] **Step 1: Create LoginPage.tsx**

```tsx
import './LoginPage.css';

interface LoginPageProps {
  onSignIn: () => Promise<void>;
  accessDenied?: boolean;
  onSignOut?: () => Promise<void>;
}

export function LoginPage({ onSignIn, accessDenied, onSignOut }: LoginPageProps) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/>
            <circle cx="8" cy="8" r="2" fill="currentColor"/>
            <circle cx="16" cy="8" r="2" fill="currentColor"/>
            <path d="M8 14C8 14 10 17 12 17C14 17 16 14 16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="login-title">Browser Agent</h1>

        {accessDenied ? (
          <>
            <p className="login-error">
              Access denied — your GitHub account is not authorized.
            </p>
            {onSignOut && (
              <button className="login-btn secondary" onClick={onSignOut}>
                Sign out and try another account
              </button>
            )}
          </>
        ) : (
          <>
            <p className="login-subtitle">Sign in to start automating</p>
            <button className="login-btn" onClick={onSignIn}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              Sign in with GitHub
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create LoginPage.css**

```css
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0b;
  padding: 1rem;
}

.login-card {
  background: #141416;
  border: 1px solid #2a2a2e;
  border-radius: 12px;
  padding: 2.5rem;
  text-align: center;
  max-width: 380px;
  width: 100%;
}

.login-icon {
  color: #7c5cff;
  margin-bottom: 1rem;
}

.login-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0 0 0.5rem;
}

.login-subtitle {
  color: #888;
  font-size: 0.9rem;
  margin: 0 0 1.5rem;
}

.login-error {
  color: #ff5c5c;
  font-size: 0.9rem;
  margin: 0 0 1.5rem;
}

.login-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  font-size: 0.95rem;
  font-weight: 500;
  color: #fff;
  background: #7c5cff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.login-btn:hover {
  background: #6a4ae0;
}

.login-btn.secondary {
  background: transparent;
  border: 1px solid #2a2a2e;
  color: #888;
}

.login-btn.secondary:hover {
  border-color: #444;
  color: #fafafa;
}
```

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/client/src/components/LoginPage.tsx browser-agent-chat/client/src/components/LoginPage.css
git commit -m "feat(auth): add LoginPage component with GitHub sign-in"
```

---

### Task 11: Update useWebSocket to pass auth token and handle close codes

**Files:**
- Modify: `browser-agent-chat/client/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add token parameter and accessDenied state**

Update the hook to accept a token and expose auth error state:

```typescript
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export function useWebSocket(token?: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
```

- [ ] **Step 2: Update the connect function to pass token**

```typescript
    const connect = () => {
      const wsUrl = token ? `${WS_URL}?token=${token}` : WS_URL;
      const ws = new WebSocket(wsUrl);
```

- [ ] **Step 3: Add a disposed flag to prevent reconnect races, and update onclose to handle auth error codes**

The `useEffect` cleanup and `onclose` reconnect can race when the token changes. Add a `disposed` flag:

```typescript
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const wsUrl = token ? `${WS_URL}?token=${token}` : WS_URL;
      const ws = new WebSocket(wsUrl);
```

Then update the `onclose` handler:

```typescript
      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code);
        setConnected(false);
        setStatus('disconnected');

        if (event.code === 4003) {
          // Forbidden - user not in allowlist
          setAccessDenied(true);
          addMessage('system', 'Access denied — your GitHub account is not authorized');
          return; // Do not reconnect
        }

        if (event.code === 4001) {
          // Token expired or invalid - do not reconnect
          addMessage('system', 'Session expired. Please sign in again.');
          return;
        }

        addMessage('system', 'Disconnected from server');
        // Reconnect after delay (only for non-auth disconnects)
        if (!disposed) {
          setTimeout(connect, 3000);
        }
      };
```

And update the cleanup to set the flag:

```typescript
    return () => {
      disposed = true;
      wsRef.current?.close();
    };
```

- [ ] **Step 4: Add accessDenied to the return value**

```typescript
  return {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    accessDenied,
    startAgent,
    sendTask,
    stopAgent
  };
```

- [ ] **Step 5: Update the useEffect dependency to reconnect when token changes**

```typescript
  }, [addMessage, token]);
```

- [ ] **Step 6: Verify client still builds**

Run: `cd browser-agent-chat/client && npx tsc --noEmit`
Expected: No type errors (or only pre-existing ones)

- [ ] **Step 7: Commit**

```bash
git add browser-agent-chat/client/src/hooks/useWebSocket.ts
git commit -m "feat(auth): pass JWT on WebSocket connect, handle auth close codes"
```

---

### Task 12: Update App.tsx with auth gate and sign-out

**Files:**
- Modify: `browser-agent-chat/client/src/App.tsx`

- [ ] **Step 1: Replace App.tsx with auth-gated version**

```tsx
import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { isAuthEnabled } from './lib/supabase';
import { ChatPanel } from './components/ChatPanel';
import { BrowserView } from './components/BrowserView';
import { LandingPage } from './components/LandingPage';
import { LoginPage } from './components/LoginPage';

function App() {
  const [showApp, setShowApp] = useState(false);
  const { user, session, loading, signInWithGitHub, signOut } = useAuth();

  const {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    accessDenied,
    startAgent,
    sendTask,
    stopAgent
  } = useWebSocket(session?.access_token);

  // Show loading while checking auth state
  if (isAuthEnabled() && loading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p style={{ color: '#888' }}>Loading...</p>
      </div>
    );
  }

  // Auth gate: if auth is enabled and no session, show login
  if (isAuthEnabled() && !session) {
    return <LoginPage onSignIn={signInWithGitHub} />;
  }

  // If authenticated but access denied by server
  if (accessDenied) {
    return <LoginPage onSignIn={signInWithGitHub} accessDenied onSignOut={signOut} />;
  }

  if (!showApp) {
    return <LandingPage onLaunchApp={() => setShowApp(true)} />;
  }

  return (
    <div className="app">
      <div className="app-container">
        <ChatPanel
          messages={messages}
          status={status}
          onSendTask={sendTask}
          onStartAgent={startAgent}
          onStopAgent={stopAgent}
          currentUrl={currentUrl}
        />
        <BrowserView
          screenshot={screenshot}
          currentUrl={currentUrl}
          status={status}
        />
      </div>
      {user && (
        <div className="user-bar">
          <span>{user.user_metadata?.user_name}</span>
          <button onClick={signOut} className="signout-btn">Sign out</button>
        </div>
      )}
      {!connected && (
        <div className="connection-banner">
          Connecting to server...
        </div>
      )}
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Add CSS for user-bar and sign-out button**

Add to the app's main CSS file (e.g. `App.css` or `index.css` — wherever `.app` and `.connection-banner` are styled):

```css
.user-bar {
  position: fixed;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  font-size: 0.8rem;
  color: #888;
  z-index: 100;
}

.signout-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  color: #888;
  background: transparent;
  border: 1px solid #2a2a2e;
  border-radius: 4px;
  cursor: pointer;
}

.signout-btn:hover {
  color: #fafafa;
  border-color: #444;
}
```

- [ ] **Step 3: Verify client still builds**

Run: `cd browser-agent-chat/client && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/client/src/App.tsx browser-agent-chat/client/src/App.css
git commit -m "feat(auth): add auth gate, login redirect, and sign-out to App"
```

---

## Chunk 3: Configuration and Deployment

### Task 13: Update environment configuration

**Files:**
- Modify: `browser-agent-chat/server/.env` (local only, not committed)
- Modify: `render.yaml`

- [ ] **Step 1: Update render.yaml with new env vars**

```yaml
services:
  # Backend API + WebSocket server
  - type: web
    name: browser-agent-server
    runtime: docker
    dockerfilePath: ./browser-agent-chat/server/Dockerfile
    dockerContext: ./browser-agent-chat/server
    plan: starter
    envVars:
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: CORS_ORIGIN
        value: https://browser-agent-client.onrender.com
      - key: NODE_ENV
        value: production
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: ALLOWED_GITHUB_USERS
        sync: false

  # Frontend React app
  - type: web
    name: browser-agent-client
    runtime: static
    buildCommand: cd browser-agent-chat/client && npm install && npm run build
    staticPublishPath: ./browser-agent-chat/client/dist
    envVars:
      - key: VITE_WS_URL
        value: wss://browser-agent-server.onrender.com
      - key: VITE_SUPABASE_URL
        sync: false
      - key: VITE_SUPABASE_ANON_KEY
        sync: false
```

- [ ] **Step 2: Commit**

```bash
git add render.yaml
git commit -m "feat(auth): add auth env vars to render.yaml deployment config"
```

---

### Task 14: Database migration

This is a manual step to run in the Supabase SQL editor.

**Files:**
- Create: `browser-agent-chat/server/migrations/001_add_user_id_to_sessions.sql` (for reference/docs)

- [ ] **Step 1: Create migration file**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add browser-agent-chat/server/migrations/001_add_user_id_to_sessions.sql
git commit -m "feat(auth): add database migration for user_id and RLS"
```

---

### Task 15: Manual setup checklist

No code changes — this documents what needs to be done manually.

- [ ] **Step 1: In Supabase dashboard (Authentication -> Providers -> GitHub):** Enable GitHub provider
- [ ] **Step 2: In GitHub (Settings -> Developer Settings -> OAuth Apps):** Create OAuth App. Set callback URL to `https://<your-project>.supabase.co/auth/v1/callback`
- [ ] **Step 3: Copy Client ID and Client Secret from GitHub into Supabase GitHub provider settings
- [ ] **Step 4: Run the migration SQL** from Task 14 in Supabase SQL Editor
- [ ] **Step 5: Set environment variables locally:**
  - `server/.env`: add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_GITHUB_USERS`
  - `client/.env`: add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- [ ] **Step 6: Test the full flow locally:**
  - Start server and client: `cd browser-agent-chat && npm run dev`
  - Open `http://localhost:5174`
  - Should see LoginPage with "Sign in with GitHub"
  - Click sign in -> GitHub OAuth -> redirect back -> authenticated
  - LandingPage should appear, then chat should work as before
  - WebSocket should connect with token
