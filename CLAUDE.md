# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Browser Agent Chat** - A web-based chat platform where users communicate with an AI browser agent powered by Magnitude. Users see a chat interface alongside a live stream of the browser as the agent performs tasks.

## Commands

```bash
cd browser-agent-chat
npm install                  # Install all workspace dependencies
npm run dev                  # Run both server and client
npm run dev:server           # Server only (http://localhost:3001)
npm run dev:client           # Client only (http://localhost:5174)
npm run build                # Build both workspaces
```

## Architecture

```
browser-agent-chat/
├── client/                 # React 19 + TypeScript + Vite
│   └── src/
│       ├── App.tsx         # Main app with avatar + chat + browser layout
│       ├── components/
│       │   ├── ChatPanel.tsx    # Chat input and message history
│       │   ├── BrowserView.tsx  # Live screenshot stream display
│       │   ├── LandingPage.tsx  # Initial URL input page
│       │   ├── Avatar/          # HeyGen streaming avatar
│       │   │   ├── AvatarContainer.tsx
│       │   │   ├── AvatarVideo.tsx
│       │   │   └── Avatar.css
│       │   └── VoiceInput/      # Voice input via Web Speech API
│       │       ├── VoiceInputButton.tsx
│       │       └── VoiceInput.css
│       ├── contexts/
│       │   └── AssistantContext.tsx  # Global assistant state
│       ├── hooks/
│       │   ├── useWebSocket.ts       # WebSocket connection
│       │   ├── useStreamingAvatar.ts # HeyGen SDK wrapper
│       │   └── useVoiceInput.ts      # Web Speech API wrapper
│       └── types/
│           └── assistant.ts    # Voice assistant types
├── server/                 # Node.js + Express + WebSocket
│   └── src/
│       ├── index.ts        # Express + WS server setup
│       ├── agent.ts        # Magnitude agent wrapper
│       ├── heygen.ts       # HeyGen token generation
│       ├── types.ts        # Shared types
│       ├── db.ts           # Database utilities
│       └── supabase.ts     # Supabase client
└── package.json            # Workspace root (npm workspaces)
```

**Tech Stack:**
- **Client:** React 19, TypeScript, Vite, HeyGen Streaming Avatar, LiveKit
- **Server:** Express, ws (WebSocket), magnitude-core, Supabase
- **Browser Automation:** Magnitude (Playwright + vision LLMs)
- **Voice Assistant:** HeyGen Avatar (TTS) + Web Speech API (voice input)

## Communication Flow

1. Client connects via WebSocket to server
2. User enters a task in chat
3. Server sends task to Magnitude agent
4. Agent performs browser actions, streams screenshots back
5. Client displays live browser view and agent thoughts

## Environment Setup

**Local development** - Create `browser-agent-chat/server/.env`:
```
ANTHROPIC_API_KEY=your-key-here
HEYGEN_API_KEY=your-heygen-key-here  # Optional: for voice assistant
```

**Production** (Render):
- Server: `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`, `CORS_ORIGIN`
- Client: `VITE_WS_URL` (use `wss://`), `VITE_API_URL` (for REST endpoints)

## Deployment

Uses Render with `render.yaml` blueprint:
- **Server:** Docker-based web service (needs Playwright/Chromium)
- **Client:** Static site

See README.md for detailed deployment instructions.

## Magnitude API Reference

```ts
import { startBrowserAgent } from 'magnitude-core';

const agent = await startBrowserAgent({ url: 'https://example.com' });
await agent.act('click the login button');
await agent.extract('get the page title', z.string());
await agent.stop();
```
