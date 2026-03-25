# Agent Architecture — Plan 3: World Model & Frontier

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Implement the shared world model (extend nav graph with semantic layer) and frontier-based exploration system.

**Architecture:** World model extends existing nav_nodes/nav_edges with page purposes and available actions. Frontier tracks unexplored UI elements with intent-aware priority scoring.

**Tech Stack:** Supabase (existing), Zod types from Plan 1, existing nav-graph.ts as foundation

---

### Task 1: World Model Read/Write

**Files:**
- Create: `server/src/world-model.ts`
- Modify: `server/src/mastra/tools/world-model.ts` (implement execute)
- Test: `server/__tests__/world-model.test.ts`

Extend existing nav-graph.ts patterns:
- `loadWorldModel(agentId)` → returns { pages (nav_nodes with purpose, available_actions, visited), edges, features, frontier }
- `updatePagePurpose(nodeId, purpose, availableActions)` → updates nav_nodes
- `markPageVisited(nodeId)` → sets visited=true
- `getWorldContext(agentId, domain?)` → serialized text summary for LLM context

Uses existing Supabase client. Reads from nav_nodes (extended columns) + nav_edges + memory_features + frontier_items.

Test: mock Supabase, verify serialization and CRUD.

### Task 2: Frontier CRUD

**Files:**
- Create: `server/src/frontier.ts`
- Modify: `server/src/mastra/tools/frontier.ts` (implement execute)
- Test: `server/__tests__/frontier.test.ts`

Functions:
- `addFrontierItems(agentId, items: FrontierItem[])` → insert, deduplicate by targetUrlHash
- `getNextFrontier(agentId, intentId?)` → highest priority unexplored item, with intent relevance boost if intentId provided
- `markExplored(itemId)` → set explored=true
- `expireStaleFrontier(agentId, pageId)` → remove items whose parent page no longer has the element (context-based expiration)
- `getFrontierStats(agentId)` → { total, explored, remaining, byCategory }

Test: mock Supabase, verify priority ordering, deduplication, expiration rules.

### Task 3: Priority Scoring

**Files:**
- Create: `server/src/frontier-scoring.ts`
- Test: `server/__tests__/frontier-scoring.test.ts`

Pure function (no DB):
```typescript
function computeFrontierPriority(item: FrontierItem, intentRelevance?: number): number
```

Formula from spec:
```
base_score = unseen_page * 3 + form * 2 + modal * 2 + elements * 1 - visited * 2 - depth * 1 - failure * 3
priority = base_score + (intentRelevance ?? 0) * 4
```

Test: verify scoring with various inputs, verify intent relevance boost.

### Task 4: UPDATE_STATE step implementation

**Files:**
- Modify: `server/src/mastra/workflows/agent-task.ts` (update-state step)

After each EXECUTE, UPDATE_STATE:
1. Records navigation in nav graph (existing recordNavigation)
2. Updates page purpose/available_actions if new info extracted
3. Adds newly discovered UI elements to frontier
4. Marks current frontier item as explored

Wires together world-model.ts and frontier.ts.
