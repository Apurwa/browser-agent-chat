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
