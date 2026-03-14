# Prompt-First Landing Experience Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the post-login project list with a prompt-first home screen where users paste a URL, a project is auto-created, and the agent launches immediately.

**Architecture:** New `Home.tsx` component replaces `ProjectList.tsx` as the default route. URL-to-project-name derivation is a pure utility with tests. Server types updated to make credentials optional. Project list endpoint populated with real findings_count and last_session_at. TestingView gains auto-start via route state. ChatPanel gains contextual tips and inline credential prompts.

**Tech Stack:** React 19, TypeScript, React Router v6, Express, Supabase

---

## Chunk 1: Server Changes, Utility, Home Component, Routing

### Task 1: Make credentials optional in CreateProjectRequest

**Files:**
- Modify: `browser-agent-chat/server/src/types.ts:215-220`

- [ ] **Step 1: Update the type**

In `browser-agent-chat/server/src/types.ts`, change `CreateProjectRequest`:

```typescript
// Before (line 218)
  credentials: PlaintextCredentials;

// After
  credentials?: PlaintextCredentials;
```

The `POST /api/projects` handler in `routes/projects.ts:47` already handles missing credentials: `const encrypted = body.credentials ? encryptCredentials(body.credentials) : null;` — no handler change needed.

- [ ] **Step 2: Verify server builds**

Run: `cd browser-agent-chat && npm run build --workspace=server`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/server/src/types.ts
git commit -m "feat: make credentials optional in CreateProjectRequest"
```

---

### Task 2: Populate findings_count and last_session_at in project list

**Files:**
- Modify: `browser-agent-chat/server/src/routes/projects.ts:20-35`
- Modify: `browser-agent-chat/server/src/db.ts` (add helper functions)

- [ ] **Step 1: Add helper function to db.ts**

Add a batch function at the end of the Projects section in `browser-agent-chat/server/src/db.ts` that fetches findings counts and last session timestamps for all given project IDs in two queries (instead of 2N):

```typescript
export async function getProjectListStats(projectIds: string[]): Promise<Map<string, { findingsCount: number; lastSessionAt: string | null }>> {
  const result = new Map<string, { findingsCount: number; lastSessionAt: string | null }>();
  projectIds.forEach(id => result.set(id, { findingsCount: 0, lastSessionAt: null }));

  if (!isSupabaseEnabled() || projectIds.length === 0) return result;

  // Fetch findings counts (parallel queries — Supabase JS doesn't support GROUP BY natively)
  await Promise.all(projectIds.map(async id => {
    const { count } = await supabase!
      .from('findings')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', id)
      .neq('status', 'dismissed');
    const entry = result.get(id);
    if (entry) entry.findingsCount = count ?? 0;
  }));

  // Fetch last session timestamps (single query for all projects)
  const { data: sessionData } = await supabase!
    .from('sessions')
    .select('project_id, started_at')
    .in('project_id', projectIds)
    .order('started_at', { ascending: false });
  if (sessionData) {
    for (const row of sessionData) {
      const entry = result.get(row.project_id);
      // First row per project_id is the most recent (ordered desc)
      if (entry && entry.lastSessionAt === null) {
        entry.lastSessionAt = row.started_at;
      }
    }
  }

  return result;
}
```

- [ ] **Step 2: Update the project list endpoint**

In `browser-agent-chat/server/src/routes/projects.ts`, update the GET `/` handler. Add import for the new function and replace the hardcoded values:

```typescript
// Add to imports from '../db.js' (line 4-6):
import {
  createProject, getProject, listProjects, updateProject, deleteProject,
  getProjectListStats,
} from '../db.js';
```

Replace lines 23-33 (the `items` mapping):

```typescript
  const projectIds = projects.map(p => p.id);
  const stats = await getProjectListStats(projectIds);

  const items: ProjectListItem[] = projects.map(p => {
    const s = stats.get(p.id);
    return {
      id: p.id,
      name: p.name,
      url: p.url,
      hasCredentials: p.credentials !== null,
      context: p.context,
      created_at: p.created_at,
      updated_at: p.updated_at,
      findings_count: s?.findingsCount ?? 0,
      last_session_at: s?.lastSessionAt ?? null,
    };
  });
```

- [ ] **Step 3: Verify server builds**

Run: `cd browser-agent-chat && npm run build --workspace=server`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/server/src/db.ts browser-agent-chat/server/src/routes/projects.ts
git commit -m "feat: populate findings_count and last_session_at in project list"
```

---

### Task 3: Add project name derivation utility with tests

**Files:**
- Create: `browser-agent-chat/client/src/lib/url-utils.ts`
- Create: `browser-agent-chat/client/src/lib/__tests__/url-utils.test.ts`

- [ ] **Step 0: Install vitest in client workspace**

The client workspace does not have vitest configured. Install it and add a test script:

```bash
cd browser-agent-chat && npm install -D vitest --workspace=client
```

Then add to `browser-agent-chat/client/package.json` in the `"scripts"` section:

```json
"test": "vitest run"
```

Run: `cd browser-agent-chat/client && npx vitest --version`
Expected: Prints vitest version (e.g., `vitest/3.x.x`).

- [ ] **Step 1: Write the failing tests**

Create `browser-agent-chat/client/src/lib/__tests__/url-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveProjectName } from '../url-utils';

describe('deriveProjectName', () => {
  it('extracts domain name from full URL', () => {
    expect(deriveProjectName('https://app.acme.com/dashboard')).toBe('Acme');
  });

  it('strips www prefix', () => {
    expect(deriveProjectName('https://www.acme.com')).toBe('Acme');
  });

  it('strips common prefixes: app, dashboard, staging, dev', () => {
    expect(deriveProjectName('https://dashboard.stripe.com')).toBe('Stripe');
    expect(deriveProjectName('https://staging.myapp.io')).toBe('Myapp');
    expect(deriveProjectName('https://dev.product.co')).toBe('Product');
  });

  it('handles URLs without protocol', () => {
    expect(deriveProjectName('acme.com')).toBe('Acme');
  });

  it('handles localhost with port', () => {
    expect(deriveProjectName('http://localhost:3000')).toBe('Localhost 3000');
  });

  it('handles IP addresses', () => {
    expect(deriveProjectName('http://192.168.1.1:8080')).toBe('192.168.1.1 8080');
  });

  it('capitalizes the first letter', () => {
    expect(deriveProjectName('https://myapp.com')).toBe('Myapp');
  });

  it('handles single-word domains', () => {
    expect(deriveProjectName('https://example.com')).toBe('Example');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd browser-agent-chat/client && npx vitest run src/lib/__tests__/url-utils.test.ts`
Expected: FAIL — module `../url-utils` not found.

- [ ] **Step 3: Implement deriveProjectName**

Create `browser-agent-chat/client/src/lib/url-utils.ts`:

```typescript
const STRIP_PREFIXES = ['www', 'app', 'dashboard', 'staging', 'dev', 'admin', 'portal'];

export function deriveProjectName(rawUrl: string): string {
  // Add protocol if missing so URL constructor works
  let urlStr = rawUrl.trim();
  if (!/^https?:\/\//i.test(urlStr)) {
    urlStr = `https://${urlStr}`;
  }

  let hostname: string;
  let port = '';
  try {
    const parsed = new URL(urlStr);
    hostname = parsed.hostname;
    port = parsed.port;
  } catch {
    return rawUrl.trim();
  }

  // Handle localhost and IP addresses
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const base = hostname.charAt(0).toUpperCase() + hostname.slice(1);
    return port ? `${base} ${port}` : base;
  }

  // Split hostname into parts and strip common prefixes
  const parts = hostname.split('.');
  while (parts.length > 2 && STRIP_PREFIXES.includes(parts[0])) {
    parts.shift();
  }

  // Take the first remaining part (domain name without TLD)
  const name = parts.length >= 2 ? parts[0] : parts[parts.length - 1];

  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd browser-agent-chat/client && npx vitest run src/lib/__tests__/url-utils.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/client/src/lib/url-utils.ts browser-agent-chat/client/src/lib/__tests__/url-utils.test.ts
git commit -m "feat: add deriveProjectName utility with tests"
```

---

### Task 4: Create Home.tsx component

**Files:**
- Create: `browser-agent-chat/client/src/components/Home.tsx`

- [ ] **Step 1: Create the Home component**

Create `browser-agent-chat/client/src/components/Home.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { apiAuthFetch } from '../lib/api';
import { deriveProjectName } from '../lib/url-utils';
import { Sun, Moon, LogOut } from 'lucide-react';
import type { ProjectListItem } from '../types';

export default function Home() {
  const [url, setUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const navigate = useNavigate();
  const { user, getAccessToken, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      const res = await apiAuthFetch('/api/projects', token);
      if (res.ok) {
        const data = await res.json();
        const sorted = (data.projects as ProjectListItem[]).sort((a, b) => {
          const aTime = a.last_session_at ?? a.created_at;
          const bTime = b.last_session_at ?? b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        setProjects(sorted);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);

    // Normalize URL: prepend https:// if no protocol
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      const token = await getAccessToken();
      const name = deriveProjectName(normalizedUrl);
      const res = await apiAuthFetch('/api/projects', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: normalizedUrl }),
      });

      if (res.ok) {
        const project = await res.json();
        navigate(`/projects/${project.id}/testing`, { state: { autoStart: true } });
      } else {
        setError('Failed to create project. Please try again.');
        setIsCreating(false);
      }
    } catch {
      setError('Network error. Please check your connection.');
      setIsCreating(false);
    }
  };

  const timeAgo = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const avatarUrl = user?.user_metadata?.avatar_url;
  const displayProjects = showAll ? projects : projects.slice(0, 5);

  return (
    <div className="home-page">
      {/* Top bar */}
      <div className="home-topbar">
        <div className="home-logo">
          <span className="home-logo-accent">QA</span>
          <span className="home-logo-text">Agent</span>
        </div>
        <div className="home-topbar-right">
          <button className="home-theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="home-avatar-wrapper">
            <button className="home-avatar" onClick={() => setShowMenu(prev => !prev)}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile" />
              ) : (
                <span className="home-avatar-fallback">{user?.email?.charAt(0).toUpperCase()}</span>
              )}
            </button>
            {showMenu && (
              <div className="home-dropdown">
                <button onClick={signOut}><LogOut size={14} /> Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Center content */}
      <div className="home-center">
        <h1 className="home-headline">What do you want to test?</h1>

        <form className="home-url-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="home-url-input"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Paste your app URL..."
            disabled={isCreating}
            required
          />
          <button type="submit" className="home-url-go" disabled={isCreating || !url.trim()}>
            {isCreating ? (
              <span className="home-spinner" />
            ) : (
              '→'
            )}
          </button>
        </form>

        {isCreating && (
          <p className="home-status-text">Creating project &amp; launching agent...</p>
        )}

        {error && (
          <p className="home-error-text">{error}</p>
        )}

        {!isCreating && (
          <>
            <div className="home-chips">
              <span className="home-chip">Explore &amp; learn features</span>
              <span className="home-chip">Test a specific flow</span>
              <span className="home-chip">Find bugs</span>
            </div>

            {projects.length === 0 && (
              <p className="home-hint">Paste any web app URL to get started</p>
            )}
          </>
        )}
      </div>

      {/* Recent Projects */}
      {projects.length > 0 && (
        <div className="home-projects">
          <div className="home-projects-header">
            <span className="home-projects-label">Recent Projects</span>
            {projects.length > 5 && (
              <button className="home-projects-viewall" onClick={() => setShowAll(prev => !prev)}>
                {showAll ? 'Show less' : 'View all →'}
              </button>
            )}
          </div>
          <div className={`home-projects-grid${showAll ? ' home-projects-grid--expanded' : ''}`}>
            {displayProjects.map(p => (
              <button key={p.id} className="home-project-card" onClick={() => navigate(`/projects/${p.id}/testing`)}>
                <div className="home-project-name">{p.name}</div>
                <div className="home-project-url">{p.url}</div>
                <div className="home-project-meta">
                  {p.findings_count > 0 ? (
                    <span className="home-project-badge home-project-badge--bugs">{p.findings_count} bugs</span>
                  ) : (
                    <span className="home-project-badge home-project-badge--clean">clean</span>
                  )}
                  {p.last_session_at && <span className="home-project-time">{timeAgo(p.last_session_at)}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify client builds**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Build succeeds (Home.tsx is created but not yet wired into routes).

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/client/src/components/Home.tsx
git commit -m "feat: add Home component with prompt-first landing"
```

---

### Task 5: Add Home.css styles

**Files:**
- Create: `browser-agent-chat/client/src/components/Home.css`
- Modify: `browser-agent-chat/client/src/components/Home.tsx` (add import)

- [ ] **Step 1: Create the CSS file**

Create `browser-agent-chat/client/src/components/Home.css`:

```css
.home-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* Top bar */
.home-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 32px;
}

.home-logo {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
}

.home-logo-accent {
  color: var(--accent);
}

.home-logo-text {
  font-weight: 400;
  margin-left: 4px;
}

.home-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.home-theme-toggle {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.home-avatar-wrapper {
  position: relative;
}

.home-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-primary);
  background: var(--bg-secondary);
  cursor: pointer;
  overflow: hidden;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.home-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.home-avatar-fallback {
  font-size: 14px;
  color: var(--text-muted);
  font-weight: 600;
}

.home-dropdown {
  position: absolute;
  top: 40px;
  right: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 4px;
  min-width: 140px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.home-dropdown button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
}

.home-dropdown button:hover {
  background: var(--bg-primary);
}

/* Center content */
.home-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 32px;
  margin-top: -60px; /* offset for visual centering with topbar */
}

.home-headline {
  font-size: 28px;
  font-weight: 600;
  margin-bottom: 24px;
}

.home-url-form {
  display: flex;
  align-items: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  padding: 4px 4px 4px 16px;
  width: 520px;
  max-width: 90%;
  transition: border-color 0.15s;
}

.home-url-form:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(233, 69, 96, 0.1);
}

.home-url-input {
  flex: 1;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 15px;
  outline: none;
  padding: 8px 0;
}

.home-url-input::placeholder {
  color: var(--text-dim);
}

.home-url-go {
  background: var(--accent);
  color: #fff;
  border: none;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.home-url-go:hover:not(:disabled) {
  opacity: 0.9;
}

.home-url-go:disabled {
  opacity: 0.5;
  cursor: default;
}

.home-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: home-spin 0.7s linear infinite;
}

@keyframes home-spin {
  to { transform: rotate(360deg); }
}

.home-status-text {
  margin-top: 12px;
  font-size: 13px;
  color: var(--accent);
  font-weight: 500;
}

.home-error-text {
  margin-top: 12px;
  font-size: 13px;
  color: #e53e3e;
  font-weight: 500;
}

.home-chips {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.home-chip {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.home-hint {
  margin-top: 16px;
  font-size: 13px;
  color: var(--text-dim);
}

/* Recent projects */
.home-projects {
  padding: 0 32px 32px;
}

.home-projects-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.home-projects-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
}

.home-projects-viewall {
  background: none;
  border: none;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  padding: 0;
}

.home-projects-viewall:hover {
  color: var(--text-muted);
}

.home-projects-grid {
  display: flex;
  gap: 12px;
  overflow-x: auto;
}

.home-projects-grid--expanded {
  flex-wrap: wrap;
}

.home-project-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 200px;
  max-width: 240px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s;
}

.home-project-card:hover {
  border-color: var(--accent);
}

.home-project-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.home-project-url {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.home-project-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
}

.home-project-badge--bugs {
  color: var(--accent);
  background: rgba(233, 69, 96, 0.08);
}

.home-project-badge--clean {
  color: #4CAF50;
  background: rgba(76, 175, 80, 0.08);
}

.home-project-time {
  font-size: 10px;
  color: var(--text-dim);
}
```

- [ ] **Step 2: Add CSS import to Home.tsx**

Add at the top of `browser-agent-chat/client/src/components/Home.tsx` (after the existing imports):

```typescript
import './Home.css';
```

- [ ] **Step 3: Verify client builds**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/client/src/components/Home.css browser-agent-chat/client/src/components/Home.tsx
git commit -m "feat: add Home component styles"
```

---

### Task 6: Update routing and redirects

**Files:**
- Modify: `browser-agent-chat/client/src/App.tsx`
- Modify: `browser-agent-chat/client/src/components/Sidebar.tsx:46`
- Modify: `browser-agent-chat/client/src/components/ProjectSettings.tsx:58`

- [ ] **Step 1: Update App.tsx**

Replace the full content of `browser-agent-chat/client/src/App.tsx`:

```typescript
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './components/LoginPage';
import Home from './components/Home';
import TestingView from './components/TestingView';
import FindingsDashboard from './components/FindingsDashboard';
import MemoryViewer from './components/MemoryViewer';
import ProjectSettings from './components/ProjectSettings';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
      <Route path="/projects" element={<Navigate to="/" replace />} />
      <Route path="/projects/:id/testing" element={<ProtectedRoute><TestingView /></ProtectedRoute>} />
      <Route path="/projects/:id/findings" element={<ProtectedRoute><FindingsDashboard /></ProtectedRoute>} />
      <Route path="/projects/:id/memory" element={<ProtectedRoute><MemoryViewer /></ProtectedRoute>} />
      <Route path="/projects/:id/settings" element={<ProtectedRoute><ProjectSettings /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}
```

Changes:
- Import `Home` instead of `ProjectList` and `ProjectSetup`
- `/login` redirects to `/` (was `/projects`)
- `/` renders `Home` (was not defined)
- `/projects` redirects to `/` (was `ProjectList`)
- `/projects/new` removed
- Catch-all redirects to `/` (was `/projects`)

- [ ] **Step 2: Update Sidebar.tsx logo click**

In `browser-agent-chat/client/src/components/Sidebar.tsx`, change line 46:

```typescript
// Before
<button className="sidebar-logo" onClick={() => navigate('/projects')}>

// After
<button className="sidebar-logo" onClick={() => navigate('/')}>
```

- [ ] **Step 3: Update ProjectSettings.tsx after-delete redirect**

In `browser-agent-chat/client/src/components/ProjectSettings.tsx`, change line 58:

```typescript
// Before
navigate('/projects');

// After
navigate('/');
```

- [ ] **Step 4: Verify client builds**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Build succeeds with no unused import warnings for `ProjectList` or `ProjectSetup`.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/client/src/App.tsx browser-agent-chat/client/src/components/Sidebar.tsx browser-agent-chat/client/src/components/ProjectSettings.tsx
git commit -m "feat: update routing to use Home as default, redirect /projects to /"
```

---

### Task 7: Delete ProjectSetup.tsx and ProjectList.tsx

**Files:**
- Delete: `browser-agent-chat/client/src/components/ProjectSetup.tsx`
- Delete: `browser-agent-chat/client/src/components/ProjectList.tsx`

- [ ] **Step 1: Delete both files**

```bash
rm browser-agent-chat/client/src/components/ProjectSetup.tsx
rm browser-agent-chat/client/src/components/ProjectList.tsx
```

- [ ] **Step 2: Verify no remaining imports**

Run: `cd browser-agent-chat && grep -r "ProjectSetup\|ProjectList" client/src/`
Expected: No results. The App.tsx imports were already removed in Task 6.

- [ ] **Step 3: Verify client builds**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -u browser-agent-chat/client/src/components/ProjectSetup.tsx browser-agent-chat/client/src/components/ProjectList.tsx
git commit -m "chore: remove ProjectSetup and ProjectList (replaced by Home)"
```

---

## Chunk 2: Auto-Start, ChatPanel Enhancements

### Task 8: Add auto-start to TestingView via route state

**Files:**
- Modify: `browser-agent-chat/client/src/components/TestingView.tsx`

- [ ] **Step 1: Add auto-start logic**

In `browser-agent-chat/client/src/components/TestingView.tsx`, add `useLocation` and `useNavigate` imports and the auto-start effect:

```typescript
// Update imports (line 2):
import { useParams, useLocation, useNavigate } from 'react-router-dom';
```

Inside the component, after the existing hooks (around line 14), add:

```typescript
  const location = useLocation();
  const navigate = useNavigate();
  const isAutoStart = location.state?.autoStart === true;
```

Modify the **existing** session resume effect (lines 17-21) to skip when `autoStart` is set — this prevents a race condition where both `resumeSession` and `startAgent` fire on the same mount:

```typescript
  // On mount: try to resume an existing session for this project
  // Skip if autoStart — we'll start a fresh agent instead
  useEffect(() => {
    if (id && ws.activeProjectId !== id && !isAutoStart) {
      ws.resumeSession(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
```

Add a new useEffect after the resume effect:

```typescript
  // Auto-start agent when navigating from Home with autoStart flag
  useEffect(() => {
    if (id && isAutoStart) {
      ws.startAgent(id);
      // Clear the state to prevent re-triggering on refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isAutoStart]);
```

- [ ] **Step 2: Verify client builds**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add browser-agent-chat/client/src/components/TestingView.tsx
git commit -m "feat: auto-start agent when navigating from Home with autoStart flag"
```

---

### Task 9: Add contextual tip to ChatPanel

**Files:**
- Modify: `browser-agent-chat/client/src/components/ChatPanel.tsx`

- [ ] **Step 1: Add the tip logic**

In `browser-agent-chat/client/src/components/ChatPanel.tsx`:

Add `useRef` to the React import (line 1 already has it).

Inside the component, add a ref and an effect for the tip (after line 21):

```typescript
  const hasShownTip = useRef(false);
  const prevStatus = useRef<AgentStatus>(status);
  const [tipMessage, setTipMessage] = useState<string | null>(null);

  useEffect(() => {
    if (prevStatus.current === 'working' && status === 'idle' && !hasShownTip.current) {
      setTipMessage("Tip: Try 'Explore this app' or describe a flow to test.");
      hasShownTip.current = true;
    }
    prevStatus.current = status;
  }, [status]);
```

In the message rendering section, after the messages map and before the `messagesEndRef` div (around line 59), add the tip rendering:

```typescript
        {tipMessage && (
          <div className="chat-message chat-message-system chat-tip">
            <p>{tipMessage}</p>
          </div>
        )}
```

- [ ] **Step 2: Add CSS for the tip**

In `browser-agent-chat/client/src/App.css` (or wherever chat styles live), add:

```css
.chat-tip {
  background: rgba(253, 203, 110, 0.1);
  border: 1px solid rgba(253, 203, 110, 0.3);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-muted);
}
```

- [ ] **Step 3: Verify client builds**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add browser-agent-chat/client/src/components/ChatPanel.tsx browser-agent-chat/client/src/App.css
git commit -m "feat: add contextual tip in chat when agent becomes idle"
```

---

### Task 10: Add credential prompt detection to ChatPanel

**Files:**
- Modify: `browser-agent-chat/client/src/components/ChatPanel.tsx`

- [ ] **Step 1: Add credential detection and inline form**

In `browser-agent-chat/client/src/components/ChatPanel.tsx`, add the detection logic and inline form.

Add new props to the interface:

```typescript
interface ChatPanelProps {
  projectId: string;
  messages: ChatMessage[];
  status: AgentStatus;
  currentUrl: string | null;
  hasCredentials: boolean; // new: whether project already has credentials
  onStartAgent: () => void;
  onSendTask: (content: string) => void;
  onStopAgent: () => void;
  onSaveCredentials: (username: string, password: string) => Promise<void>; // new
}
```

Update the destructured props to include the new ones.

Add keyword constants at **module scope** (above the component function, after imports):

```typescript
const LOGIN_KEYWORDS = ['login', 'sign in', 'sign-in', 'log in', 'authentication', 'username and password', 'credentials'];
const INTENT_KEYWORDS = ['need', 'require', 'see', 'found', 'ask', 'provide', 'enter'];
```

Add credential detection state and logic inside the component:

```typescript
  const credentialPromptShown = useRef(false);
  const [showCredForm, setShowCredForm] = useState(false);
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [credPromptMsgId, setCredPromptMsgId] = useState<string | null>(null);

  // Detect login-related thoughts
  useEffect(() => {
    if (credentialPromptShown.current || hasCredentials) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.type !== 'agent') return;
    const lower = lastMsg.content.toLowerCase();
    const hasLogin = LOGIN_KEYWORDS.some(k => lower.includes(k));
    const hasIntent = INTENT_KEYWORDS.some(k => lower.includes(k));
    if (hasLogin && hasIntent) {
      credentialPromptShown.current = true;
      setCredPromptMsgId(lastMsg.id);
    }
  }, [messages, hasCredentials]);

  const handleCredSubmit = async () => {
    if (!credUsername || !credPassword) return;
    setCredSaving(true);
    await onSaveCredentials(credUsername, credPassword);
    setCredSaving(false);
    setShowCredForm(false);
    setCredPromptMsgId(null);
  };

  const handleCredSkip = () => {
    setCredPromptMsgId(null);
  };
```

In the message rendering section, after each message, conditionally render the credential prompt:

```typescript
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message chat-message-${msg.type}`}>
            {msg.type === 'finding' && msg.finding ? (
              <FindingAlert finding={msg.finding} />
            ) : (
              <p>{msg.content}</p>
            )}
            {msg.id === credPromptMsgId && !showCredForm && (
              <div className="chat-cred-prompt">
                <button className="btn-primary btn-sm" onClick={() => setShowCredForm(true)}>Add credentials</button>
                <button className="btn-secondary btn-sm" onClick={handleCredSkip}>Skip</button>
              </div>
            )}
            {msg.id === credPromptMsgId && showCredForm && (
              <div className="chat-cred-form">
                <input type="text" placeholder="Username / email" value={credUsername} onChange={e => setCredUsername(e.target.value)} />
                <input type="password" placeholder="Password" value={credPassword} onChange={e => setCredPassword(e.target.value)} />
                <button className="btn-primary btn-sm" onClick={handleCredSubmit} disabled={credSaving || !credUsername || !credPassword}>
                  {credSaving ? 'Saving...' : 'Save & Login'}
                </button>
              </div>
            )}
          </div>
        ))}
```

- [ ] **Step 2: Add CSS for credential prompt**

Add to `browser-agent-chat/client/src/App.css`:

```css
.chat-cred-prompt {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.chat-cred-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

.chat-cred-form input {
  padding: 6px 10px;
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
}
```

- [ ] **Step 3: Update TestingView.tsx to pass new props**

In `browser-agent-chat/client/src/components/TestingView.tsx`, update the ChatPanel usage to pass `hasCredentials` and `onSaveCredentials`:

Add state and a handler for credentials:

```typescript
  const [hasCredentials, setHasCredentials] = useState(false);

  // Check if project has credentials (add inside the existing features useEffect or a separate one)
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await apiAuthFetch(`/api/projects/${id}`, token);
        if (res.ok) {
          const project = await res.json();
          setHasCredentials(project.hasCredentials);
        }
      } catch { /* ignore */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSaveCredentials = async (username: string, password: string) => {
    const token = await getAccessToken();
    await apiAuthFetch(`/api/projects/${id}`, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: { username, password } }),
    });
    setHasCredentials(true);
  };
```

Update the ChatPanel JSX to include the new props:

```typescript
        <ChatPanel
          projectId={id!}
          messages={ws.messages}
          status={ws.status}
          currentUrl={ws.currentUrl}
          hasCredentials={hasCredentials}
          onStartAgent={() => ws.startAgent(id!)}
          onSendTask={ws.sendTask}
          onStopAgent={ws.stopAgent}
          onSaveCredentials={handleSaveCredentials}
        />
```

- [ ] **Step 4: Verify client builds**

Run: `cd browser-agent-chat && npm run build --workspace=client`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add browser-agent-chat/client/src/components/ChatPanel.tsx browser-agent-chat/client/src/components/TestingView.tsx browser-agent-chat/client/src/App.css
git commit -m "feat: add credential detection and inline login form in ChatPanel"
```

---

### Task 11: Final build and test verification

- [ ] **Step 1: Verify both client and server build**

Run: `cd browser-agent-chat && npm run build`
Expected: Both workspaces build successfully.

- [ ] **Step 2: Run all tests**

Run: `cd browser-agent-chat && npm test --workspace=server && cd client && npx vitest run`
Expected: All tests pass.
