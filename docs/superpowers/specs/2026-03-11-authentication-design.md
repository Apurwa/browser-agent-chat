# Authentication Design: GitHub OAuth via Supabase Auth

**Date:** 2026-03-11
**Status:** Approved

## Context

Browser Agent Chat is a web-based chat platform where users communicate with an AI browser agent. Currently, the app has zero authentication — anyone can connect, trigger browser automation (consuming Anthropic API credits), and view all session data. Authentication is needed to gate access and tie sessions to users.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth method | GitHub OAuth via Supabase Auth | Already have Supabase in stack; minimal code |
| Target users | Small team (< 10), starting with one | Private tool |
| Access control | Allowlist via env var | Simple, easy to extend |
| Session ownership | Tied to users via `user_id` | Future-proofs for multi-user |
| WebSocket token lifetime | Trusted for connection lifetime, re-validated on reconnect | Simple; acceptable for private tool |

## Auth Flow

```
User visits app
  -> Not logged in? Show LoginPage with "Sign in with GitHub"
  -> Click -> Supabase redirects to GitHub OAuth
  -> GitHub authorizes -> redirects back with tokens
  -> Supabase client stores session (localStorage)
  -> Client extracts JWT access token
  -> Client connects WebSocket: wss://host?token=<jwt>
  -> Server validates JWT via supabase.auth.getUser(token)
  -> Server checks GitHub username against ALLOWED_GITHUB_USERS
  -> Allowed -> WebSocket connection accepted
  -> Not allowed -> Connection rejected (4001/4003)
```

**Note on token in query param:** WebSocket API does not support custom headers, so the token is passed as a query parameter. This is an accepted trade-off for a private tool. Mitigations: always use `wss://` in production (enforced by `VITE_WS_URL`), and the token is short-lived (1 hour default).

## Client-Side Changes

### New dependency

- `@supabase/supabase-js` added to client package.json

### New environment variables

- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase public anon key

### New files

- **`client/src/lib/supabase.ts`** — Initialize Supabase client with env vars
- **`client/src/components/LoginPage.tsx`** — Replaces `LandingPage.tsx` as the entry point for unauthenticated users. Shows "Sign in with GitHub" button, calls `supabase.auth.signInWithOAuth({ provider: 'github' })`. If user is authenticated but not on the allowlist (WebSocket closes with 4003), shows "Access denied — your GitHub account is not authorized" message.
- **`client/src/hooks/useAuth.ts`** — Hook wrapping `supabase.auth.getSession()` and `onAuthStateChange()`. Exposes `{ user, session, loading, signOut }`

### Changes to existing files

- **`App.tsx`** — Auth gate: no session -> LoginPage, authenticated -> current app flow (LandingPage -> ChatPanel -> BrowserView). Add sign-out button to header. Sign-out clears Supabase session and resets WebSocket state.
- **`useWebSocket.ts`** — Pass JWT as query param: `new WebSocket(\`${url}?token=${session.access_token}\`)`. Handle auth-related close codes: on 4001 (unauthenticated) trigger token refresh or redirect to login; on 4003 (unauthorized) stop reconnecting and surface access-denied state. Do not auto-reconnect on auth failures.

### No changes needed

- `ChatPanel.tsx`, `BrowserView.tsx` — work as-is once authenticated

## Server-Side Changes

### New environment variables

- `ALLOWED_GITHUB_USERS` — comma-separated GitHub usernames
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (used server-side to bypass RLS for inserts and to validate tokens)

### Changes to existing files

- **`server/src/supabase.ts`** — Use `SUPABASE_SERVICE_ROLE_KEY` instead of anon key for the server-side Supabase client (required for RLS bypass on inserts). Add `verifyToken(token: string)` function:
  1. Call `supabase.auth.getUser(token)` to validate JWT
  2. Extract GitHub username from `user.user_metadata.user_name`
  3. Check against `ALLOWED_GITHUB_USERS`
  4. Return user object or throw error

- **`server/src/index.ts`** (WebSocket):
  1. Extract `token` from query string on connection
  2. Call `verifyToken(token)` before accepting
  3. Invalid/unauthorized -> close with 4001 (unauthenticated) or 4003 (not in allowlist)
  4. Valid -> attach user to session, proceed

- **`server/src/index.ts`** (REST endpoints):
  - `GET /api/sessions` — require `Authorization: Bearer <token>` header, filter by user
  - `GET /api/sessions/:sessionId` — require auth, verify session belongs to user

- **`server/src/db.ts`** — Update `Session` interface to include `user_id: string | null`. Add `user_id` parameter to `createSession()`. Filter `getSessions()` by `user_id`.

- **`server/src/types.ts`** — Update `AgentSession` type to include authenticated user info.

## Database Schema Changes

### Migration SQL

```sql
-- Add user_id to sessions (nullable for backwards compat)
ALTER TABLE sessions ADD COLUMN user_id text;

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own sessions
CREATE POLICY "users_own_sessions" ON sessions
  FOR ALL USING (user_id = auth.uid()::text);

-- Service role (server) bypasses RLS automatically
```

- **No changes to `messages` or `screenshots`** — linked via `session_id`, isolation is inherited

## Client-Side Error States

| Scenario | What the user sees |
|----------|-------------------|
| Not logged in | LoginPage with "Sign in with GitHub" |
| Authenticated but not on allowlist (4003) | "Access denied — your GitHub account is not authorized" with sign-out option |
| Token expired (4001) | Auto-refresh via Supabase; if refresh fails, redirect to LoginPage |
| Sign out | Clears Supabase session, resets WebSocket, shows LoginPage |
| WebSocket disconnects (non-auth) | Auto-reconnect as before (3s delay) |

## Supabase Dashboard Setup (Manual)

1. Enable GitHub OAuth provider in Supabase dashboard (Authentication -> Providers -> GitHub)
2. Create GitHub OAuth App in GitHub (Settings -> Developer Settings -> OAuth Apps)
3. Set callback URL to Supabase's callback URL (e.g., `https://<project>.supabase.co/auth/v1/callback`)
4. Copy Client ID and Client Secret into Supabase GitHub provider settings
5. Set redirect URL to app URL (`http://localhost:5174` for dev, production URL for prod)

## Deployment Changes (render.yaml)

New environment variables to add:

**Server:**
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (secret, manual setup)
- `ALLOWED_GITHUB_USERS` — comma-separated usernames

**Client:**
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — public anon key

## Security Considerations

- JWT validation happens server-side on every WebSocket connection and REST request
- Allowlist is checked after token validation — valid GitHub users not on the list are rejected
- Supabase handles token refresh automatically on the client for HTTP requests
- WebSocket connections are trusted for their lifetime; re-validated on reconnect (acceptable for private tool with 1-hour JWT expiry)
- RLS policies provide database-level safety net independent of server code
- Server uses service role key to bypass RLS for inserts while RLS protects direct database access
- No secrets exposed to client — only public Supabase URL and anon key
- Always use `wss://` in production for encrypted WebSocket transport
