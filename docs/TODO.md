# TODO — Agent Architecture

## Next Up

1. **Fix action diversity inconsistency** — 2/5 E2E runs used only `mouse:click` (no `extract`). Investigate why Magnitude's internal loop sometimes takes over instead of our policy DECIDE step. Target: ≥2 action types in 5/5 runs.

2. **Wire frontier population** — Frontier CRUD is built (`src/frontier.ts`) but nothing populates it during the agent loop. Add frontier item creation in UPDATE_STATE when new UI elements are discovered. This makes exploration systematic instead of sidebar-clicking.

3. **Fix intent count logging** — `Strategy planned:` thought shows 0 intents in test captures. Either planner falls back to single-intent or the thought format changed. Debug.

## Deferred (Post-MVP)

4. **UI State Abstraction** — Replace page-level tracking with state-level (page + tab + modal + actions hashed). Add when evals show revisit/loop problems.
5. **Skill execution** — Skills are matched and logged but not replayed. Wire actual skill replay.
6. **Exploration budget allocation** — Split step budget per intent for finer control.
7. **Frontier categories** — Weight `workflow > modal > navigation > minor action`.
8. **Cross-app skill portability** — Skills from App A applied to similar App B.
9. **Parallel frontier exploration** — Multiple Magnitude agents on different branches.
10. **State similarity** — Deduplicate paginated lists with similarity threshold ≥0.9.
