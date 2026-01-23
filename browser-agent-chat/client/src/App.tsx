import { useState, useCallback, useRef } from 'react';
import { useWebSocket, type AgentEvent } from './hooks/useWebSocket';
import { AssistantProvider, useAssistant } from './contexts/AssistantContext';
import { ChatPanel } from './components/ChatPanel';
import { BrowserView } from './components/BrowserView';
import { LandingPage } from './components/LandingPage';
import { AvatarContainer } from './components/Avatar/AvatarContainer';

function AppContent() {
  const [showApp, setShowApp] = useState(false);
  const { speakText, isAvatarReady, isSpeaking } = useAssistant();
  const lastSpokenRef = useRef<string>('');

  const handleAgentEvent = useCallback(async (event: AgentEvent) => {
    if (!isAvatarReady) return;

    // Don't interrupt if already speaking, and avoid repeating
    if (isSpeaking) return;

    let narration = '';

    switch (event.type) {
      case 'thought':
        // Narrate thoughts (keep them brief)
        if (event.content.length < 100) {
          narration = event.content;
        }
        break;

      case 'action':
        // Narrate actions in a friendly way
        const action = event.content.toLowerCase();
        if (action.includes('click')) {
          narration = `Clicking ${action.replace('click', '').trim()}`;
        } else if (action.includes('type') || action.includes('fill')) {
          narration = `Typing the information`;
        } else if (action.includes('scroll')) {
          narration = `Scrolling the page`;
        } else if (action.includes('navigate') || action.includes('go to')) {
          narration = `Navigating to the page`;
        } else {
          narration = `Performing: ${event.content}`;
        }
        break;

      case 'taskComplete':
        narration = event.success
          ? "Done! I've completed the task."
          : "I ran into an issue and couldn't complete the task.";
        break;

      case 'error':
        narration = `Oops, there was an error: ${event.content}`;
        break;

      case 'status':
        if (event.status === 'idle') {
          // Agent became ready - don't narrate this
        }
        break;
    }

    // Only speak if we have something new to say
    if (narration && narration !== lastSpokenRef.current) {
      lastSpokenRef.current = narration;
      await speakText(narration);
    }
  }, [isAvatarReady, isSpeaking, speakText]);

  const {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    startAgent,
    sendTask,
    stopAgent
  } = useWebSocket({ onAgentEvent: handleAgentEvent });

  if (!showApp) {
    return <LandingPage onLaunchApp={() => setShowApp(true)} />;
  }

  return (
    <div className="app">
      <div className="app-container">
        <div className="left-panel">
          <div className="avatar-section">
            <AvatarContainer />
          </div>
          <div className="chat-section">
            <ChatPanel
              messages={messages}
              status={status}
              onSendTask={sendTask}
              onStartAgent={startAgent}
              onStopAgent={stopAgent}
              currentUrl={currentUrl}
            />
          </div>
        </div>
        <BrowserView
          screenshot={screenshot}
          currentUrl={currentUrl}
          status={status}
        />
      </div>
      {!connected && (
        <div className="connection-banner">
          Connecting to server...
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <AssistantProvider>
      <AppContent />
    </AssistantProvider>
  );
}

export default App;
