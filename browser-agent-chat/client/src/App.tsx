import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { ChatPanel } from './components/ChatPanel';
import { BrowserView } from './components/BrowserView';
import { LandingPage } from './components/LandingPage';

function App() {
  const [showApp, setShowApp] = useState(false);

  const {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    startAgent,
    sendTask,
    stopAgent
  } = useWebSocket();

  if (!showApp) {
    return <LandingPage onLaunchApp={() => setShowApp(true)} />;
  }

  return (
    <div className="app">
      <div className="app-container">
        <ChatPanel
          messages={messages}
          status={status}
          onSendTask={sendTask}
          onStartAgent={startAgent}
          onStopAgent={stopAgent}
          currentUrl={currentUrl}
        />
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

export default App;
