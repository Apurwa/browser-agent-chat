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
/projects/new                   → ProjectSetup
/projects/:id/testing           → TestingView (existing, adapted)
/projects/:id/findings          → FindingsDashboard
/projects/:id/memory            → MemoryViewer
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

## Security Considerations
- Credentials encrypted at rest in Supabase (use pgcrypto or application-level encryption)
- All API endpoints require authenticated user
- Projects scoped to user (RLS policies in Supabase)
- OAuth tokens managed by Supabase Auth
- No credentials exposed in client-side code or WebSocket messages
