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

1. Create a `.env` file in the `server` directory:

```bash
cd browser-agent-chat/server
echo "ANTHROPIC_API_KEY=your-api-key-here" > .env
```

2. Install dependencies:

```bash
cd browser-agent-chat
npm install
```

## Running the Application

You need to run both the server and client in separate terminals.

### Terminal 1: Start the server

```bash
cd browser-agent-chat/server
npm run dev
```

The server will start on http://localhost:3001

### Terminal 2: Start the client

```bash
cd browser-agent-chat/client
npm run dev
```

The client will start on http://localhost:5174

## Usage

1. Open http://localhost:5174 in your browser
2. Enter a URL in the input field (default: https://magnitodo.com)
3. Click "Start Agent" to launch the browser agent
4. Once the agent is ready, you'll see a screenshot of the page
5. Type a task in the chat input (e.g., "Create a todo called 'Test task'")
6. Watch the agent work - you'll see its thoughts in the chat and screenshots updating as it performs actions

## Project Structure

```
browser-agent-chat/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.tsx         # Main app component
│   │   ├── App.css         # Styles
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── BrowserView.tsx
│   │   │   ├── Avatar/     # HeyGen avatar components
│   │   │   │   ├── AvatarContainer.tsx
│   │   │   │   ├── AvatarVideo.tsx
│   │   │   │   └── Avatar.css
│   │   │   └── VoiceInput/ # Voice input components
│   │   │       ├── VoiceInputButton.tsx
│   │   │       └── VoiceInput.css
│   │   ├── contexts/
│   │   │   └── AssistantContext.tsx
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useStreamingAvatar.ts
│   │   │   └── useVoiceInput.ts
│   │   └── types/
│   │       └── assistant.ts
│   └── package.json
├── server/                 # Node.js backend
│   ├── src/
│   │   ├── index.ts        # Express + WebSocket server
│   │   ├── agent.ts        # Magnitude agent wrapper
│   │   ├── heygen.ts       # HeyGen token generation
│   │   └── types.ts        # Shared types
│   └── package.json
└── package.json            # Workspace root
```

## Voice-Assisted Avatar (Optional)

The app supports an AI avatar powered by HeyGen that can:
- Greet users with a friendly voice message
- Provide visual feedback while the agent works
- Accept voice commands via the microphone button

### Setup

1. Get a HeyGen API key from https://app.heygen.com
2. Add it to your `server/.env`:

```bash
HEYGEN_API_KEY=your-heygen-api-key
```

3. The avatar will appear in the left panel when you launch the app

### Voice Input

Click the microphone button next to the chat input to speak your task. The app uses the Web Speech API (Chrome/Edge recommended).

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + ws (WebSocket)
- **Browser Automation:** magnitude-core
- **Voice Avatar:** HeyGen Streaming Avatar + LiveKit
- **Voice Input:** Web Speech API
- **Styling:** CSS
