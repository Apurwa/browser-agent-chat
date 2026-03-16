# Sidebar Navigation Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the sidebar into a two-state model (org view / agent view) with workspace-level items always visible, and add a Cmd+K command palette for cross-object search.

**Architecture:** Lift `<Sidebar />` from 7 individual page components into a `SidebarLayout` wrapper in `App.tsx` using React Router layout routes. Create a `SidebarDataProvider` context to centralize agent list and sidebar state. Add a `CommandPalette` component for global search.

**Tech Stack:** React 19, React Router v6 (layout routes), TypeScript, CSS custom properties (existing theme system), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-03-16-sidebar-navigation-redesign.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `client/src/components/SidebarLayout.tsx` | Layout wrapper: renders Sidebar + `<Outlet />`, provides sidebar data context |
| `client/src/contexts/SidebarContext.tsx` | Context for agent list, selected agent, sidebar state |
| `client/src/components/CommandPalette.tsx` | Cmd+K overlay: search, results, keyboard navigation |
| `client/src/components/CommandPalette.css` | Styles for command palette overlay |

### Modified Files
| File | Changes |
|------|---------|
| `client/src/App.tsx` | Replace flat routes with `SidebarLayout` wrapper route |
| `client/src/components/Sidebar.tsx` | Two-state model: org view (agent list) vs agent view (capabilities) |
| `client/src/App.css` | New sidebar styles: workspace section, agent list, agent dropdown, section labels |
| `client/src/components/Home.tsx` | Remove top bar (sidebar replaces it), add inline search bar |
| `client/src/components/Home.css` | Remove top bar styles, add search bar styles |
| `client/src/components/TestingView.tsx` | Remove `<Sidebar />` import and `.app-layout` wrapper |
| `client/src/components/FindingsDashboard.tsx` | Remove `<Sidebar />` import and `.app-layout` wrapper |
| `client/src/components/MemoryViewer.tsx` | Remove `<Sidebar />` import and `.app-layout` wrapper |
| `client/src/components/AgentSettings.tsx` | Remove `<Sidebar />` import and `.app-layout` wrapper |
| `client/src/components/EvalDashboard.tsx` | Remove `<Sidebar />` import and `.app-layout` wrapper |
| `client/src/components/ObservabilityPanel.tsx` | Remove `<Sidebar />` import and `.app-layout` wrapper |
| `client/src/components/Vault/VaultPage.tsx` | Remove `<Sidebar />` import and `.app-layout` wrapper |

---

## Chunk 1: SidebarLayout + Context (Phase 1 Foundation)

### Task 1: Create SidebarContext

**Files:**
- Create: `client/src/contexts/SidebarContext.tsx`

- [ ] **Step 1: Create the context with types**

```tsx
// client/src/contexts/SidebarContext.tsx
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import type { AgentListItem } from '../types';

interface SidebarContextValue {
  agents: AgentListItem[];
  agentsLoading: boolean;
  agentsError: string | null;
  refreshAgents: () => Promise<void>;
}

const SidebarContext = createContext<SidebarContextValue>({
  agents: [],
  agentsLoading: true,
  agentsError: null,
  refreshAgents: async () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const { getAccessToken } = useAuth();

  const refreshAgents = useCallback(async () => {
    try {
      setAgentsLoading(true);
      setAgentsError(null);
      const token = await getAccessToken();
      const res = await apiAuthFetch('/api/agents', token);
      if (res.ok) {
        const data = await res.json();
        const sorted = (data.agents as AgentListItem[]).sort((a, b) => {
          const aTime = a.last_session_at ?? a.created_at;
          const bTime = b.last_session_at ?? b.created_at;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
        setAgents(sorted);
      } else {
        setAgentsError('Failed to load agents');
      }
    } catch {
      setAgentsError('Network error loading agents');
    } finally {
      setAgentsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  return (
    <SidebarContext.Provider value={{ agents, agentsLoading, agentsError, refreshAgents }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -20`
Expected: No errors related to SidebarContext

- [ ] **Step 3: Commit**

```bash
git add client/src/contexts/SidebarContext.tsx
git commit -m "feat(sidebar): add SidebarContext for shared agent list"
```

---

### Task 2: Create SidebarLayout wrapper

**Files:**
- Create: `client/src/components/SidebarLayout.tsx`

- [ ] **Step 1: Create the layout component**

```tsx
// client/src/components/SidebarLayout.tsx
import { Outlet } from 'react-router-dom';
import { SidebarProvider } from '../contexts/SidebarContext';
import Sidebar from './Sidebar';

export default function SidebarLayout() {
  return (
    <SidebarProvider>
      <div className="app-layout">
        <Sidebar />
        <Outlet />
      </div>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd browser-agent-chat && npx tsc --noEmit --project client/tsconfig.json 2>&1 | head -20`
Expected: No errors related to SidebarLayout

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SidebarLayout.tsx
git commit -m "feat(sidebar): add SidebarLayout with Outlet wrapper"
```

---

### Task 3: Wire SidebarLayout into App.tsx routes

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Replace flat routes with layout route**

In `App.tsx`, wrap all protected routes (except `/login`) with `SidebarLayout`:

```tsx
import SidebarLayout from './components/SidebarLayout';

// Inside the <Routes>:
<Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
<Route element={<ProtectedRoute><SidebarLayout /></ProtectedRoute>}>
  <Route path="/" element={<Home />} />
  <Route path="/agents/:id/testing" element={<TestingView />} />
  <Route path="/agents/:id/findings" element={<FindingsDashboard />} />
  <Route path="/agents/:id/memory" element={<MemoryViewer />} />
  <Route path="/agents/:id/settings" element={<AgentSettings />} />
  <Route path="/agents/:id/evals" element={<EvalDashboard />} />
  <Route path="/agents/:id/traces" element={<TracesGuard />} />
  <Route path="/vault" element={<VaultPage />} />
  <Route path="/observability" element={<DashboardGuard />} />
</Route>
<Route path="/projects/*" element={<Navigate to={window.location.pathname.replace('/projects/', '/agents/')} replace />} />
<Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
```

Note: The `<ProtectedRoute>` wraps `SidebarLayout` so auth check happens before layout renders.

- [ ] **Step 2: Verify the app loads without errors**

Run: `cd browser-agent-chat && npm run dev:client` and open `http://localhost:5174` — verify the app renders (sidebar will appear on all pages now, but agent pages will temporarily have double sidebars until Task 4).

- [ ] **Step 3: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(sidebar): wire SidebarLayout into App.tsx routes"
```

---

### Task 4: Remove Sidebar from all 7 agent page components

**Files:**
- Modify: `client/src/components/TestingView.tsx`
- Modify: `client/src/components/FindingsDashboard.tsx`
- Modify: `client/src/components/MemoryViewer.tsx`
- Modify: `client/src/components/AgentSettings.tsx`
- Modify: `client/src/components/EvalDashboard.tsx`
- Modify: `client/src/components/ObservabilityPanel.tsx`
- Modify: `client/src/components/Vault/VaultPage.tsx`

- [ ] **Step 1: Remove Sidebar from each component**

For each of the 7 files:
1. Remove `import Sidebar from './Sidebar'` (or `'../Sidebar'` for VaultPage)
2. Remove the `<Sidebar ... />` JSX element
3. Remove the `.app-layout` wrapper div — the component should just return its own content div (e.g., `.testing-content`, `.findings-content`, etc.)
4. If the component passes `findingsCount` or `disabled` props to Sidebar, remove those prop computations if they're only used for Sidebar

Each component should go from:
```tsx
return (
  <div className="app-layout">
    <Sidebar findingsCount={count} />
    <div className="testing-content">...</div>
  </div>
);
```

To:
```tsx
return (
  <div className="testing-content">...</div>
);
```

- [ ] **Step 2: Verify no double sidebar**

Run the dev server, navigate to an agent page. Verify only one sidebar appears (from SidebarLayout).

- [ ] **Step 3: Verify all pages render correctly**

Check each route:
- `/` — Home page with sidebar
- `/agents/:id/testing` — Testing view with sidebar
- `/agents/:id/findings` — Findings with sidebar
- `/agents/:id/memory` — Memory with sidebar
- `/agents/:id/evals` — Evals with sidebar
- `/agents/:id/traces` — Traces with sidebar (if langfuse enabled)
- `/vault` — Vault with sidebar
- `/observability` — Observability with sidebar (if langfuse enabled)

- [ ] **Step 4: Commit**

```bash
git add client/src/components/TestingView.tsx client/src/components/FindingsDashboard.tsx \
  client/src/components/MemoryViewer.tsx client/src/components/AgentSettings.tsx \
  client/src/components/EvalDashboard.tsx client/src/components/ObservabilityPanel.tsx \
  client/src/components/Vault/VaultPage.tsx
git commit -m "refactor(sidebar): remove embedded Sidebar from 7 page components"
```

---

### Task 5: Remove Home.tsx top bar (sidebar replaces it)

**Files:**
- Modify: `client/src/components/Home.tsx`
- Modify: `client/src/components/Home.css`

- [ ] **Step 1: Remove the top bar from Home.tsx**

The home page currently has its own top bar with logo, theme toggle, observability link, and avatar menu. The sidebar now provides navigation, so remove the top bar. Keep the center content (URL form, chips, agent cards).

Remove the entire `{/* Top bar */}` section (the `.home-topbar` div) from Home.tsx. Also remove the associated state and handlers: `showMenu`, `setShowMenu`, `avatarUrl`, the click-outside handler for `showMenu`, and the `signOut` / `toggleTheme` / `navigate('/observability')` calls that were only used in the top bar.

Keep `useAuth()` for `getAccessToken` (needed for agent creation) and `user` (needed for redirect logic if any).

- [ ] **Step 2: Remove top bar CSS from Home.css**

Remove `.home-topbar`, `.home-topbar-right`, `.home-logo`, `.home-logo-accent`, `.home-logo-text`, `.home-theme-toggle`, `.home-avatar-wrapper`, `.home-avatar`, `.home-avatar img`, `.home-avatar-fallback`, `.home-dropdown` styles from Home.css.

- [ ] **Step 3: Verify Home page renders correctly**

The home page should show the URL form + agent cards directly, with the sidebar on the left.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Home.tsx client/src/components/Home.css
git commit -m "refactor(home): remove top bar, sidebar provides navigation"
```

---

## Chunk 2: Two-State Sidebar (Phase 1 Core)

### Task 6: Refactor Sidebar.tsx to two-state model

**Files:**
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/App.css` (sidebar styles section)

- [ ] **Step 1: Rewrite Sidebar.tsx with two states**

The sidebar needs to detect whether an agent is selected (via `useParams().id`) and render differently:

**State 1 (No agent — org view):** Workspace section (Observability, Vault) + Agent list
**State 2 (Agent selected — agent view):** Workspace section + Agent name dropdown + Capabilities

Key implementation details:
- Import `useSidebar` from `SidebarContext` for agent list
- Import `useParams` to detect agent ID
- Import `useWS` for `findingsCount` and `pendingSuggestionCount` (only active in agent view)
- Import `useHealth` for `langfuseEnabled`
- Import `useTheme` for theme toggle
- Import `useNavigate` and `useLocation` for routing

Structure:
```
Logo (always)
─── Workspace section label ───
  Observability item (conditional on langfuseEnabled)
  Vault item
─── divider ───
  IF no agent:
    ─── Agents section label ───
    Agent list (from useSidebar().agents)
  IF agent selected:
    ─── Agent section label ───
    Agent name + dropdown chevron
    Testing | Findings | Memory | Evals | Traces (indented)
─── spacer ───
  Settings (disabled in org view)
  Theme toggle
  Collapse toggle
```

Agent dropdown: when the agent name is clicked, show a dropdown with the agent list for quick switching. Use local state `showAgentDropdown` toggled on click. Dropdown items navigate to `/agents/:newId/testing`.

Remove the `findingsCount` and `disabled` props — the sidebar now reads data from contexts directly.

- [ ] **Step 2: Add new CSS styles to App.css**

Add these new classes to the sidebar section of App.css:

```css
/* Section labels */
.sidebar-section-label {
  padding: 4px 16px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  margin-top: 8px;
}
.sidebar--expanded .sidebar-section-label {
  display: block;
}
.sidebar:not(.sidebar--expanded) .sidebar-section-label {
  display: none;
}

/* Divider */
.sidebar-divider {
  margin: 8px 12px;
  border: none;
  border-top: 1px solid var(--border-primary);
}

/* Agent list items (org view) */
.sidebar-agent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 0.15s, color 0.15s;
}
.sidebar-agent-item:hover {
  background: var(--bg-hover);
  color: var(--text-body);
}
.sidebar-agent-item.active {
  background: var(--bg-hover);
  color: var(--text-body);
  border-left-color: var(--accent);
}
.sidebar-agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sidebar-agent-dot--active { background: var(--brand); }
.sidebar-agent-dot--idle { background: var(--text-dim); }

/* Agent name header (agent view) */
.sidebar-agent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
  cursor: pointer;
}
.sidebar-agent-header:hover {
  background: var(--bg-hover);
}
.sidebar-agent-chevron {
  margin-left: auto;
  opacity: 0.5;
}

/* Agent dropdown */
.sidebar-agent-dropdown {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 200px;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  padding: 4px 0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  z-index: 100;
  max-height: 320px;
  overflow-y: auto;
}
.sidebar-agent-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-body);
  cursor: pointer;
}
.sidebar-agent-dropdown-item:hover {
  background: var(--bg-hover);
}
.sidebar-agent-dropdown-item.current {
  color: var(--accent);
}
.sidebar-agent-dropdown-viewall {
  border-top: 1px solid var(--border-primary);
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  text-align: center;
}
.sidebar-agent-dropdown-viewall:hover {
  color: var(--text-body);
}

/* Capability items (agent view, indented) */
.sidebar-capability {
  padding-left: 24px;
}
.sidebar--expanded .sidebar-capability {
  padding-left: 24px;
}

/* Collapsed state: agent initials */
.sidebar-agent-initial {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-body);
  border: 1.5px solid var(--text-dim);
  cursor: pointer;
}
.sidebar-agent-initial--active {
  border-color: var(--brand);
  color: var(--brand);
}
```

- [ ] **Step 3: Verify both states render correctly**

1. Navigate to `/` — should show org view with agent list
2. Click an agent — should navigate to `/agents/:id/testing` and show agent view with capabilities
3. Click logo — should return to `/` and show org view
4. Toggle collapse — both states should work in collapsed mode
5. Click agent name dropdown — should show agent switcher

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Sidebar.tsx client/src/App.css
git commit -m "feat(sidebar): two-state model with workspace section and agent context"
```

---

## Chunk 3: Command Palette (Phase 2)

### Task 7: Create CommandPalette component

**Files:**
- Create: `client/src/components/CommandPalette.tsx`
- Create: `client/src/components/CommandPalette.css`

- [ ] **Step 1: Create CommandPalette.css**

```css
/* client/src/components/CommandPalette.css */
.cmd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 20vh;
  z-index: 1000;
}

.cmd-dialog {
  width: 560px;
  max-height: 420px;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cmd-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-primary);
}

.cmd-input-row svg {
  color: var(--text-dim);
  flex-shrink: 0;
}

.cmd-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--text-body);
  font-family: inherit;
}

.cmd-input::placeholder {
  color: var(--text-dim);
}

.cmd-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.cmd-group-label {
  padding: 8px 16px 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
}

.cmd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-body);
  cursor: pointer;
}

.cmd-item:hover,
.cmd-item.selected {
  background: var(--bg-hover);
}

.cmd-item-icon {
  color: var(--text-dim);
  flex-shrink: 0;
}

.cmd-item-label {
  flex: 1;
}

.cmd-item-sublabel {
  font-size: 11px;
  color: var(--text-dim);
}

.cmd-item-shortcut {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
}

.cmd-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
}

.cmd-footer {
  border-top: 1px solid var(--border-primary);
  padding: 8px 16px;
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: var(--text-dim);
}

.cmd-footer kbd {
  background: var(--bg-secondary);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: inherit;
}
```

- [ ] **Step 2: Create CommandPalette.tsx**

```tsx
// client/src/components/CommandPalette.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FlaskConical, KeyRound, Activity, Bot } from 'lucide-react';
import { useSidebar } from '../contexts/SidebarContext';
import './CommandPalette.css';

interface CmdItem {
  id: string;
  label: string;
  sublabel?: string;
  route: string;
  icon: 'agent' | 'vault' | 'observability' | 'action';
  group: string;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { agents } = useSidebar();

  // Cmd+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Build items
  const items: CmdItem[] = [];

  // Agents
  for (const a of agents) {
    items.push({
      id: `agent-${a.id}`,
      label: a.name,
      sublabel: a.url,
      route: `/agents/${a.id}/testing`,
      icon: 'agent',
      group: 'Agents',
    });
  }

  // Quick actions
  items.push(
    { id: 'action-vault', label: 'Open Vault', route: '/vault', icon: 'vault', group: 'Quick Actions' },
    { id: 'action-observability', label: 'View Observability', route: '/observability', icon: 'observability', group: 'Quick Actions' },
    { id: 'action-home', label: 'Go Home', route: '/', icon: 'action', group: 'Quick Actions' },
  );

  // Filter
  const lowerQ = query.toLowerCase();
  const filtered = query
    ? items.filter(i => i.label.toLowerCase().includes(lowerQ) || i.sublabel?.toLowerCase().includes(lowerQ))
    : items;

  // Group results
  const groups = new Map<string, CmdItem[]>();
  for (const item of filtered) {
    const group = groups.get(item.group) ?? [];
    group.push(item);
    groups.set(item.group, group);
  }

  const flatFiltered = filtered;

  // Keyboard nav
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatFiltered[selectedIndex]) {
      e.preventDefault();
      navigate(flatFiltered[selectedIndex].route);
      setOpen(false);
    }
  }, [flatFiltered, selectedIndex, navigate]);

  const iconFor = (type: CmdItem['icon']) => {
    switch (type) {
      case 'agent': return <Bot size={16} />;
      case 'vault': return <KeyRound size={16} />;
      case 'observability': return <Activity size={16} />;
      default: return <FlaskConical size={16} />;
    }
  };

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-dialog" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search agents, vault, actions..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="cmd-results">
          {flatFiltered.length === 0 && (
            <div className="cmd-empty">No results for "{query}"</div>
          )}
          {[...groups.entries()].map(([groupName, groupItems]) => (
            <div key={groupName}>
              <div className="cmd-group-label">{groupName}</div>
              {groupItems.map(item => {
                const idx = flatFiltered.indexOf(item);
                return (
                  <div
                    key={item.id}
                    className={`cmd-item${idx === selectedIndex ? ' selected' : ''}`}
                    onClick={() => { navigate(item.route); setOpen(false); }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="cmd-item-icon">{iconFor(item.icon)}</span>
                    <span className="cmd-item-label">{item.label}</span>
                    {item.sublabel && <span className="cmd-item-sublabel">{item.sublabel}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cmd-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Open</span>
          <span><kbd>esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add CommandPalette to SidebarLayout**

In `client/src/components/SidebarLayout.tsx`, add `<CommandPalette />` after `<Outlet />`:

```tsx
import CommandPalette from './CommandPalette';

export default function SidebarLayout() {
  return (
    <SidebarProvider>
      <div className="app-layout">
        <Sidebar />
        <Outlet />
      </div>
      <CommandPalette />
    </SidebarProvider>
  );
}
```

- [ ] **Step 4: Test Cmd+K**

1. Press `Cmd+K` — overlay should appear
2. Type agent name — should filter results
3. Arrow keys — should highlight items
4. Enter — should navigate and close
5. Escape — should close
6. Click outside — should close

- [ ] **Step 5: Commit**

```bash
git add client/src/components/CommandPalette.tsx client/src/components/CommandPalette.css \
  client/src/components/SidebarLayout.tsx
git commit -m "feat: add Cmd+K command palette for global search"
```

---

### Task 8: Add inline search bar to Home page

**Files:**
- Modify: `client/src/components/Home.tsx`
- Modify: `client/src/components/Home.css`

- [ ] **Step 1: Replace agent list fetch with useSidebar**

In Home.tsx, the agent list is currently fetched in a `useEffect`. Replace this with `useSidebar()` context which already fetches and caches the agent list:

```tsx
// Replace the agents useState + useEffect fetch with:
const { agents, refreshAgents } = useSidebar();
```

Remove the `agents` local state and the `useEffect` that fetches `/api/agents`.

- [ ] **Step 2: Add search input above agent cards**

Add a search input at the top of `.home-center` that filters agents locally and also acts as a hint for `Cmd+K`:

```tsx
<div className="home-search-hint" onClick={() => {
  // Trigger Cmd+K programmatically
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
}}>
  <Search size={16} />
  <span>Search agents, traces, evals...</span>
  <kbd>⌘K</kbd>
</div>
```

- [ ] **Step 3: Add Home.css styles for search hint**

```css
.home-search-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 24px;
  transition: border-color 0.15s;
}
.home-search-hint:hover {
  border-color: var(--text-dim);
}
.home-search-hint kbd {
  margin-left: auto;
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
}
```

- [ ] **Step 4: Verify Home page**

Home should show: search hint bar → URL input form → suggestion chips → agent cards. Clicking the search hint should open Cmd+K.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Home.tsx client/src/components/Home.css
git commit -m "feat(home): add search hint bar and use SidebarContext for agents"
```

---

## Chunk 4: Polish & Verify

### Task 9: End-to-end verification

- [ ] **Step 1: Full navigation flow test**

Verify these flows work:
1. Login → Home (sidebar visible with org view, agent list)
2. Click agent in sidebar → agent view (capabilities visible)
3. Navigate Testing → Findings → Memory → Evals → Traces via sidebar
4. Click agent dropdown → switch to different agent
5. Click logo → return to Home (org view)
6. Click Observability in sidebar → observability page
7. Click Vault in sidebar → vault page
8. `Cmd+K` → search for agent → Enter → navigates to agent
9. Collapse sidebar → verify both states work collapsed
10. Refresh page → verify sidebar state persists

- [ ] **Step 2: Fix any issues found**

Address layout, styling, or routing issues.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix(sidebar): polish navigation flows and fix edge cases"
```
