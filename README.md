# Browser Agent Chat

A web-based chat platform where users communicate with an AI browser agent powered by Magnitude. Users see a chat interface alongside a live stream of the browser as the agent performs tasks.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                       │
│  ┌──────────────────────┐  ┌─────────────────────────────┐ │
│  │     Chat Panel       │  │    Browser View Panel       │ │
│  │  - Message input     │  │  - Live screenshot stream   │ │
│  │  - Chat history      │  │  - Agent status indicator   │ │
│  │  - Agent thoughts    │  │  - Current URL display      │ │
│  └──────────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Node.js)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Express API │  │  WS Server  │  │  Magnitude Agent    │ │
│  │ - Health    │  │  - Events   │  │  - act()            │ │
│  │ - Sessions  │  │  - Screenshots│ │  - extract()        │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 18+
- npm 9+
- An Anthropic API key

## Setup

1. Clone the repo:
```bash
git clone https://github.com/magnitudedev/magnitude-demo-repo.git
cd magnitude-demo-repo/browser-agent-chat
```

2. Create a `.env` file in the `server` directory:
```bash
echo "ANTHROPIC_API_KEY=your-api-key-here" > server/.env
```

3. Install dependencies:
```bash
npm install
```

## Running the Application

### Option 1: Run both server and client
```bash
npm run dev
```

### Option 2: Run separately

**Terminal 1 - Server (http://localhost:3001):**
```bash
npm run dev:server
```

**Terminal 2 - Client (http://localhost:5174):**
```bash
npm run dev:client
```

## Usage

1. Open http://localhost:5174 in your browser
2. Enter a URL in the input field (default: https://magnitodo.com)
3. Click "Start Agent" to launch the browser agent
4. Once the agent is ready, you'll see a screenshot of the page
5. Type a task in the chat input (e.g., "Create a todo called 'Test task'")
6. Watch the agent work - you'll see its thoughts in the chat and screenshots updating

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + ws (WebSocket)
- **Browser Automation:** magnitude-core
- **Database:** Supabase

## Deploy to Render

### Option 1: One-click deploy (Blueprint)

1. Fork this repository
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click **New** → **Blueprint**
4. Connect your forked repo and select `browser-agent-chat/render.yaml`
5. Add your `ANTHROPIC_API_KEY` in the environment variables
6. Deploy!

### Option 2: Manual setup

**Server (Web Service):**
1. Create a new **Web Service** on Render
2. Connect your repo, set root directory to `browser-agent-chat/server`
3. Choose **Docker** as runtime
4. Set environment variables:
   - `ANTHROPIC_API_KEY`: your key
   - `CORS_ORIGIN`: your client URL (e.g., `https://your-client.onrender.com`)
5. Use at least the **Starter** plan (browser needs memory)

**Client (Static Site):**
1. Create a new **Static Site** on Render
2. Connect your repo, set root directory to `browser-agent-chat/client`
3. Build command: `npm install && npm run build`
4. Publish directory: `dist`
5. Set environment variable:
   - `VITE_WS_URL`: `wss://your-server.onrender.com`

### Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Server | Your Anthropic API key |
| `CORS_ORIGIN` | Server | Client URL for CORS |
| `VITE_WS_URL` | Client | WebSocket URL to server (use `wss://` for production) |
