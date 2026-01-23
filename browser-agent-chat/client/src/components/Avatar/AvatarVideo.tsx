import type { AvatarState } from '../../types/assistant';
import './Avatar.css';

interface AvatarVideoProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  state: AvatarState;
}

export function AvatarVideo({ videoRef, state }: AvatarVideoProps) {
  const isLoading = state === 'loading';
  const isDisconnected = state === 'disconnected';
  const hasError = state === 'error';

  return (
    <div className="avatar-video-wrapper">
      {isLoading && (
        <div className="avatar-loading">
          <div className="avatar-loading-spinner" />
          <p>Connecting to assistant...</p>
        </div>
      )}

      {isDisconnected && !isLoading && (
        <div className="avatar-placeholder">
          <div className="avatar-placeholder-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
              <path
                d="M4 20C4 16.6863 7.58172 14 12 14C16.4183 14 20 16.6863 20 20"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p>Click Start to connect</p>
        </div>
      )}

      {hasError && (
        <div className="avatar-error">
          <div className="avatar-error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
            </svg>
          </div>
          <p>Connection error</p>
        </div>
      )}

      <video
        ref={videoRef}
        className={`avatar-video ${!isLoading && !isDisconnected && !hasError ? 'visible' : ''}`}
        autoPlay
        playsInline
        muted={false}
      />

      {state === 'speaking' && (
        <div className="avatar-speaking-indicator">
          <span className="speaking-dot" />
          <span className="speaking-dot" />
          <span className="speaking-dot" />
        </div>
      )}
    </div>
  );
}
