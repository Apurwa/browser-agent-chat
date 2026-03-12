# Product Knowledge Vault

## Goal

Create an Obsidian-compatible markdown vault in the repo that documents the expected product behavior of **Browser Agent Chat** — this platform (the QA testing tool itself, not the external apps it tests). The vault serves as the source of truth for both humans (browsing in Obsidian) and AI development agents (reading files for context before making changes).

## Constraints

- **Product behavior only** — describes what the platform does from a user's perspective. No implementation details, no code, no database schemas, no API contracts.
- **Humans + agents equally** — pleasant to navigate in Obsidian's graph view AND easy for agents to consume as plain markdown.
- **No tooling** — no build scripts, no auto-injection, no plugins. Agents read files directly.

## Vault Location

```
docs/product-knowledge/
```

Lives inside the repo at `docs/product-knowledge/`, checked into git, versioned with the code.

## Structure

Flat directory. All pages at the same level. One Map of Content (MOC) index file as the entry point. Obsidian graph relationships come from `[[wikilinks]]` between pages, not from folder hierarchy.

```
docs/product-knowledge/
├── index.md                 ← MOC: entry point for humans and agents
├── platform-overview.md
├── authentication.md
├── projects.md
├── project-settings.md
├── testing.md
├── task-execution.md
├── explore-and-learn.md
├── memory-system.md
├── suggestion-review.md
├── passive-learning.md
├── findings.md
├── findings-dashboard.md
├── live-browser-view.md
└── session-management.md
```

14 pages + 1 index = 15 files total.

## Page Template

Every page follows this structure:

```markdown
# Feature/Flow Name

> One-line summary of what this does.

## Preconditions

- What must be true before this feature/flow applies
- e.g., "User is logged in" or "Agent session is active"

## Expected Behaviors

- When [trigger], [expected outcome]
- When [trigger], [expected outcome]
- Each behavior is a testable assertion about the product

## Edge Cases

- [Condition] → [expected handling]
- Boundary conditions, error states, empty states

## Related

- [[wikilink-to-connected-feature]]
- [[wikilink-to-connected-flow]]
```

Template rules:
- **Expected behaviors** are declarative "when X, Y should happen" statements. Each one is independently testable.
- **Preconditions** make behaviors self-contained — no need to read another page to know when this applies.
- **Edge cases** are separated from happy-path behaviors.
- **Related** section creates Obsidian graph edges via `[[wikilinks]]`.
- No YAML frontmatter.

## Index (MOC)

The `index.md` file is the entry point. It groups pages by feature area and provides one-line descriptions:

```markdown
# Browser Agent Chat — Product Knowledge

> Source of truth for expected platform behavior.
> For agents: read this index, then read the pages relevant to your task.

## Core
- [[platform-overview]] — What the platform is and core concepts

## Projects & Auth
- [[authentication]] — OAuth login and session handling
- [[projects]] — Creating, editing, deleting projects
- [[project-settings]] — Credentials, context, configuration

## Testing
- [[testing]] — Testing interface overview (chat + browser view)
- [[task-execution]] — Sending tasks to the agent
- [[explore-and-learn]] — Autonomous exploration mode

## Agent Knowledge
- [[memory-system]] — Features, flows, expected behaviors
- [[suggestion-review]] — Pending suggestions queue
- [[passive-learning]] — Learning during normal tasks

## Findings
- [[findings]] — Finding detection, types, severity
- [[findings-dashboard]] — Browsing and managing findings

## Real-time
- [[live-browser-view]] — Screenshot streaming and status
- [[session-management]] — Connect/reconnect and persistence
```

## CLAUDE.md Integration

Add the following section to the project's `CLAUDE.md`, at the end of the file:

```markdown
## Product Knowledge

Expected platform behavior is documented in `docs/product-knowledge/`.
Read `docs/product-knowledge/index.md` first to find pages relevant to your task.
These docs describe *what* the product should do, not how it's implemented.
```

This is the only integration point. Agents read the index, follow the links they need.

## Example Pages

Three pages are fully written to establish the pattern. The rest are stubs.

### Fully written:
1. **`testing.md`** — Feature overview page that links to child flows (hub pattern).
2. **`explore-and-learn.md`** — Flow page with sequential behaviors and preconditions (flow pattern).
3. **`findings.md`** — Feature page with classification behaviors: types, severity, statuses (rich edge cases pattern).

The implementer drafts these by reading the current codebase (components, WebSocket handlers, agent logic) and extracting user-facing behaviors. Content is reviewed for accuracy before merging.

### Stubs:
The remaining 11 pages contain only the title and a placeholder:

```markdown
# Page Title

> TODO: Document expected behaviors.
```

This keeps the vault structure complete and prevents broken `[[wikilinks]]` in Obsidian.

## Page Inventory

| Page | Type | Area | Description |
|------|------|------|-------------|
| `platform-overview` | overview | Core | What the platform is, who it's for, core concepts |
| `authentication` | feature | Projects & Auth | OAuth login (Google/GitHub), session handling |
| `projects` | feature | Projects & Auth | Creating, editing, deleting projects |
| `project-settings` | flow | Projects & Auth | Credentials, context, configuration options |
| `testing` | feature | Testing | Testing interface: chat panel + live browser view |
| `task-execution` | flow | Testing | User sends task, agent performs actions, reports back |
| `explore-and-learn` | flow | Testing | Autonomous exploration, feature/flow discovery |
| `memory-system` | feature | Agent Knowledge | Features, flows, expected behaviors as knowledge model |
| `suggestion-review` | flow | Agent Knowledge | Pending queue: accept, edit, dismiss suggestions |
| `passive-learning` | flow | Agent Knowledge | Agent notices new features during normal tasks |
| `findings` | feature | Findings | Detection, types, severity, lifecycle |
| `findings-dashboard` | flow | Findings | Browsing, filtering, confirming, dismissing findings |
| `live-browser-view` | feature | Real-time | Screenshot stream, URL bar, status indicator |
| `session-management` | feature | Real-time | Connect/reconnect, persistence, idle timeout |

## Scope

The vault documents **current, implemented** platform behavior — not aspirational or planned features. All 14 pages correspond to features that exist in the codebase today.

## Maintenance

Pages should be updated alongside the code changes that alter the described behavior. No separate review process is required — treat product-knowledge pages like you would update a test when changing functionality.

## What We're NOT Building

- No YAML frontmatter or metadata tags
- No Dataview queries or Obsidian plugin dependencies
- No auto-injection into agent prompts
- No build scripts or documentation generators
- No implementation/architecture docs (those stay in `docs/superpowers/`)
- No versioning beyond git history
- No template enforcement tooling
