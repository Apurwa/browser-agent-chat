# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Browser Agent Chat** - A web-based chat platform where users communicate with an AI browser agent powered by Magnitude. Users see a chat interface alongside a live stream of the browser as the agent performs tasks.

The repo also includes a simple todo demo app used for testing.

## Commands

**Browser Agent Chat** (main project, in `browser-agent-chat/`):
```bash
cd browser-agent-chat
npm install                  # Install all workspace dependencies
npm run dev                  # Run both server and client
npm run dev:server           # Server only (http://localhost:3001)
npm run dev:client           # Client only (http://localhost:5174)
npm run build                # Build both workspaces
```

**Todo Demo App** (root directory):
```bash
npm run dev                  # Vite dev server (http://localhost:5173)
npm run build                # TypeScript + Vite build
npm run lint                 # ESLint
```

**Magnitude Tests** (requires todo demo server running):
```bash
npx magnitude                    # Run all tests
npx magnitude tests/todo.mag.ts  # Run single test file
npx magnitude -p                 # Parallel mode (CI)
```

## Architecture

### Browser Agent Chat

```
browser-agent-chat/
├── client/                 # React 19 + TypeScript + Vite
│   └── src/
│       ├── App.tsx         # Main app with chat + browser view layout
│       ├── components/
│       │   ├── ChatPanel.tsx    # Chat input and message history
│       │   ├── BrowserView.tsx  # Live screenshot stream display
│       │   └── LandingPage.tsx  # Initial URL input page
│       └── hooks/
│           └── useWebSocket.ts  # WebSocket connection hook
├── server/                 # Node.js + Express + WebSocket
│   └── src/
│       ├── index.ts        # Express + WS server setup
│       ├── agent.ts        # Magnitude agent wrapper
│       ├── types.ts        # Shared types
│       ├── db.ts           # Database utilities
│       └── supabase.ts     # Supabase client
└── package.json            # Workspace root (npm workspaces)
```

**Tech Stack:**
- **Client:** React 19, TypeScript, Vite
- **Server:** Express, ws (WebSocket), magnitude-core, Supabase
- **Browser Automation:** Magnitude (Playwright + vision LLMs)

### Communication Flow
1. Client connects via WebSocket to server
2. User enters a task in chat
3. Server sends task to Magnitude agent
4. Agent performs browser actions, streams screenshots back
5. Client displays live browser view and agent thoughts

## Environment Setup

**Browser Agent Chat** - Create `browser-agent-chat/server/.env`:
```
ANTHROPIC_API_KEY=your-key-here
```

**Magnitude Tests** - Create `.env` in root:
```
ANTHROPIC_API_KEY=your-key-here
MOONDREAM_API_KEY=your-key-here  # optional
```

## Magnitude API Reference

**Browser automation** (magnitude-core, used in server):
```ts
import { startBrowserAgent } from 'magnitude-core';
const agent = await startBrowserAgent({ url: 'https://example.com' });
await agent.act('click the login button');
await agent.extract('get the page title', z.string());
await agent.stop();
```

**Testing** (magnitude-test, used in tests/):
```ts
import { test } from 'magnitude-test';
test('test name', async (agent) => {
    await agent.act('do something', { data: { key: 'value' } });
    await agent.check('verify something');
});
```
