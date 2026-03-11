import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { isAuthEnabled } from './lib/supabase';
import { ChatPanel } from './components/ChatPanel';
import { BrowserView } from './components/BrowserView';
import { LandingPage } from './components/LandingPage';
import { LoginPage } from './components/LoginPage';

function App() {
  const [showApp, setShowApp] = useState(false);
  const { user, session, loading, signInWithGitHub, signOut } = useAuth();

  const {
    connected,
    status,
    screenshot,
    currentUrl,
    messages,
    accessDenied,
    startAgent,
    sendTask,
    stopAgent
  } = useWebSocket(session?.access_token);

  // Show loading while checking auth state
  if (isAuthEnabled() && loading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p style={{ color: '#888' }}>Loading...</p>
      </div>
    );
  }

  // Auth gate: if auth is enabled and no session, show login
  if (isAuthEnabled() && !session) {
    return <LoginPage onSignIn={signInWithGitHub} />;
  }

  // If authenticated but access denied by server
  if (accessDenied) {
    return <LoginPage onSignIn={signInWithGitHub} accessDenied onSignOut={signOut} />;
  }

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
      {user && (
        <div className="user-bar">
          <span>{user.user_metadata?.user_name}</span>
          <button onClick={signOut} className="signout-btn">Sign out</button>
        </div>
      )}
      {!connected && (
        <div className="connection-banner">
          Connecting to server...
        </div>
      )}
    </div>
  );
}

export default App;
