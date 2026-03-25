# Unified Omnibox Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three competing Home page entry points (⌘K search bar, URL input, Recent Agents) with a single intent-aware omnibox that handles both creating new agents and finding existing work.

**Architecture:** Extract QUICK_ACTIONS to a shared module. Add an `omniboxActive` ref to SidebarContext so CommandPalette defers to the omnibox on the Home page. Build the Omnibox as a new component with intent detection (URL vs search), grouped results dropdown, default action preview, and keyboard navigation. Modify Home.tsx to render it.

**Tech Stack:** React 19, TypeScript, CSS custom properties (Delphi Tools theme)

**Spec:** `docs/superpowers/specs/2026-03-17-unified-omnibox-design.md`

---

## File Structure

All paths relative to `browser-agent-chat/`.

### New Files

| File | Responsibility |
|------|---------------|
| `client/src/lib/quick-actions.ts` | Shared QUICK_ACTIONS array + CmdItem type (extracted from CommandPalette) |
| `client/src/components/Omnibox.tsx` | The unified omnibox: input, intent detection, grouped results, keyboard nav, default action preview |

### Modified Files

| File | Changes |
|------|---------|
| `client/src/contexts/SidebarContext.tsx` | Add `omniboxActiveRef` to context |
| `client/src/components/CommandPalette.tsx` | Import QUICK_ACTIONS from shared module; check `omniboxActiveRef` before opening |
| `client/src/components/Home.tsx` | Remove search hint + URL form; render `<Omnibox>`; set `omniboxActiveRef` on mount |
| `client/src/components/Home.css` | Remove `.home-search-hint`, `.home-url-form`; add `.home-omnibox-*` classes |

---

## Chunk 1: Shared Infrastructure

### Task 1: Extract QUICK_ACTIONS to shared module

**Files:**
- Create: `client/src/lib/quick-actions.ts`
- Modify: `client/src/components/CommandPalette.tsx`

- [ ] **Step 1: Create the shared module**

```ts
// client/src/lib/quick-actions.ts
import type { ReactNode } from 'react'

export interface CmdItem {
  id: string
  label: string
  sublabel?: string
  route: string
  icon: 'agent' | 'vault' | 'observability' | 'action'
  group: string
}

export const QUICK_ACTIONS: CmdItem[] = [
  { id: 'qa-vault', label: 'Open Vault', route: '/vault', icon: 'vault', group: 'Quick Actions' },
  { id: 'qa-observability', label: 'View Observability', route: '/observability', icon: 'observability', group: 'Quick Actions' },
  { id: 'qa-home', label: 'Go Home', route: '/', icon: 'action', group: 'Quick Actions' },
]
```

- [ ] **Step 2: Update CommandPalette to import from shared module**

In `CommandPalette.tsx`:
- Remove the local `CmdItem` interface and `QUICK_ACTIONS` array
- Add: `import { QUICK_ACTIONS, type CmdItem } from '../lib/quick-actions'`
- Everything else stays the same

- [ ] **Step 3: Verify build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/quick-actions.ts client/src/components/CommandPalette.tsx && git commit -m "refactor: extract QUICK_ACTIONS to shared module"
```

---

### Task 2: Add omniboxActiveRef to SidebarContext

**Files:**
- Modify: `client/src/contexts/SidebarContext.tsx`
- Modify: `client/src/components/CommandPalette.tsx`

- [ ] **Step 1: Add ref to SidebarContext**

In `SidebarContext.tsx`, add a `useRef` and expose it:

Add to the interface:
```ts
omniboxActiveRef: React.RefObject<boolean>
```

In the provider, add:
```ts
const omniboxActiveRef = useRef(false)
```

Pass it in the value:
```ts
<SidebarContext.Provider value={{ agents, agentsLoading, agentsError, refreshAgents, omniboxActiveRef }}>
```

- [ ] **Step 2: CommandPalette checks the ref before opening**

In `CommandPalette.tsx`, get the ref from context:
```ts
const { agents, omniboxActiveRef } = useSidebar()
```

In the ⌘K handler (the `useEffect` with `window.addEventListener`), add at the top of the handler:
```ts
if (omniboxActiveRef.current) return // Home page omnibox handles it
```

- [ ] **Step 3: Verify build + ⌘K still works on non-home pages**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add client/src/contexts/SidebarContext.tsx client/src/components/CommandPalette.tsx && git commit -m "feat: add omniboxActive ref to prevent CommandPalette conflict on Home"
```

---

## Chunk 2: Omnibox Component

### Task 3: Build the Omnibox component

**Files:**
- Create: `client/src/components/Omnibox.tsx`

- [ ] **Step 1: Create the Omnibox component**

The component handles:
1. **Single input** — auto-focused, placeholder "Paste a URL or search anything..."
2. **Intent detection** — `detectIntent(input)` returns `'url' | 'search'`
3. **Grouped results** — Create (if URL), Agents (matching), Quick Actions (matching)
4. **Default action preview** — shows what Enter will do
5. **Keyboard navigation** — ↑/↓ to navigate, Enter to execute, Esc to clear
6. **Submit button** — ArrowUp icon, spinner during creation
7. **Plus menu** — paste from clipboard, upload file (carried over from Home.tsx)
8. **Voice input** — mic button (carried over from Home.tsx)

Props:
```ts
interface OmniboxProps {
  onCreateAgent: (url: string) => Promise<void>
  isCreating: boolean
  error: string | null
}
```

The component should:
- Import `QUICK_ACTIONS` and `CmdItem` from `../lib/quick-actions`
- Import `useSidebar` to get `agents`
- Import `useNavigate` for agent/action navigation
- Import `useVoiceInput` for mic support
- Use `role="combobox"` with `aria-expanded`, `aria-activedescendant`, and `role="option"` on items

Intent detection function:
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

Result grouping:
```ts
// When intent is 'url': show Create group + matching agents
// When intent is 'search': show matching Agents + Quick Actions
// Results are grouped with headers: "Create", "Agents", "Quick Actions"
```

The component renders:
```tsx
<div className="home-omnibox">
  <div className="home-omnibox-input-row">
    {/* Plus menu (left) */}
    {/* Input */}
    {/* Mic button */}
    {/* Submit button */}
    {/* ⌘K badge */}
  </div>
  {/* Default action preview */}
  {error && <div className="home-omnibox-error">{error}</div>}
  {/* Grouped results dropdown (when input non-empty) */}
</div>
```

Target: ~180-220 lines.

- [ ] **Step 2: Verify types compile**

```bash
cd browser-agent-chat/client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Omnibox.tsx && git commit -m "feat: omnibox component with intent detection, grouped results, keyboard nav"
```

---

### Task 4: Add Omnibox CSS

**Files:**
- Modify: `client/src/components/Home.css`

- [ ] **Step 1: Remove old classes, add new ones**

Remove these CSS blocks from Home.css:
- `.home-search-hint` and `.home-search-hint:hover` and `.home-search-hint kbd`
- `.home-url-form` and `.home-url-form:focus-within`

Add these new classes (use CSS variables, no hardcoded hex):

```css
/* Omnibox */
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
}

.home-omnibox-preview {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 8px;
  padding-left: 16px;
}

.home-omnibox-preview strong {
  color: var(--text-body);
}

.home-omnibox-error {
  font-size: 12px;
  color: var(--accent);
  margin-top: 8px;
  padding-left: 16px;
}

/* Results dropdown */
.home-omnibox-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 50;
  max-height: 320px;
  overflow-y: auto;
}

.home-omnibox-group {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  padding: 8px 14px 4px;
}

.home-omnibox-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
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
}

.home-omnibox-item-label {
  font-size: 13px;
  color: var(--text-primary);
}

.home-omnibox-item-sublabel {
  font-size: 11px;
  color: var(--text-dim);
  margin-left: 8px;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Home.css && git commit -m "feat: omnibox CSS with grouped results dropdown"
```

---

## Chunk 3: Home Page Integration

### Task 5: Wire Omnibox into Home.tsx

**Files:**
- Modify: `client/src/components/Home.tsx`

- [ ] **Step 1: Replace search hint + URL form with Omnibox**

Read `Home.tsx` first. Then:

1. Remove the `home-search-hint` div (lines ~128-137)
2. Remove the `home-url-form` form (lines ~139-193)
3. Remove the `showPlusMenu`, `fileInputRef`, `handlePasteFromClipboard`, `handleFileUpload` state/handlers (moved to Omnibox)
4. Remove voice input state/handlers (moved to Omnibox)
5. Import and render `<Omnibox>` in their place:

```tsx
import Omnibox from './Omnibox'

// In the render, replace search-hint + url-form with:
<Omnibox
  onCreateAgent={handleCreateAgent}
  isCreating={isCreating}
  error={error}
/>
```

6. Simplify `handleSubmit` into a `handleCreateAgent(url: string)` function that takes the URL directly (the Omnibox handles normalization):

```tsx
const handleCreateAgent = async (rawUrl: string) => {
  setIsCreating(true)
  setError(null)
  let normalizedUrl = rawUrl.trim()
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

7. Set `omniboxActiveRef` on mount/unmount:

```tsx
const { omniboxActiveRef } = useSidebar()

useEffect(() => {
  omniboxActiveRef.current = true
  return () => { omniboxActiveRef.current = false }
}, [omniboxActiveRef])
```

8. Conditionally hide chips + Recent Agents when omnibox has input (pass a state down or let Omnibox control visibility via a callback):

```tsx
const [omniboxHasInput, setOmniboxHasInput] = useState(false)

// Pass to Omnibox:
<Omnibox ... onInputChange={(hasInput) => setOmniboxHasInput(hasInput)} />

// Conditionally render:
{!isCreating && !omniboxHasInput && (
  <>
    <div className="home-chips">...</div>
    {agents.length === 0 && <p className="home-hint">...</p>}
  </>
)}

// Recent Agents:
{agents.length > 0 && !omniboxHasInput && (
  <div className="home-projects">...</div>
)}
```

- [ ] **Step 2: Verify build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Home.tsx && git commit -m "feat: integrate omnibox into Home page, remove redundant inputs"
```

---

### Task 6: Final cleanup and verification

- [ ] **Step 1: Run full build**

```bash
cd browser-agent-chat && npm run build
```

- [ ] **Step 2: Run tests**

```bash
cd browser-agent-chat/client && npx vitest run
```

- [ ] **Step 3: Verify manually**

Open http://localhost:5175 and test:
- Type `stripe.com` → see "Create" group with "Start new agent at stripe.com"
- Type `stripe` → see matching agents in "Agents" group
- Arrow keys navigate, Enter executes
- ⌘K focuses the input
- Empty input shows chips + Recent Agents
- Non-empty input hides chips + Recent Agents, shows results dropdown

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: unified omnibox — final cleanup"
```
