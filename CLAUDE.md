# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a demo repository for Magnitude, an AI-powered browser testing framework. It contains:
- A simple React todo list app (`src/`) demonstrating Magnitude test cases
- A browser-agent-chat sub-project (`browser-agent-chat/`) - a chat interface for AI browser automation

## Commands

**Main Todo App:**
```bash
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # TypeScript compile + Vite build
npm run lint         # ESLint
```

**Magnitude Tests (requires dev server running):**
```bash
npx magnitude                    # Run all tests in tests/
npx magnitude tests/todo.mag.ts  # Run single test file
npx magnitude -p                 # Parallel mode (for CI)
```

**Browser Agent Chat** (separate sub-project):
```bash
cd browser-agent-chat/server && npm run dev  # Server on :3001
cd browser-agent-chat/client && npm run dev  # Client on :5174
```

## Architecture

- **Frontend:** React 19 + TypeScript + Vite
- **Testing:** Magnitude (AI-powered browser testing using Playwright + vision LLMs)

**Key files:**
- `src/App.tsx` - Main todo list component
- `tests/magnitude.config.ts` - Magnitude config (sets base URL)
- `tests/todo.mag.ts` - Magnitude test cases

## Magnitude Testing

Tests use natural language commands:
- `agent.act(description, { data })` - Perform actions with optional test data
- `agent.check(assertion)` - Verify conditions visually

Per-test URL override:
```ts
test('test name', { url: 'https://example.com' }, async (agent) => { ... });
```

## Environment Setup

Requires `ANTHROPIC_API_KEY` and optionally `MOONDREAM_API_KEY` in `.env`. See [Magnitude docs](https://github.com/magnitudedev/magnitude?tab=readme-ov-file#configure-llms).
