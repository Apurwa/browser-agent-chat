# Prompt-First Landing Experience

## Goal

Replace the post-login experience with a prompt-first home screen. Instead of landing on a project list with an empty state, users land on a single URL input — "What do you want to test?" — that creates a project and launches the agent in one action. Time from login to seeing the agent work: under 10 seconds.

## Constraints

- Post-login only — the login page (OAuth) is unchanged.
- Light and dark theme support — the home screen respects the existing theme system.
- No onboarding wizard, tutorial slides, or feature tours. The agent teaches the product by working.
- No new dependencies or backend services.
- No new database tables or columns.

## Home Screen

After login, every user lands on `/` — the Home screen. This replaces the current `ProjectList` page.

### Layout

- Full viewport, vertically centered content
- Top bar: logo (left), theme toggle + user profile (right). The profile shows the user's GitHub/Google avatar image (from Supabase auth `user.user_metadata.avatar_url`). Clicking the avatar opens a small dropdown with "Sign out". This is a simple inline element in `Home.tsx`, not a separate component.
- No sidebar on this screen — sidebar appears only within a project context

### Content (top to bottom)

1. **Headline:** "What do you want to test?" — large, clean, centered
2. **URL input:** Wide input field (`type="url"`) with placeholder "Paste your app URL..." and an accent-colored go button (arrow icon). Styled like a search bar. This is the primary CTA. Client-side validation: non-empty and basic URL format (the input's native `type="url"` validation is sufficient). Unreachable URLs are fine — the agent will report what it sees.
3. **Quick-action chips:** Row of pill-shaped labels below the input — "Explore & learn features", "Test a specific flow", "Find bugs". These are informational, not interactive — they hint at what the agent can do. Styled as subtle bordered pills.
4. **Recent Projects section** (only if user has projects):
   - Label: "Recent Projects" (left) + "View all →" link (right)
   - Horizontal row of compact project cards (max 4-5 visible)
   - Each card shows: project name, URL, findings count badge (e.g., "3 bugs" in red, or "clean" in green if zero), recency relative time (e.g., "2h ago")
   - Clicking a card navigates to `/projects/:id/testing`
   - If no projects exist, this section does not render — no empty state messaging needed
   - "View all →" expands the section in-place to show all projects in a scrollable grid below the URL input. No separate route.

### First-Time Users

New users with no projects see the same screen minus the Recent Projects section. Below the quick-action chips, a single muted line: "Paste any web app URL to get started." The URL input IS the onboarding.

### Duplicate URLs

If a user pastes a URL that matches an existing project, a new project is created (duplicates allowed). The user can delete duplicates from Settings. No dedup logic — keep it simple.

## Quick-Start Flow

When the user pastes a URL and submits:

### Step 1: Instant Feedback (0s)

- URL input border highlights (accent color)
- Go button shows a spinner
- Status text appears below: "Creating project & launching agent..."
- System creates a project in the background:
  - **Name:** auto-derived from the URL domain (e.g., `https://app.acme.com/dashboard` → "Acme")
  - **URL:** as entered
  - **Credentials:** omitted from request body (field is now optional)
  - **Context:** omitted from request body

### Step 2: Transition to Testing View (2-4s)

- Home navigates to `/projects/:id/testing` with route state `{ autoStart: true }`
- Full testing layout appears: sidebar + chat panel + browser panel
- TestingView checks for `autoStart` in route state — if true, calls `startAgent(id)` on mount instead of waiting for the user to click "Start Agent"
- Chat shows agent progress: "Loading browser...", "Navigating to app.acme.com..."
- Browser panel shows a loading spinner

### Step 3: Agent Active (5-10s)

- Browser panel shows the live page screenshot
- Chat shows the agent's first observations ("I can see the Acme Dashboard. It has a sidebar with navigation links...")
- Status indicator turns green (idle)
- A contextual tip appears in chat: "Tip: Try 'Explore this app' or describe a flow to test."
- User can immediately type a task or watch the agent

### Project Name Derivation

Extract a readable name from the URL:

1. Parse the hostname: `app.acme.com` → take the domain minus common prefixes (`app.`, `www.`, `dashboard.`, `staging.`, `dev.`)
2. Take the remaining domain label: `acme.com` → `acme`
3. Capitalize: `Acme`
4. If the result is a TLD or empty, use the full hostname: `localhost:3000` → "Localhost 3000"

The user can rename the project later in Settings.

## Deferred Credentials

Credentials are not requested during project creation. They are handled contextually when the agent needs them.

### Flow

1. Agent navigates to the URL
2. Agent detects a login page (this happens naturally through Magnitude's vision — no special detection needed)
3. Agent reports in chat: "I see a login page. Want to provide credentials so I can sign in?"
4. Two options appear as buttons in the chat:
   - **"Add credentials"** — expands an inline form in the chat panel (username + password fields + Save button)
   - **"Skip"** — agent continues exploring publicly accessible pages
5. If credentials are provided:
   - Encrypted and saved to the project (same AES-256-GCM flow as today)
   - Agent logs in and continues
   - On future sessions, agent auto-logs in without asking

### Implementation

The credential prompt is NOT a special message type. The agent naturally reports what it sees ("I see a login page") via its existing thought events. The "Add credentials" and "Skip" buttons are rendered client-side when the chat detects a thought mentioning login-related keywords.

**Detection heuristic:** Match agent thought messages against a keyword list: `login`, `sign in`, `sign-in`, `log in`, `authentication`, `username and password`, `credentials`. The match must be in the context of the agent being blocked or asking — not merely mentioning the word. Use a simple check: the thought must contain at least one keyword AND one of: `need`, `require`, `see`, `found`, `ask`, `provide`, `enter`. This reduces false positives like "the login button works correctly."

**Debounce:** Show the credential prompt at most once per session. Track with a `credentialPromptShown` ref in ChatPanel. If credentials are already saved on the project (check via project data), do not show the prompt at all.

**After failed login:** The agent will naturally report the failure in its thoughts. The credential prompt does not reappear (debounced). The user can update credentials via Settings.

Alternatively, the user can add credentials at any time via Settings, and the agent will use them on the next session start.

## Routing Changes

### New routes

| Route | Component | Notes |
|-------|-----------|-------|
| `/` | `Home` | New component, replaces ProjectList as default |

### Removed routes

| Route | Component | Replacement |
|-------|-----------|-------------|
| `/projects` | `ProjectList` | Redirect to `/` |
| `/projects/new` | `ProjectSetup` | URL input on Home |

### Redirect updates

All existing navigations and redirects to `/projects` must change to `/`:

| Location | Current target | New target |
|----------|---------------|------------|
| `App.tsx` — login route redirect | `/projects` | `/` |
| `App.tsx` — catch-all route | `/projects` | `/` |
| `ProjectSettings.tsx` — after project delete | `/projects` | `/` |
| `Sidebar.tsx` — logo click | `/projects` | `/` |

### Modified routes

| Route | Change |
|-------|--------|
| `/projects/:id/settings` | Absorbs "context" and "credentials" editing previously in ProjectSetup. No structural change needed — ProjectSettings already handles this. |

## Component Changes

### New: `Home.tsx`

Replaces `ProjectList.tsx` as the post-login landing page.

**State:**
- `url` — input value
- `isCreating` — loading state during project creation
- `recentProjects` — fetched on mount from existing `GET /api/projects` (sorted by `last_session_at` descending, limited to 5)
- `showAllProjects` — boolean, toggled by "View all →" click to expand the full list

**On submit:**
1. Validate URL (non-empty, valid format via `type="url"` native validation)
2. Derive project name from URL
3. Call `POST /api/projects` with `{ name, url }` (credentials and context omitted)
4. Navigate to `/projects/:id/testing` with route state `{ autoStart: true }`

### Modified: `App.tsx`

- Default route (`/`) renders `Home` instead of `ProjectList`
- Remove `/projects/new` route
- Add `/projects` route that redirects to `/` (for bookmarks/history)
- Update login route redirect: `/projects` → `/`
- Update catch-all route redirect: `/projects` → `/`

### Modified: `Sidebar.tsx`

- Logo click navigates to `/` instead of `/projects`

### Modified: `TestingView.tsx`

- On mount, check for `location.state?.autoStart`. If true, call `startAgent(id)` immediately instead of waiting for user click. Clear the state after reading it (via `navigate(location.pathname, { replace: true, state: {} })`) to prevent re-triggering on refresh.

### Modified: `ProjectSettings.tsx`

- After project deletion, navigate to `/` instead of `/projects`

### Removed: `ProjectSetup.tsx`

- Project creation logic moves to `Home.tsx`
- Credential and context editing is already in `ProjectSettings.tsx`

### Modified: `ChatPanel.tsx`

- Add contextual tip rendering: track `hasShownTip` via a ref. When `status` changes to `'idle'` and `hasShownTip` is false, inject a system-style tip message: "Tip: Try 'Explore this app' or describe a flow to test." Set `hasShownTip` to true. Reset the ref when the component unmounts (new session).
- Add credential prompt detection: scan incoming agent thought messages using the heuristic described in "Deferred Credentials > Implementation". Track `credentialPromptShown` ref. Render inline "Add credentials" and "Skip" buttons below the matching message. "Add credentials" expands a username + password form inline. "Skip" dismisses the prompt. Both set `credentialPromptShown` to true.

## Server Changes

### Modified: `CreateProjectRequest` type (`types.ts`)

Make `credentials` optional:

```typescript
// Before
credentials: PlaintextCredentials;

// After
credentials?: PlaintextCredentials;
```

The `POST /api/projects` handler in `routes/projects.ts` already handles `null`/`undefined` credentials gracefully (`const encrypted = body.credentials ? encryptCredentials(body.credentials) : null`), so no handler changes are needed.

### Modified: `GET /api/projects` response (`routes/projects.ts`)

The existing endpoint returns `findings_count: 0` and `last_session_at: null` with TODO comments. These need to be populated for the Recent Projects cards to show meaningful data:

- `findings_count` — query `findings` table: `SELECT COUNT(*) FROM findings WHERE project_id = $1 AND status != 'dismissed'`
- `last_session_at` — query `sessions` table: `SELECT MAX(started_at) FROM sessions WHERE project_id = $1`

These are simple subqueries or joins added to the existing project list query. No schema changes needed — the data already exists in `findings` and `sessions` tables.

## What We're NOT Building

- No changes to the login page (OAuth flow unchanged)
- No onboarding wizard, tooltips, or guided tours
- No changes to the testing view internals, findings dashboard, or memory viewer
- No changes to WebSocket protocol or server messages
- No new database tables or columns
- No marketing or landing page (pre-login)
- No "getting started" checklist or progress indicators
- No URL deduplication logic
