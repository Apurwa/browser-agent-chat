import { useEffect, useRef } from 'react';
import { useAssistant } from '../../contexts/AssistantContext';
import { AvatarVideo } from './AvatarVideo';
import { ASSISTANT_GREETING } from '../../types/assistant';
import './Avatar.css';

interface AvatarContainerProps {
  onAvatarReady?: () => void;
}

export function AvatarContainer({ onAvatarReady }: AvatarContainerProps) {
  const {
    avatarState,
    avatarVideoRef,
    initializeAvatar,
    speakText,
    interruptSpeaking,
    disconnectAvatar,
    isSpeaking,
    error,
    clearError,
  } = useAssistant();

  const hasGreetedRef = useRef(false);
  const isConnected = avatarState !== 'disconnected' && avatarState !== 'error';
  const isLoading = avatarState === 'loading';

  // Greet when avatar becomes ready
  useEffect(() => {
    if (avatarState === 'ready' && !hasGreetedRef.current) {
      hasGreetedRef.current = true;
      speakText(ASSISTANT_GREETING).then(() => {
        onAvatarReady?.();
      });
    }
  }, [avatarState, speakText, onAvatarReady]);

  // Reset greeting flag when disconnected
  useEffect(() => {
    if (avatarState === 'disconnected') {
      hasGreetedRef.current = false;
    }
  }, [avatarState]);

  const handleStartClick = async () => {
    clearError();
    hasGreetedRef.current = false;
    await initializeAvatar();
  };

  const handleStopClick = async () => {
    await disconnectAvatar();
  };

  const handleInterruptClick = async () => {
    await interruptSpeaking();
  };

  return (
    <div className="avatar-container">
      <div className="avatar-header">
        <h3>AI Assistant</h3>
        <div className="avatar-status">
          <span className={`status-dot ${avatarState}`} />
          <span className="status-text">{getStatusText(avatarState)}</span>
        </div>
      </div>

      <AvatarVideo videoRef={avatarVideoRef} state={avatarState} />

      {error && (
        <div className="avatar-error-message">
          <p>{error}</p>
          <button onClick={clearError} className="error-dismiss">
            Dismiss
          </button>
        </div>
      )}

      <div className="avatar-controls">
        {!isConnected ? (
          <button
            onClick={handleStartClick}
            disabled={isLoading}
            className="avatar-btn avatar-btn-primary"
          >
            {isLoading ? 'Connecting...' : 'Start Assistant'}
          </button>
        ) : (
          <>
            {isSpeaking && (
              <button
                onClick={handleInterruptClick}
                className="avatar-btn avatar-btn-secondary"
              >
                Interrupt
              </button>
            )}
            <button
              onClick={handleStopClick}
              className="avatar-btn avatar-btn-danger"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function getStatusText(state: string): string {
  const statusMap: Record<string, string> = {
    disconnected: 'Offline',
    loading: 'Connecting',
    ready: 'Ready',
    speaking: 'Speaking',
    listening: 'Listening',
    error: 'Error',
  };
  return statusMap[state] || state;
}
