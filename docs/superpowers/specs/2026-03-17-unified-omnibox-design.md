# Unified Omnibox — Design Spec

## Overview

Replace the three competing entry points on the Home page (⌘K search bar, URL input, Recent Agents grid) with a **single intent-aware omnibox** that handles both "create new agent" and "find existing work." The omnibox auto-detects whether input is a URL or a search query and shows grouped results with a default action preview.

## Problem

The Home page has three elements fighting for the same intent — "I want to do something":

1. **⌘K search bar** — "Search agents, traces, evals..." (opens CommandPalette overlay)
2. **URL input** — "Paste your app URL..." (creates new agent)
3. **Recent Agents** — card grid (opens existing agent)

No top product uses two text inputs on the same home page. This creates decision paralysis and unclear primary action. Users don't think "I want to search" or "I want to create" — they think "I want to do something with X."

## Design Principles

1. **One input, one mental model** — "this is how I start anything"
2. **Intent detection, not pattern matching** — the system interprets what you want
3. **Keyboard-first** — auto-focus, ⌘K, arrow keys, Enter, Esc
4. **Default action preview** — always show what Enter will do
5. **Chrome Omnibox mental model** — users already know this pattern

## Home Page Structure

```
┌──────────────────────────────────────────────┐
│                                              │
│          What do you want to test?           │
│                                              │
│  [ Paste a URL or search anything...    ⌘K ] │
│  ↳ Press Enter to ...                        │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │ Grouped results (when typing)           │ │
│  │  Create                                 │ │
│  │  → Start new agent at stripe.com        │ │
│  │  Agents                                 │ │
│  │  → Stripe Prod Agent                    │ │
│  │  → Stripe Sandbox Agent                 │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  [ Explore & learn ] [ Test a flow ] [ Bugs ]│
│                                              │
├──────────────────────────────────────────────┤
│  Recent Agents                               │
│  [Card] [Card] [Card] [Card]                │
└──────────────────────────────────────────────┘
```

## What Gets Removed

- The `home-search-hint` div (the clickable ⌘K search bar that dispatches a keyboard event)
- The `home-url-form` wrapper (replaced by the omnibox)
- The plus menu (paste from clipboard, upload file) — moved into the omnibox as secondary actions
- The CommandPalette overlay is **not removed** — it still works on non-home pages via ⌘K. On the Home page, ⌘K focuses the omnibox instead of opening the overlay.

## What Stays

- The headline "What do you want to test?"
- The chips (Explore & learn, Test a flow, Find bugs)
- The Recent Agents grid
- The voice input button (moved into the omnibox)
- The agent creation logic (handleSubmit)

## Omnibox Component

### Input behavior

Single text input, auto-focused on page load. Placeholder: "Paste a URL or search anything..."

**⌘K badge** shown at the right edge of the input (visual indicator, not a separate element).

### Intent Detection

```ts
function detectIntent(input: string): 'url' | 'search' {
  const trimmed = input.trim()
  if (!trimmed) return 'search'
  try {
    // Handles full URLs: https://stripe.com, http://localhost:3000
    new URL(trimmed)
    return 'url'
  } catch {
    // Handles bare domains: stripe.com, staging-app.internal.company
    if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return 'url'
    // Handles localhost with port
    if (/^localhost(:\d+)?/.test(trimmed)) return 'url'
    return 'search'
  }
}
```

This handles: `https://stripe.com`, `stripe.com`, `localhost:3000`, `staging-app.internal.company`, `192.168.1.1:3000` (IP addresses match the domain regex via dots). Plain words like `stripe`, `checkout bug`, `login flow` → search.

### Default Action Preview

Always shown below the input. Updates as the user types.

| State | Preview text |
|-------|-------------|
| Empty input | (no preview — chips and recent agents visible) |
| URL detected | "Press Enter to start new agent at **stripe.com**" |
| Search with matches | "Press Enter to open **Stripe Prod Agent**" (top result) |
| Search with no matches | "No results found" |

### Grouped Results Dropdown

Appears below the input when the user is typing (non-empty input). Disappears when input is cleared. See **Visibility Rules** section for how chips and Recent Agents grid toggle.

**Result groups (in order):**

1. **Create** — shown only when URL detected. Single item: "Start new agent at {domain}"
2. **Agents** — existing agents matching the query (by name or URL)
3. **Quick Actions** — matching navigation items (Open Vault, View Observability, Go Home)

Each result shows: icon + label + sublabel (URL for agents, description for actions).

**Highlighted item** — the first result is highlighted by default. Arrow keys move the highlight. Enter executes the highlighted item.

### Data Sources

The omnibox merges data from:
- `agents` from `useSidebar()` — existing agents (name, URL, id)
- `QUICK_ACTIONS` — static navigation items. Currently defined inside `CommandPalette.tsx` as a non-exported constant. **Extract to `client/src/lib/quick-actions.ts`** so both CommandPalette and the omnibox can import it.

**Not included in V1:** Traces, Findings, Evals search (requires server-side search endpoints). These can be added in V2.

### Search Logic

Case-insensitive substring match on:
- Agent `name`
- Agent `url`
- Quick action `label`

When URL is detected, the "Create" group appears first AND agents matching the domain are shown below (e.g., typing `stripe.com` shows "Start new agent at stripe.com" AND existing "Stripe Prod Agent").

### Keyboard Behavior

| Key | Action |
|-----|--------|
| ⌘K / Ctrl+K | Focus the omnibox (when on Home page) |
| ↓ / ↑ | Navigate results |
| Enter | Execute highlighted result (create agent OR navigate to agent/action) |
| Esc | Clear input and close results |
Auto-focused on page load. ⌘K from other pages still opens the CommandPalette overlay (behavior unchanged).

**Accessibility:** The omnibox uses `role="combobox"` with `aria-expanded`, `aria-activedescendant` pointing to the highlighted item, and `role="option"` on each result item. Tab moves focus out of the omnibox (standard behavior, not overridden).

### Voice Input

The mic button stays inside the omnibox (right side, before the ⌘K badge). Same behavior as current: click to start listening, transcript populates the input, intent detection runs on the transcript.

### Plus Menu (Paste / Upload)

The plus button and its dropdown (paste from clipboard, upload file) stay inside the omnibox (left side). Same functionality — these are input helpers, not separate actions.

### Submit Button

The current round submit button (ArrowUp icon) stays inside the omnibox on the right, after the mic button. It serves as a visual affordance for mouse users and mobile users. Clicking it is equivalent to pressing Enter — it executes the top highlighted result. During agent creation, it shows a spinner (same as current behavior).

### Loading State

When an agent is being created (`isCreating = true`):
- The input is disabled
- The submit button shows a spinner
- The results dropdown closes
- The default action preview shows "Creating agent & launching browser..."
- The chips and Recent Agents remain visible below (dimmed)

### Error State

If agent creation fails:
- The default action preview line turns to error color (`--accent`) and shows the error message
- The input re-enables so the user can try again
- The error clears when the user starts typing

### Visibility Rules

When input is **empty**: chips and Recent Agents grid are visible. No results dropdown. No preview.

When input is **non-empty**: results dropdown appears below the input. Chips hide. Recent Agents grid hides. Preview line shows below the input (between input and results).

When input is **cleared** (Esc or manual delete): return to empty state — chips and Recent Agents reappear.

## CommandPalette Integration

The `CommandPalette` component stays as-is for non-home pages. The conflict: both the omnibox and CommandPalette register ⌘K handlers on `window`. Since both are `addEventListener` on the same target, `stopPropagation` does not work.

**Solution: shared context flag.** Add an `omniboxActive` ref to `SidebarContext` (or a lightweight context). The Home page sets it to `true` on mount, `false` on unmount. CommandPalette checks this flag before opening:

```ts
// In CommandPalette.tsx ⌘K handler:
if (omniboxActiveRef.current) return; // Home page handles it
setOpen(prev => !prev);
```

This avoids pathname coupling and works regardless of route changes.

## CSS Changes

### Removed classes
- `.home-search-hint` — the clickable ⌘K bar
- `.home-url-form` — replaced by `.home-omnibox`

### New/modified classes
- `.home-omnibox` — the unified input container (same pill shape as current URL form, 560px max, centered)
- `.home-omnibox-input` — the text input
- `.home-omnibox-badge` — the ⌘K badge (right-aligned inside input)
- `.home-omnibox-preview` — the default action preview text below input
- `.home-omnibox-results` — dropdown results container (appears on typing)
- `.home-omnibox-group` — group header (Create, Agents, Quick Actions)
- `.home-omnibox-item` — individual result row
- `.home-omnibox-item--selected` — highlighted result

All using CSS variables from the Delphi Tools theme. The results dropdown uses `--bg-card` background with `--border-primary` border, matching the input container's style.

## Files Affected

All paths relative to `browser-agent-chat/`.

### New files
- `client/src/components/Omnibox.tsx` — the omnibox component (extracted from Home.tsx since it will exceed 200 lines with intent detection, results, keyboard nav, and all input helpers)
- `client/src/lib/quick-actions.ts` — shared QUICK_ACTIONS array (extracted from CommandPalette.tsx)

### Modified
- `client/src/components/Home.tsx` — remove search hint + URL form, render `<Omnibox>` instead
- `client/src/components/Home.css` — remove `.home-search-hint` and `.home-url-form` classes, add `.home-omnibox-*` classes
- `client/src/components/CommandPalette.tsx` — import QUICK_ACTIONS from shared module; check `omniboxActive` flag before opening
- `client/src/contexts/SidebarContext.tsx` — add `omniboxActiveRef` to context

## Edge Cases

- **Empty input + Enter**: no-op (same as current)
- **URL with spaces**: trim before URL detection
- **"staging-app" (no TLD)**: treated as search, not URL. User must type `staging-app.company.com` for URL detection.
- **Paste event**: detect intent immediately on paste (user pastes a URL → shows create action instantly)
- **Agent with same domain as input URL**: show both "Create new" and "Open existing" — user picks which one
- **No agents yet (new user)**: only "Create" group appears. Recent Agents section shows empty state.

## Out of Scope (V2)

- AI-powered intent classification ("test checkout flow" → dispatch task)
- Traces / Findings / Evals search in the omnibox (requires server-side search)
- Command verbs ("open evals", "debug login")
- Natural language → agent task dispatch
- Extracting Omnibox into a shared component used by both Home and CommandPalette
