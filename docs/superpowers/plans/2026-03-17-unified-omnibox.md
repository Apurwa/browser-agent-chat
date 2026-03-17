# Unified Omnibox Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three competing Home page entry points (⌘K search bar, URL input, Recent Agents) with a single intent-aware omnibox that auto-detects URLs vs search queries, shows grouped results with default action preview, and is keyboard-first.

**Architecture:** Extract QUICK_ACTIONS to a shared module. Add an `omniboxActive` ref to SidebarContext. Build the Omnibox as a standalone component with intent detection, grouped results, keyboard navigation. Integrate into Home.tsx replacing the search hint + URL form. Update CommandPalette to respect the omnibox flag.

**Tech Stack:** React 19, TypeScript, CSS custom properties (Delphi Tools theme)

**Spec:** `docs/superpowers/specs/2026-03-17-unified-omnibox-design.md`

---

## File Structure

All paths relative to `browser-agent-chat/`.

### New Files

| File | Responsibility |
|------|---------------|
| `client/src/lib/quick-actions.ts` | Shared QUICK_ACTIONS array + CmdItem type (extracted from CommandPalette) |
| `client/src/components/Omnibox.tsx` | Unified input: intent detection, grouped results, keyboard nav, action preview |

### Modified Files

| File | Changes |
|------|---------|
| `client/src/contexts/SidebarContext.tsx` | Add `omniboxActiveRef` to context |
| `client/src/components/CommandPalette.tsx` | Import QUICK_ACTIONS from shared module; check `omniboxActiveRef` before opening |
| `client/src/components/Home.tsx` | Remove search hint + URL form; render `<Omnibox>`; set omniboxActiveRef |
| `client/src/components/Home.css` | Remove old classes; add `.home-omnibox-*` classes |

---

## Chunk 1: Shared Infrastructure

### Task 1: Extract QUICK_ACTIONS to shared module

**Files:**
- Create: `client/src/lib/quick-actions.ts`
- Modify: `client/src/components/CommandPalette.tsx`

- [ ] **Step 1: Create the shared module**

```ts
// client/src/lib/quick-actions.ts

export interface CmdItem {
  id: string
  label: string
  sublabel?: string
  route: string
  icon: 'agent' | 'vault' | 'observability' | 'action' | 'create'
  group: string
}

export const QUICK_ACTIONS: CmdItem[] = [
  { id: 'qa-vault', label: 'Open Vault', route: '/vault', icon: 'vault', group: 'Quick Actions' },
  { id: 'qa-observability', label: 'View Observability', route: '/observability', icon: 'observability', group: 'Quick Actions' },
  { id: 'qa-home', label: 'Go Home', route: '/', icon: 'action', group: 'Quick Actions' },
]
```

- [ ] **Step 2: Update CommandPalette to import from shared module**

In `client/src/components/CommandPalette.tsx`:
- Remove the local `CmdItem` interface and `QUICK_ACTIONS` constant
- Add: `import { type CmdItem, QUICK_ACTIONS } from '../lib/quick-actions'`
- Keep the `renderIcon` function and everything else unchanged

- [ ] **Step 3: Verify build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/quick-actions.ts client/src/components/CommandPalette.tsx && git commit -m "refactor: extract QUICK_ACTIONS to shared module"
```

---

### Task 2: Add omniboxActive ref to SidebarContext

**Files:**
- Modify: `client/src/contexts/SidebarContext.tsx`
- Modify: `client/src/components/CommandPalette.tsx`

- [ ] **Step 1: Add ref to SidebarContext**

In `client/src/contexts/SidebarContext.tsx`:

Add `useRef` to the React import. Add `omniboxActiveRef` to the context interface and provider:

```ts
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode, MutableRefObject } from 'react';

interface SidebarContextValue {
  agents: AgentListItem[];
  agentsLoading: boolean;
  agentsError: string | null;
  refreshAgents: () => Promise<void>;
  omniboxActiveRef: MutableRefObject<boolean>;
}
```

In `SidebarProvider`, add:
```ts
const omniboxActiveRef = useRef(false);
```

And include it in the provider value:
```ts
<SidebarContext.Provider value={{ agents, agentsLoading, agentsError, refreshAgents, omniboxActiveRef }}>
```

- [ ] **Step 2: Update CommandPalette to check the flag**

In `CommandPalette.tsx`, in the `useSidebar()` destructuring, add `omniboxActiveRef`:
```ts
const { agents, omniboxActiveRef } = useSidebar();
```

In the ⌘K handler (the `useEffect` with `window.addEventListener('keydown')`), add at the top of the handler:
```ts
if (omniboxActiveRef.current) return; // Home page omnibox handles ⌘K
```

- [ ] **Step 3: Verify build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add client/src/contexts/SidebarContext.tsx client/src/components/CommandPalette.tsx && git commit -m "feat: add omniboxActive ref to prevent CommandPalette conflict"
```

---

## Chunk 2: Omnibox Component

### Task 3: Build the Omnibox component

**Files:**
- Create: `client/src/components/Omnibox.tsx`

- [ ] **Step 1: Create the Omnibox component**

Build `Omnibox.tsx` with these sections. Read the existing `Home.tsx` first to understand the current `handleSubmit`, voice input, and plus menu logic — port them into the omnibox.

**Intent detection function:**
```ts
function detectIntent(input: string): 'url' | 'search' {
  const trimmed = input.trim()
  if (!trimmed) return 'search'
  try {
    new URL(trimmed)
    return 'url'
  } catch {
    if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return 'url'
    if (/^localhost(:\d+)?/.test(trimmed)) return 'url'
    return 'search'
  }
}
```

**Props:**
```ts
interface OmniboxProps {
  onCreateAgent: (url: string) => Promise<void>
  isCreating: boolean
  error: string | null
}
```

**Component structure:**
1. Input container (pill shape, 560px max) with:
   - Plus button + dropdown (left) — paste from clipboard, upload file
   - Text input (center) — placeholder "Paste a URL or search anything..."
   - Mic button (right, if voice supported)
   - Submit button (right) — ArrowUp icon, spinner when creating
   - ⌘K badge (right edge)
2. Default action preview line below input
3. Grouped results dropdown below preview (when input non-empty)

**State:**
```ts
const [query, setQuery] = useState('')
const [selectedIndex, setSelectedIndex] = useState(0)
```

**Data sources:**
```ts
import { useSidebar } from '../contexts/SidebarContext'
import { QUICK_ACTIONS, type CmdItem } from '../lib/quick-actions'

const { agents } = useSidebar()
```

**Build agent items from sidebar agents:**
```ts
const agentItems: CmdItem[] = agents.map(a => ({
  id: `agent-${a.id}`,
  label: a.name,
  sublabel: a.url,
  route: `/agents/${a.id}/testing`,
  icon: 'agent' as const,
  group: 'Agents',
}))
```

**Build grouped results based on intent:**
```ts
const intent = detectIntent(query)
const q = query.toLowerCase().trim()

const groups: Array<{ label: string; items: CmdItem[] }> = []

// Create group (only when URL detected)
if (intent === 'url' && q) {
  let domain = q
  try { domain = new URL(q.startsWith('http') ? q : `https://${q}`).hostname } catch {}
  groups.push({
    label: 'Create',
    items: [{ id: 'create-new', label: `Start new agent at ${domain}`, sublabel: q, route: '', icon: 'create', group: 'Create' }],
  })
}

// Agents group
const matchingAgents = q ? agentItems.filter(a =>
  a.label.toLowerCase().includes(q) || (a.sublabel ?? '').toLowerCase().includes(q)
) : agentItems.slice(0, 5)
if (matchingAgents.length > 0 && q) {
  groups.push({ label: 'Agents', items: matchingAgents })
}

// Quick Actions group
const matchingActions = q ? QUICK_ACTIONS.filter(a => a.label.toLowerCase().includes(q)) : []
if (matchingActions.length > 0) {
  groups.push({ label: 'Quick Actions', items: matchingActions })
}

const flatItems = groups.flatMap(g => g.items)
```

**Default action preview:**
```ts
let preview = ''
if (isCreating) {
  preview = 'Creating agent & launching browser...'
} else if (error) {
  preview = error
} else if (q && flatItems.length > 0) {
  const top = flatItems[0]
  if (top.id === 'create-new') {
    preview = `Press Enter to start new agent at ${top.sublabel}`
  } else {
    preview = `Press Enter to open ${top.label}`
  }
} else if (q && flatItems.length === 0) {
  preview = 'No results found'
}
```

**Keyboard handler:**
```ts
const handleKeyDown = (e: React.KeyboardEvent) => {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      setSelectedIndex(prev => (prev + 1) % Math.max(flatItems.length, 1))
      break
    case 'ArrowUp':
      e.preventDefault()
      setSelectedIndex(prev => (prev - 1 + flatItems.length) % Math.max(flatItems.length, 1))
      break
    case 'Enter':
      e.preventDefault()
      if (isCreating) return
      const selected = flatItems[selectedIndex]
      if (selected?.id === 'create-new') {
        onCreateAgent(query.trim())
      } else if (selected) {
        navigate(selected.route)
      }
      break
    case 'Escape':
      e.preventDefault()
      setQuery('')
      setSelectedIndex(0)
      break
  }
}
```

**Render the results dropdown with `role="combobox"` accessibility:**
```tsx
<div className="home-omnibox" role="combobox" aria-expanded={query.length > 0} aria-haspopup="listbox">
  <div className="home-omnibox-input-row">
    {/* plus button, input, mic, submit, ⌘K badge */}
  </div>
  {preview && (
    <div className={`home-omnibox-preview ${error ? 'home-omnibox-preview--error' : ''}`}>
      ↳ {preview}
    </div>
  )}
  {query.trim() && groups.length > 0 && (
    <div className="home-omnibox-results" role="listbox">
      {groups.map(group => (
        <div key={group.label}>
          <div className="home-omnibox-group">{group.label}</div>
          {group.items.map(item => {
            const idx = flatItems.indexOf(item)
            return (
              <div key={item.id}
                   className={`home-omnibox-item ${idx === selectedIndex ? 'home-omnibox-item--selected' : ''}`}
                   role="option" aria-selected={idx === selectedIndex}
                   onClick={() => { /* execute item */ }}
                   onMouseEnter={() => setSelectedIndex(idx)}>
                <span className="home-omnibox-item-icon">{renderIcon(item.icon)}</span>
                <span className="home-omnibox-item-text">
                  <span className="home-omnibox-item-label">{item.label}</span>
                  {item.sublabel && <span className="home-omnibox-item-sublabel">{item.sublabel}</span>}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )}
</div>
```

Import `renderIcon` from CommandPalette or duplicate it (it's 10 lines). Add a `create` case that renders a `Plus` icon.

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Omnibox.tsx && git commit -m "feat: omnibox component with intent detection, grouped results, keyboard nav"
```

---

### Task 4: Integrate Omnibox into Home page

**Files:**
- Modify: `client/src/components/Home.tsx`
- Modify: `client/src/components/Home.css`

- [ ] **Step 1: Update Home.tsx**

Read `Home.tsx`. Make these changes:

1. Import `Omnibox` and `useSidebar`:
```ts
import Omnibox from './Omnibox'
```

2. Set `omniboxActiveRef` on mount/unmount:
```ts
const { omniboxActiveRef } = useSidebar()
useEffect(() => {
  omniboxActiveRef.current = true
  return () => { omniboxActiveRef.current = false }
}, [omniboxActiveRef])
```

3. Add ⌘K handler that focuses the omnibox input (via a ref passed to Omnibox):
```ts
const omniboxInputRef = useRef<HTMLInputElement>(null)
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      omniboxInputRef.current?.focus()
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}, [])
```

4. Remove the `home-search-hint` div entirely (the clickable ⌘K bar)

5. Remove the `home-url-form` and all its contents (plus menu, URL input, mic button, submit button)

6. Replace with:
```tsx
<Omnibox
  inputRef={omniboxInputRef}
  onCreateAgent={handleCreateAgent}
  isCreating={isCreating}
  error={error}
/>
```

7. Extract agent creation into a callback:
```ts
const handleCreateAgent = async (rawUrl: string) => {
  if (!rawUrl || isCreating) return
  setIsCreating(true)
  setError(null)
  let normalizedUrl = rawUrl
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`
  }
  try {
    const token = await getAccessToken()
    const name = deriveProjectName(normalizedUrl)
    const res = await apiAuthFetch('/api/agents', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url: normalizedUrl }),
    })
    if (res.ok) {
      const agent = await res.json()
      refreshAgents()
      navigate(`/agents/${agent.id}/testing`, { state: { autoStart: true } })
    } else {
      setError('Failed to create agent. Please try again.')
      setIsCreating(false)
    }
  } catch {
    setError('Network error. Please check your connection.')
    setIsCreating(false)
  }
}
```

8. Conditionally hide chips and Recent Agents when omnibox has input. Pass a state up from Omnibox or use a local state:
```ts
const [omniboxHasQuery, setOmniboxHasQuery] = useState(false)
```
Pass `onQueryChange={(q) => setOmniboxHasQuery(q.trim().length > 0)}` to Omnibox.

Then wrap chips and Recent Agents:
```tsx
{!omniboxHasQuery && !isCreating && (
  <>
    <div className="home-chips">...</div>
    {agents.length === 0 && <p className="home-hint">...</p>}
  </>
)}

{!omniboxHasQuery && agents.length > 0 && (
  <div className="home-projects">...</div>
)}
```

9. Remove imports that are no longer needed: `Plus`, `ArrowUp`, `Clipboard`, `Upload`, `Search` (if only used by removed elements). Keep `Mic` only if the voice logic stays in Home (it should move to Omnibox).

- [ ] **Step 2: Update Home.css**

Remove these classes (no longer used):
- `.home-search-hint`, `.home-search-hint:hover`, `.home-search-hint kbd`
- `.home-url-form`, `.home-url-form:focus-within`
- `.home-plus-wrapper`, `.home-plus-btn`, `.home-plus-btn:hover`, `.home-plus-dropdown`
- `.home-url-input`, `.home-url-input::placeholder`
- `.home-mic-btn`, `.home-mic-pulse`, `@keyframes homeMicPulse`
- `.home-url-go`, `.home-spinner`, `@keyframes home-spin`

Add these new classes:
```css
/* Omnibox container */
.home-omnibox {
  width: 560px;
  max-width: 90%;
  position: relative;
}

.home-omnibox-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 32px;
  padding: 7px 7px 7px 10px;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.home-omnibox-input-row:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}

.home-omnibox-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 15px;
  outline: none;
  padding: 10px 4px;
  min-width: 0;
  font-family: inherit;
}

.home-omnibox-input::placeholder {
  color: var(--text-dim);
}

.home-omnibox-badge {
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-dim);
  flex-shrink: 0;
  font-family: inherit;
}

/* Action preview */
.home-omnibox-preview {
  font-size: 12px;
  color: var(--text-dim);
  padding: 6px 16px 0;
}

.home-omnibox-preview--error {
  color: var(--accent);
}

/* Results dropdown */
.home-omnibox-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
  z-index: 100;
}

.home-omnibox-group {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  padding: 8px 8px 4px;
}

.home-omnibox-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
}

.home-omnibox-item:hover,
.home-omnibox-item--selected {
  background: var(--bg-hover);
}

.home-omnibox-item-icon {
  color: var(--text-dim);
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.home-omnibox-item-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.home-omnibox-item-label {
  font-size: 14px;
  color: var(--text-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.home-omnibox-item-sublabel {
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Reuse existing button styles for plus, mic, submit inside omnibox */
.home-omnibox .home-plus-wrapper { position: relative; flex-shrink: 0; }
.home-omnibox .home-plus-btn,
.home-omnibox .home-mic-btn,
.home-omnibox .home-url-go {
  /* Keep existing styles — these class names stay but are scoped under .home-omnibox */
}
```

Actually — simpler approach: keep the existing button CSS classes (`.home-plus-btn`, `.home-mic-btn`, `.home-url-go`) as they are in the CSS file. Just move the HTML elements from the old form into the new omnibox input row. Don't delete the button CSS — only delete the container CSS (`.home-url-form`, `.home-search-hint`).

- [ ] **Step 3: Verify build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Home.tsx client/src/components/Home.css client/src/components/Omnibox.tsx && git commit -m "feat: integrate omnibox into home page replacing search + URL inputs"
```

---

### Task 5: Final verification and cleanup

- [ ] **Step 1: Run build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 2: Run tests**

```bash
cd browser-agent-chat/client && npx vitest run
```

- [ ] **Step 3: Manually verify in browser**

Open http://localhost:5175 and check:
- Single input visible (no separate search bar)
- Type a URL (stripe.com) → "Create" group appears with "Start new agent at stripe.com"
- Type a word (langfuse) → matching agents appear in "Agents" group
- Arrow keys navigate results
- Enter executes top result
- ⌘K focuses the input
- Esc clears input and hides results
- Chips and Recent Agents show when input is empty, hide when typing
- From a non-home page, ⌘K still opens CommandPalette overlay

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: unified omnibox — final integration"
```
