# QA Agent v0 — Design Spec

## Overview

Transform the existing browser-agent-chat into a QA Agent platform where users onboard an AI agent to learn their SaaS product, then the agent autonomously tests it — finding visual, functional, data, and UX anomalies. The agent builds persistent memory of features, flows, and expected behaviors per project, like a new QA employee learning the product over time.

## Target Users

QA teams and product owners of SaaS applications who need comprehensive testing across their platform.

## Core Concepts

### Projects
A project represents a single SaaS application under test. It stores the target URL, login credentials (encrypted), user-provided context, and all agent memory. Each user can have multiple projects.

### Agent Memory (Hybrid: Features + Flows)
The agent builds knowledge organized as:
- **Features** — top-level groupings (e.g., Billing, User Management) with criticality ratings and expected behaviors
- **Flows** — user journeys nested within features (e.g., Billing → Upgrade Plan), each with ordered steps, checkpoints, and their own criticality

Memory is built through two mechanisms:
1. **Conversational teaching** — user tells the agent about features, what's critical, what to expect
2. **Guided walkthroughs** — user directs the agent to navigate while explaining what it sees

Memory is editable by the user at any time through the Memory viewer.

### Findings
When the agent detects an anomaly during testing, it creates a finding with:
- Title and description
- Type: visual, functional, data, or UX
- Severity: critical, high, medium, low
- Affected feature and flow
- Steps to reproduce (ordered list of agent actions)
- Expected behavior (from memory) vs. actual behavior
- Screenshot evidence
- Status: new, confirmed, or dismissed

### Testing (Hybrid Approach)
Users provide focus areas or tasks ("test the billing page", "check the upgrade flow"). The agent autonomously explores within that scope, comparing what it finds against its memory of expected behaviors. Anomalies are flagged as findings in real-time.

## Architecture

### System Components

```
Client (React 19 + Vite)
├── Auth Page (OAuth login)
├── Project Setup (create/edit projects)
├── Testing View (chat + live browser)
├── Findings Dashboard (review issues)
├── Memory Viewer (view/edit agent knowledge)
└── Sidebar Navigation

Server (Express + WebSocket)
├── WebSocket Handler (real-time chat, screenshots, findings)
├── Agent Manager (Magnitude agent lifecycle)
├── Memory Engine (build/query agent memory per project)
├── Finding Detector (anomaly detection + evidence capture)
└── REST API (CRUD for projects, findings, memory)

Magnitude (Browser Agent)
├── Playwright Browser
├── Claude Sonnet 4 (vision LLM)
└── Action Execution

Supabase
├── Auth (Google + GitHub OAuth)
├── PostgreSQL (projects, findings, memory, sessions, messages)
└── Storage (screenshot files)
```

### Communication
- **WebSocket** — real-time: chat messages, agent thoughts/actions, screenshots, finding alerts
- **REST API** — CRUD operations: projects, findings, memory features/flows

### Data Model

#### users (Supabase Auth)
Managed by Supabase Auth. Fields: id, email, name, avatar_url.

#### projects
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | FK → users |
| name | text | e.g., "Acme Dashboard" |
| url | text | Target application URL |
| credentials | jsonb | Encrypted login credentials |
| context | text | User-provided product description |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### memory_features
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| project_id | uuid | FK → projects |
| name | text | e.g., "Billing" |
| description | text | What this feature does |
| criticality | text | critical, high, medium, low |
| expected_behaviors | jsonb | Array of behavior descriptions |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### memory_flows
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| feature_id | uuid | FK → memory_features |
| project_id | uuid | FK → projects |
| name | text | e.g., "Upgrade Plan" |
| steps | jsonb | Ordered array of step objects |
| checkpoints | jsonb | Array of validation points |
| criticality | text | critical, high, medium, low |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### sessions
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| project_id | uuid | FK → projects |
| started_at | timestamptz | |
| ended_at | timestamptz | Null if active |
| findings_count | integer | Denormalized count |

#### messages
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| session_id | uuid | FK → sessions |
| role | text | user, agent, system |
| content | text | Message content |
| created_at | timestamptz | |

#### findings
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| project_id | uuid | FK → projects |
| session_id | uuid | FK → sessions |
| title | text | Short description |
| description | text | Detailed explanation |
| type | text | visual, functional, data, ux |
| severity | text | critical, high, medium, low |
| feature | text | Feature name from memory |
| flow | text | Flow name from memory |
| steps_to_reproduce | jsonb | Ordered array of steps |
| expected_behavior | text | What should happen (from memory) |
| actual_behavior | text | What actually happened |
| screenshot_url | text | Supabase Storage URL |
| status | text | new, confirmed, dismissed |
| created_at | timestamptz | |

## Screens

### 1. Login Page (`/login`)
- Clean centered layout on dark background
- Logo ("QA Agent") with tagline
- Two OAuth buttons: "Continue with Google", "Continue with GitHub"
- Supabase Auth handles the OAuth flow
- On success, redirect to project list or last active project

### 2. Project Setup (`/projects/new`)
- Sidebar nav visible but greyed out (no active project yet)
- Centered form with fields:
  - Project name (text input)
  - Application URL (text input)
  - Login email/username + password (side by side)
  - Context (optional textarea — describe the product for the agent)
- "Create Project" button
- Credentials encrypted before storage
- On creation, redirect to Testing view

### 3. Testing View (`/projects/:id/testing`)
- **Left sidebar** — icon nav: Testing (active), Findings (with badge count), Memory, Settings
- **Chat panel** (320px) — project name + status in header, message history (user messages, agent thoughts, actions, inline finding alerts), task input at bottom
- **Browser view** (flex) — browser chrome header with URL bar + working indicator, live screenshot display
- Inline finding alerts appear in chat as red-bordered cards with severity, title, and "View in Findings →" link
- Agent loads project memory on session start to know what to test against

### 4. Findings Dashboard (`/projects/:id/findings`)
- **Left sidebar** — Findings tab active
- **Findings list** (340px) — header with count + filter dropdowns (type, severity, status), scrollable list of finding cards showing severity badge, type badge, title, feature/flow breadcrumb, timestamp
- **Finding detail** (flex) — full detail view of selected finding:
  - Header: severity + type badges, title, feature/flow, timestamp
  - Screenshot section
  - Expected vs. Actual (green/red side-by-side)
  - Steps to reproduce (numbered list)
  - Action buttons: "Confirm Bug", "Dismiss", greyed "Create JIRA Ticket (coming soon)"
- Dismissed findings appear faded with strikethrough in the list

### 5. Memory Viewer (`/projects/:id/memory`)
- **Left sidebar** — Memory tab active
- **Feature list** (280px) — header with count + "Add" button, list showing feature name, criticality badge, flow/behavior counts
- **Feature detail** (flex) — selected feature's full view:
  - Header: feature name, description, criticality badge, edit button
  - Expected Behaviors section: list of behavior items, each with edit icon, "+ Add" button
  - Flows section: expandable flow cards showing name, criticality, step breadcrumbs (visual pills with arrows), bug stats from last session, "last tested" timestamp, edit button
- All items (features, behaviors, flows) are user-editable

## Key Flows

### First-Time User Flow
1. User visits app → Login page
2. OAuth with Google or GitHub
3. No projects exist → redirect to Project Setup
4. User creates project (name, URL, credentials, context)
5. Redirect to Testing view
6. Agent starts, navigates to URL, logs in with stored credentials
7. User begins teaching the agent through conversation

### Teaching/Onboarding Flow
1. User sends message: "This is the billing page, it's critical"
2. Agent creates `memory_features` entry: Billing, criticality=critical
3. User: "The upgrade flow goes: billing → select plan → payment → confirmation"
4. Agent creates `memory_flows` entry under Billing with steps
5. User: "Price should always match the selected plan"
6. Agent adds to `expected_behaviors` on the Billing feature
7. User can also navigate the agent: "Go to billing" → agent navigates, user narrates

### Testing Flow
1. User selects project → agent loads all memory for that project
2. User: "Test the billing upgrade flow"
3. Agent navigates to billing using stored credentials
4. Agent follows the Upgrade Plan flow steps from memory
5. At each step, agent compares what it sees against expected behaviors
6. Anomaly detected → agent creates a finding:
   - Captures screenshot
   - Records steps taken so far
   - Pulls expected behavior from memory
   - Describes actual behavior
   - Assigns type and severity
7. Finding alert appears in chat in real-time
8. Finding saved to database, badge count increments
9. Agent continues testing remaining steps/flows

### Finding Review Flow
1. User navigates to Findings tab (or clicks "View in Findings →" from chat)
2. Sees all findings for the project, filterable by type/severity/status
3. Clicks a finding to see full detail
4. Reviews screenshot, expected vs. actual, steps to reproduce
5. Actions: "Confirm Bug" (status → confirmed) or "Dismiss" (status → dismissed)

## Server Changes

### New REST Endpoints
- `POST /api/auth/callback` — handle OAuth callback (Supabase manages most of this)
- `GET /api/projects` — list user's projects
- `POST /api/projects` — create project
- `GET /api/projects/:id` — get project details
- `PUT /api/projects/:id` — update project
- `GET /api/projects/:id/findings` — list findings (with filters)
- `PUT /api/projects/:id/findings/:findingId` — update finding status
- `GET /api/projects/:id/memory/features` — list features
- `POST /api/projects/:id/memory/features` — create feature
- `PUT /api/projects/:id/memory/features/:featureId` — update feature
- `DELETE /api/projects/:id/memory/features/:featureId` — delete feature
- `GET /api/projects/:id/memory/features/:featureId/flows` — list flows
- `POST /api/projects/:id/memory/features/:featureId/flows` — create flow
- `PUT /api/projects/:id/memory/flows/:flowId` — update flow
- `DELETE /api/projects/:id/memory/flows/:flowId` — delete flow

### WebSocket Message Changes

New client → server messages:
- `{ type: 'start', projectId: string }` — start agent for a project (replaces `url` field)
- `{ type: 'task', content: string }` — unchanged

New server → client messages:
- `{ type: 'finding', finding: Finding }` — new finding detected during testing
- `{ type: 'memoryUpdate', feature?: Feature, flow?: Flow }` — agent learned something new

### Agent Changes
- On session start, load project memory (features, flows, expected behaviors)
- Inject memory context into agent prompts so it knows what to test against
- Memory Engine: parse agent conversation to detect when user is teaching (e.g., "this is critical", "it should always...") and create/update memory entries
- Finding Detector: when agent observes something that contradicts expected behaviors, create a finding with full evidence

## Client Changes

### New Dependencies
- `@supabase/supabase-js` — auth + database queries from client
- `react-router-dom` — routing between pages

### Routing
```
/login                          → LoginPage
/projects                       → ProjectList
/projects/new                   → ProjectSetup
/projects/:id/testing           → TestingView (existing, adapted)
/projects/:id/findings          → FindingsDashboard
/projects/:id/memory            → MemoryViewer
/projects/:id/settings          → ProjectSettings
```

### Component Structure
```
src/
├── components/
│   ├── Sidebar.tsx              # Left icon nav (shared across all views)
│   ├── LoginPage.tsx            # OAuth login (replaces LandingPage)
│   ├── ProjectSetup.tsx         # New project form
│   ├── TestingView.tsx          # Chat + browser (adapted from App.tsx)
│   ├── ChatPanel.tsx            # Chat with inline findings (adapted)
│   ├── BrowserView.tsx          # Live screenshots (mostly unchanged)
│   ├── FindingsDashboard.tsx    # Findings list + detail
│   ├── FindingDetail.tsx        # Single finding full view
│   ├── MemoryViewer.tsx         # Feature list + detail
│   ├── FeatureDetail.tsx        # Feature with behaviors + flows
│   ├── ProjectList.tsx           # Project cards grid
│   ├── ProjectSettings.tsx      # Edit project, update creds, delete
│   └── ProtectedRoute.tsx       # Auth guard wrapper
├── hooks/
│   ├── useWebSocket.ts          # Adapted for project-scoped sessions
│   ├── useAuth.ts               # Supabase auth state
│   └── useProject.ts            # Current project state
├── lib/
│   └── supabase.ts              # Supabase client init
└── types.ts                     # All shared types
```

## Out of Scope (Future)
- JIRA integration (button present but disabled)
- Video replay of test runs
- Business impact scoring
- Multiple team members per project
- CI/CD integration
- Scheduled/automated test runs
- Multiple browser/device testing

## Memory Engine — Implementation Approach

The Memory Engine is not a separate service — it is a prompt-engineering layer that wraps `agent.act()` calls with context, and processes agent responses to extract memory updates.

### How It Works

1. **Context injection:** Before each `agent.act(task)` call, the server constructs a system prompt that includes:
   - All features, flows, and expected behaviors for the current project (serialized as structured text)
   - Instructions telling the agent to compare what it observes against these expectations
   - Instructions to output structured JSON blocks when it detects anomalies or learns new information

2. **Teaching vs. testing mode:** The server does NOT distinguish modes. Every message goes through `agent.act()`. The difference is in the prompt wrapper:
   - If the user says "this is the billing page, it's critical," the agent both navigates AND the server detects teaching-intent keywords in the user message (heuristics: "this is...", "should always...", "is critical", "expected behavior is..."). The server then calls the Memory REST API to create/update entries.
   - If the user says "test billing," the agent navigates and tests. The prompt instructs it to compare observations against loaded memory.
   - Teaching and testing can happen in the same message — "test billing and remember that prices should never be negative."

3. **Memory extraction heuristics:** The server scans both user messages and agent responses for memory-relevant content:
   - User declares a feature → create `memory_features` entry
   - User describes a flow → create `memory_flows` entry
   - User states an expected behavior → add to feature's `expected_behaviors` array
   - User assigns criticality → update the relevant feature/flow
   - Agent confirms it learned something → broadcast `memoryUpdate` via WebSocket

4. **Prompt template (simplified):**
   ```
   You are a QA agent testing a SaaS application. Here is what you know about this product:

   FEATURES:
   - Billing [CRITICAL]: Prices match plan, payment validates fields, invoices generate after payment
     Flows: Upgrade Plan (billing → select → pay → confirm), Cancel Subscription (billing → cancel → confirm)
   - User Management [HIGH]: Invite works, roles enforced, deactivation removes access

   TASK: {user_message}

   As you perform this task:
   1. If you observe anything that contradicts the expected behaviors above, report it as a FINDING in this JSON format: {"finding": {"title": "...", "type": "...", "severity": "...", ...}}
   2. If the user is teaching you about the product (describing features, flows, or expected behaviors), acknowledge what you learned.
   ```

5. **Response parsing:** After `agent.act()` completes (or during `thought` events), the server parses agent output for:
   - JSON finding blocks → create finding in database, broadcast via WebSocket
   - Learning acknowledgments → trigger memory extraction heuristics

## Finding Detector — Implementation Approach

The Finding Detector is LLM-driven, not rule-based. It relies on Claude Sonnet 4's vision capabilities through Magnitude.

### How Anomalies Are Detected

1. **Behavioral comparison:** The agent's prompt includes expected behaviors. When the agent navigates and observes something that contradicts an expectation (e.g., "price should always match plan" but it sees $0.00), the LLM itself identifies the mismatch and reports it.

2. **Visual anomalies:** The agent uses vision (screenshot analysis) to detect:
   - Broken layouts, overlapping elements, missing images
   - The LLM sees the screenshot and compares against what a well-functioning page should look like

3. **Functional anomalies:** When `agent.act("click submit")` succeeds but nothing happens, or an error appears, the agent detects this through vision + DOM state.

4. **Finding creation flow:**
   - Agent detects anomaly → emits structured finding in `thought` event
   - Server parses the `thought` for finding JSON
   - Server calls `connector.getLastScreenshot()` to capture evidence
   - Server uploads screenshot to Supabase Storage, gets URL
   - Server saves finding to `findings` table
   - Server broadcasts `{ type: 'finding', finding }` via WebSocket
   - Chat shows inline finding alert

5. **No pause needed:** Finding creation happens in the `thought` and `actionDone` event handlers (which already exist). The agent continues its `act()` execution uninterrupted. Evidence capture is async and non-blocking.

## Credential Management

### Encryption Strategy
Application-level encryption using AES-256-GCM:

1. **Encryption key:** Server-side environment variable `CREDENTIALS_ENCRYPTION_KEY` (32-byte hex string). Generated once, stored in deployment environment (Render env vars).

2. **Encrypt flow (on project create/update):**
   - Client sends credentials in plaintext over HTTPS
   - Server encrypts with AES-256-GCM using the key + random IV
   - Stores as JSONB: `{ "iv": "hex", "encrypted": "hex", "tag": "hex" }`
   - Plaintext never persisted

3. **Decrypt flow (on agent start):**
   - Server reads project credentials from database
   - Decrypts with the encryption key
   - Passes plaintext credentials to the agent for login
   - Credentials exist in memory only during the agent session

4. **No client-side access:** Credentials are never sent back to the client. The `GET /api/projects/:id` response includes `hasCredentials: boolean` instead of the actual values.

## Database Migration Plan

### Approach: Clean Start
The existing database tables (`sessions`, `messages`, `screenshots`) are from a prototype phase with no production users. The migration strategy is:

1. **Drop existing tables** and create the new schema from scratch
2. No data migration needed — there is no production data to preserve
3. Migration SQL files stored in `server/src/migrations/`

### Migration Order
1. Enable required extensions: `pgcrypto` (for `gen_random_uuid()`)
2. Create `projects` table
3. Create `memory_features` table (FK → projects)
4. Create `memory_flows` table (FK → memory_features, projects)
5. Create `sessions` table (FK → projects) — new schema with `project_id`
6. Create `messages` table (FK → sessions) — `role` column uses: user, agent, thought, action, system (preserves existing granularity)
7. Create `findings` table (FK → projects, sessions)
8. Create RLS policies for all tables
9. Create Supabase Storage bucket for screenshots

### Messages Table — Role Values
To preserve the granularity that the existing codebase uses:
- `user` — user chat messages
- `agent` — agent responses
- `thought` — agent reasoning (displayed differently in chat)
- `action` — agent browser actions (displayed as monospace action items)
- `system` — system messages (errors, status changes)

### Findings — Text vs FK for Feature/Flow
The `feature` and `flow` columns on `findings` are intentionally text (not foreign keys). This preserves historical accuracy — if a feature is renamed or deleted, existing findings retain their original context. Findings are immutable records of what was observed.

## Supabase RLS Policies

```sql
-- Projects: users can only access their own
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own projects"
  ON projects FOR ALL USING (auth.uid() = user_id);

-- Memory features: access through project ownership
ALTER TABLE memory_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD features of own projects"
  ON memory_features FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Memory flows: access through project ownership
ALTER TABLE memory_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD flows of own projects"
  ON memory_flows FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Sessions: access through project ownership
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access sessions of own projects"
  ON sessions FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Messages: access through session → project ownership
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access messages of own sessions"
  ON messages FOR ALL
  USING (session_id IN (
    SELECT s.id FROM sessions s
    JOIN projects p ON s.project_id = p.id
    WHERE p.user_id = auth.uid()
  ));

-- Findings: access through project ownership
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can access findings of own projects"
  ON findings FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
```

## Screenshots Strategy

Two separate screenshot flows coexist:

1. **Live streaming (existing):** During testing, `connector.getLastScreenshot()` returns base64 data. This is broadcast via WebSocket `{ type: 'screenshot', data: base64 }` for the real-time browser view. These are NOT persisted — they are ephemeral display data.

2. **Finding evidence (new):** When a finding is created, the current screenshot is uploaded to Supabase Storage as a PNG file. The returned URL is stored in `findings.screenshot_url`. These ARE persisted for the findings dashboard.

## Error Handling

### Agent Failures
- **Failed login:** If the agent cannot log in with stored credentials, it reports an error via WebSocket `{ type: 'error', message: 'Failed to log in...' }`. The session remains active so the user can provide updated credentials or troubleshoot.
- **Agent crash mid-test:** The `executeTask` try/catch (existing) broadcasts an error and sets status to idle. Findings captured before the crash are preserved. User can send a new task to retry.
- **WebSocket disconnect:** Client auto-reconnects (existing 3-second retry). The agent session continues running on the server. On reconnect, the server sends the current status and latest screenshot to resync. Messages sent during disconnect are lost (acceptable for v0).

### False Positive Findings
- The LLM may flag things that are not actual bugs. This is why the human review step exists — users confirm or dismiss findings. The dismissal rate over time can inform prompt tuning in future versions.

## Additional Screens

### 6. Project List (`/projects`)
- Shown after login if user has existing projects
- Simple card grid showing: project name, URL, last tested timestamp, finding count
- "New Project" button
- Click a project card → navigate to its Testing view

### 7. Settings (`/projects/:id/settings`)
- **Project details:** Edit name, URL, context
- **Credentials:** Update login credentials (shows "Credentials saved" status, never shows actual values)
- **Danger zone:** Delete project (with confirmation dialog)

## API Request/Response Shapes

### Projects
```
POST /api/projects
  Body: { name: string, url: string, credentials: { username: string, password: string }, context?: string }
  Response: { id: string, name: string, url: string, hasCredentials: boolean, context: string, created_at: string }

GET /api/projects
  Response: { projects: [{ id, name, url, hasCredentials, context, created_at, updated_at, findings_count, last_session_at }] }

GET /api/projects/:id
  Response: { id, name, url, hasCredentials, context, created_at, updated_at }
```

### Findings
```
GET /api/projects/:id/findings?type=visual&severity=critical&status=new&limit=50&offset=0
  Response: { findings: Finding[], total: number }

PUT /api/projects/:id/findings/:findingId
  Body: { status: 'confirmed' | 'dismissed' }
  Response: { finding: Finding }
```

### Memory
```
GET /api/projects/:id/memory/features
  Response: { features: Feature[] }  // Each feature includes its flows

POST /api/projects/:id/memory/features
  Body: { name: string, description?: string, criticality: string, expected_behaviors?: string[] }
  Response: { feature: Feature }

PUT /api/projects/:id/memory/features/:featureId
  Body: Partial<{ name, description, criticality, expected_behaviors }>
  Response: { feature: Feature }

POST /api/projects/:id/memory/features/:featureId/flows
  Body: { name: string, steps: Step[], checkpoints?: Checkpoint[], criticality: string }
  Response: { flow: Flow }

PUT /api/projects/:id/memory/flows/:flowId
  Body: Partial<{ name, steps, checkpoints, criticality }>
  Response: { flow: Flow }
```

### Pagination
All list endpoints support `limit` (default 50) and `offset` (default 0) query parameters. Responses include a `total` count for the client to implement pagination or infinite scroll.

## Security Considerations
- Credentials encrypted at rest using AES-256-GCM (see Credential Management section)
- All API endpoints require authenticated user (Supabase JWT in Authorization header)
- Projects scoped to user via RLS policies (see Supabase RLS Policies section)
- OAuth tokens managed by Supabase Auth
- No credentials exposed in client-side code or WebSocket messages
- Existing `ALLOWED_GITHUB_USERS` allowlist mechanism is removed — replaced by proper per-user project isolation via RLS
