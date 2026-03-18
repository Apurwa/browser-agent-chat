# Navigation Refactor: Sidebar → Horizontal Tabs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move agent capability nav (Testing/Findings/Memory/Evals/Traces) from sidebar into horizontal tabs at the agent detail level, following the GitHub/Sentry pattern — sidebar = resource browser, tabs = aspects of one resource.

**Architecture:** Create an `AgentDetailLayout` wrapper component that renders a horizontal tab bar + `<Outlet />` for tab content. All `/agents/:id/*` routes nest under this layout route. The sidebar loses the capability section and becomes a pure agent browser with pinned agents support.

**Tech Stack:** React 19, React Router 6 (layout routes + Outlet), CSS custom properties (Delphi theme), Lucide icons

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `client/src/components/AgentDetailLayout.tsx` | Horizontal tab bar + Outlet for agent sub-pages |
| Create | `client/src/components/AgentDetailLayout.css` | Tab bar styling (move existing `.testing-tabs` here, extend) |
| Modify | `client/src/App.tsx` | Nest `/agents/:id/*` routes under AgentDetailLayout |
| Modify | `client/src/components/Sidebar.tsx` | Remove capability items, add scrollable agents section |
| Modify | `client/src/components/TestingView.tsx` | Remove outer tab bar (Chat/App Graph becomes inner toggle) |
| Modify | `client/src/App.css` | Add scrollable agent zone styles, remove `.sidebar-capability` |
| Modify | `client/src/components/AppMap/AppMap.css` | Move `.testing-tabs` to AgentDetailLayout.css |

---

### Task 1: Create AgentDetailLayout with horizontal tabs

**Files:**
- Create: `client/src/components/AgentDetailLayout.tsx`
- Create: `client/src/components/AgentDetailLayout.css`

- [ ] **Step 1: Create AgentDetailLayout component**

```tsx
// client/src/components/AgentDetailLayout.tsx
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useHealth } from '../contexts/HealthContext';
import { useWS } from '../contexts/WebSocketContext';
import {
  FlaskConical, Bug, BrainCircuit, ClipboardCheck, Activity, Settings,
} from 'lucide-react';
import './AgentDetailLayout.css';

interface Tab {
  key: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  badge?: number;
  guard?: boolean;
}

export default function AgentDetailLayout() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { langfuseEnabled } = useHealth();
  const { findingsCount, pendingSuggestionCount } = useWS();

  const tabs: Tab[] = [
    { key: 'testing', label: 'Testing', icon: <FlaskConical size={15} />, path: 'testing' },
    { key: 'findings', label: 'Findings', icon: <Bug size={15} />, path: 'findings', badge: findingsCount > 0 ? findingsCount : undefined },
    { key: 'memory', label: 'Memory', icon: <BrainCircuit size={15} />, path: 'memory', badge: pendingSuggestionCount > 0 ? pendingSuggestionCount : undefined },
    { key: 'evals', label: 'Evals', icon: <ClipboardCheck size={15} />, path: 'evals' },
    ...(langfuseEnabled ? [{ key: 'traces', label: 'Traces', icon: <Activity size={15} />, path: 'traces' }] : []),
    { key: 'settings', label: 'Settings', icon: <Settings size={15} />, path: 'settings' },
  ];

  const activeTab = tabs.find(t => location.pathname.includes(`/${t.path}`))?.key ?? 'testing';

  return (
    <div className="agent-detail">
      <nav className="agent-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`agent-tab${activeTab === tab.key ? ' agent-tab--active' : ''}`}
            onClick={() => navigate(`/agents/${id}/${tab.path}`)}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge != null && <span className="agent-tab-badge">{tab.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="agent-detail-content">
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create AgentDetailLayout CSS**

```css
/* client/src/components/AgentDetailLayout.css */
.agent-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.agent-tabs {
  display: flex;
  gap: 2px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-primary);
  background: var(--bg-primary);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.agent-tabs::-webkit-scrollbar {
  display: none;
}

.agent-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}

.agent-tab:hover {
  color: var(--text-muted);
}

.agent-tab--active {
  color: var(--brand);
  border-bottom-color: var(--brand);
}

.agent-tab-badge {
  font-size: 10px;
  font-weight: 600;
  background: var(--accent-light);
  color: var(--accent);
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
}

.agent-detail-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}
```

- [ ] **Step 3: Verify component renders in isolation**

Create a temporary route to verify the layout renders correctly before wiring routing.

Run: Open browser, confirm tab bar renders with all items.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/AgentDetailLayout.tsx client/src/components/AgentDetailLayout.css
git commit -m "feat: create AgentDetailLayout with horizontal tab bar"
```

---

### Task 2: Wire routing — nest agent routes under AgentDetailLayout

**Files:**
- Modify: `client/src/App.tsx:18-45`

- [ ] **Step 1: Import AgentDetailLayout**

Add import at top of `App.tsx`:
```tsx
import AgentDetailLayout from './components/AgentDetailLayout';
```

- [ ] **Step 2: Nest agent routes under layout route**

Replace the flat `/agents/:id/*` routes with a nested layout:

```tsx
// Before (flat):
<Route path="/agents/:id/testing" element={<TestingView />} />
<Route path="/agents/:id/findings" element={<FindingsDashboard />} />
<Route path="/agents/:id/memory" element={<MemoryViewer />} />
// ...etc

// After (nested under layout):
<Route path="/agents/:id" element={<AgentDetailLayout />}>
  <Route path="testing" element={<TestingView />} />
  <Route path="findings" element={<FindingsDashboard />} />
  <Route path="memory" element={<MemoryViewer />} />
  <Route path="settings" element={<AgentSettings />} />
  <Route path="evals" element={<EvalDashboard />} />
  <Route path="traces" element={<TracesGuard />} />
  <Route index element={<Navigate to="testing" replace />} />
</Route>
```

- [ ] **Step 3: Verify all routes still work**

Navigate to each route manually:
- `/agents/{id}/testing` — ChatPanel + BrowserView
- `/agents/{id}/findings` — FindingsDashboard
- `/agents/{id}/memory` — MemoryViewer
- `/agents/{id}/evals` — EvalDashboard
- `/agents/{id}/traces` — ObservabilityPanel
- `/agents/{id}/settings` — AgentSettings

Expected: Each renders below the tab bar. Active tab highlights correctly.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: nest agent routes under AgentDetailLayout"
```

---

### Task 3: Strip capability items from Sidebar

**Files:**
- Modify: `client/src/components/Sidebar.tsx:207-330`
- Modify: `client/src/App.css` (remove `.sidebar-capability` styles)

- [ ] **Step 1: Remove renderAgentCapabilities capability items**

In `Sidebar.tsx`, remove the capability buttons (Testing, Findings, Memory, Evals, Traces) from `renderAgentCapabilities()`. Keep only the agent header with dropdown switcher:

```tsx
const renderAgentCapabilities = () => (
  <>
    <div className="sidebar-divider" />
    {expanded && <div className="sidebar-section-label">Agent</div>}

    {/* Agent header with dropdown — keep this */}
    <div className="sidebar-agent-header-wrapper" ref={dropdownRef}>
      {/* ... existing dropdown code unchanged ... */}
    </div>

    {/* REMOVED: Testing, Findings, Memory, Evals, Traces buttons */}
  </>
);
```

- [ ] **Step 2: Remove Settings from bottom section when in agent view**

Settings is now a tab, so remove the conditional Settings button from `renderBottomSection()`:

```tsx
const renderBottomSection = () => (
  <>
    <div className="sidebar-spacer" />
    <button className="sidebar-item" onClick={toggleTheme}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      {expanded && <span className="sidebar-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>}
    </button>
  </>
);
```

- [ ] **Step 3: Always show agent list (not just in org view)**

Currently `renderOrgAgentList()` only renders when no agent is selected. Change the render to always show the agent list:

```tsx
// In the return JSX, change:
{isAgentView && renderAgentCapabilities()}
{renderOrgAgentList()}

// The agent header (dropdown) should show when agent is selected,
// and the full agent list shows below it always.
```

- [ ] **Step 4: Make agent list scrollable**

Add a scrollable wrapper around the agent list to prevent overflow:

In `Sidebar.tsx`, wrap the agents map in a div:
```tsx
<div className="sidebar-agents-scroll">
  {agents.map((agent) => (
    // ... existing agent item code
  ))}
</div>
```

In `App.css`, add:
```css
.sidebar-agents-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

.sidebar-agents-scroll::-webkit-scrollbar {
  width: 4px;
}

.sidebar-agents-scroll::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 2px;
}
```

- [ ] **Step 5: Remove unused `.sidebar-capability` CSS from App.css**

Search for and remove `.sidebar-capability` styles.

- [ ] **Step 6: Verify sidebar renders correctly**

- Collapsed: Logo, toggle, workspace items, agent initials (scrollable), theme toggle
- Expanded: Same but with labels, agent names truncated
- Agent selected: Agent header with dropdown shows above agent list
- No capability items in sidebar

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Sidebar.tsx client/src/App.css
git commit -m "refactor: remove capability nav from sidebar, add scrollable agents"
```

---

### Task 4: Clean up TestingView — remove outer tab bar

**Files:**
- Modify: `client/src/components/TestingView.tsx`
- Modify: `client/src/components/AppMap/AppMap.css:439-464`

- [ ] **Step 1: Keep Chat/App Graph as inner toggle within TestingView**

The Chat/App Graph toggle stays within TestingView — it's a sub-view toggle, not a top-level tab. But the existing `.testing-tabs` styling now conflicts with the new `.agent-tabs`. Rename to `.testing-inner-tabs`:

In `TestingView.tsx`:
```tsx
<div className="testing-inner-tabs">
  <button className={`testing-inner-tab ${activeTab === 'chat' ? 'testing-inner-tab--active' : ''}`} ...>Chat</button>
  <button className={`testing-inner-tab ${activeTab === 'map' ? 'testing-inner-tab--active' : ''}`} ...>App Graph</button>
</div>
```

- [ ] **Step 2: Update CSS class names**

In `AppMap/AppMap.css`, rename:
- `.testing-tabs` → `.testing-inner-tabs`
- `.testing-tab` → `.testing-inner-tab`
- `.testing-tab:hover` → `.testing-inner-tab:hover`
- `.testing-tab--active` → `.testing-inner-tab--active`

- [ ] **Step 3: Verify testing view works**

- Chat tab shows ChatPanel + BrowserView
- App Graph tab shows the graph
- Tab styling looks distinct from the top-level agent tabs

- [ ] **Step 4: Commit**

```bash
git add client/src/components/TestingView.tsx client/src/components/AppMap/AppMap.css
git commit -m "refactor: rename TestingView inner tabs to avoid conflict with agent tabs"
```

---

### Task 5: Visual polish and edge cases

**Files:**
- Modify: `client/src/components/AgentDetailLayout.tsx`
- Modify: `client/src/components/AgentDetailLayout.css`

- [ ] **Step 1: Add agent name breadcrumb above tabs**

```tsx
// In AgentDetailLayout, before the tab bar:
const { agents } = useSidebar();
const currentAgent = agents.find(a => a.id === id);

return (
  <div className="agent-detail">
    <div className="agent-detail-header">
      <span className="agent-detail-name">{currentAgent?.name ?? 'Agent'}</span>
    </div>
    <nav className="agent-tabs">
      {/* tabs */}
    </nav>
    <div className="agent-detail-content">
      <Outlet />
    </div>
  </div>
);
```

- [ ] **Step 2: Style the header**

```css
.agent-detail-header {
  padding: 12px 16px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-detail-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
```

- [ ] **Step 3: Handle missing agent gracefully**

If `id` doesn't match any agent (deleted, wrong URL), show a fallback:

```tsx
if (!id) return <Navigate to="/" replace />;
```

- [ ] **Step 4: Verify full flow end-to-end**

1. Open `/` — see agent list in sidebar and Home page
2. Click an agent — navigate to `/agents/{id}/testing`, tabs visible
3. Click each tab — content switches, active tab highlights
4. Badges show on Findings/Memory tabs when data exists
5. Sidebar agent list stays visible and scrollable during all tab navigation
6. Collapsed sidebar shows agent initials, no overflow
7. Cmd+K still works for agent switching

- [ ] **Step 5: Commit**

```bash
git add client/src/components/AgentDetailLayout.tsx client/src/components/AgentDetailLayout.css
git commit -m "feat: add agent name header, polish tab layout edge cases"
```

---

### Task 6: Final cleanup

**Files:**
- Modify: `client/src/components/Sidebar.tsx` (remove unused imports)
- Modify: `client/src/App.css` (remove dead CSS)

- [ ] **Step 1: Remove unused Lucide imports from Sidebar**

Remove: `FlaskConical`, `Bug`, `BrainCircuit`, `ClipboardCheck`, `Activity` — these are now in AgentDetailLayout.

- [ ] **Step 2: Remove dead sidebar capability CSS**

Search App.css for `.sidebar-capability` and related styles. Remove them.

- [ ] **Step 3: Run build to verify no errors**

```bash
cd browser-agent-chat && npm run build
```

Expected: Clean build, no TypeScript errors.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: remove dead sidebar capability imports and CSS"
```
