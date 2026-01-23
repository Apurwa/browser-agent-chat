import { useState, useCallback, useRef, useEffect } from 'react';
import { useWebSocket, type AgentEvent } from './hooks/useWebSocket';
import { AssistantProvider, useAssistant } from './contexts/AssistantContext';
import { ChatPanel } from './components/ChatPanel';
import { BrowserView } from './components/BrowserView';
import { LandingPage } from './components/LandingPage';
import { AvatarContainer } from './components/Avatar/AvatarContainer';

const DEFAULT_URL = 'https://google.com';

function AppContent() {
  const [showApp, setShowApp] = useState(false);
  const { speakText, isAvatarReady, isSpeaking } = useAssistant();
  const lastSpokenRef = useRef<string>('');
  const hasStartedAgentRef = useRef(false);

  const handleAgentEvent = useCallback(async (event: AgentEvent) => {
    if (!isAvatarReady) return;

    // Don't interrupt if already speaking, and avoid repeating
    if (isSpeaking) return;

    let narration = '';

    switch (event.type) {
      case 'thought':
        // Share the agent's reasoning/plan - this is the "thinking out loud" part
        // Keep thoughts that are meaningful (not too short, not too long)
        if (event.content.length > 5 && event.content.length < 200) {
          narration = event.content;
        }
        break;

      case 'action':
        // Skip most actions - they're too granular
        // Only mention significant navigation events
        const action = event.content.toLowerCase();
        if (action.includes('navigate') || action.includes('go to') || action.includes('open')) {
          // Don't narrate, the thought already explained the plan
        }
        // Skip clicks, typing, scrolling - too robotic
        break;

      case 'taskComplete':
        narration = event.success
          ? "All done!"
          : "Hmm, I ran into a problem. Let me know if you'd like me to try again.";
        break;

      case 'error':
        narration = "Something went wrong. Would you like me to try a different approach?";
        break;

      case 'status':
        // Don't narrate status changes
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
    sendTask
  } = useWebSocket({ onAgentEvent: handleAgentEvent });

  // Start browser agent when avatar becomes ready
  const handleAvatarReady = useCallback(() => {
    if (!hasStartedAgentRef.current) {
      hasStartedAgentRef.current = true;
      startAgent(DEFAULT_URL);
    }
  }, [startAgent]);

  // Reset agent started flag when avatar disconnects
  useEffect(() => {
    if (!isAvatarReady) {
      hasStartedAgentRef.current = false;
    }
  }, [isAvatarReady]);

  if (!showApp) {
    return <LandingPage onLaunchApp={() => setShowApp(true)} />;
  }

  return (
    <div className="app">
      <div className="app-container">
        <div className="left-panel">
          <div className="avatar-section">
            <AvatarContainer onAvatarReady={handleAvatarReady} />
          </div>
          <div className="chat-section">
            <ChatPanel
              messages={messages}
              status={status}
              onSendTask={sendTask}
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
