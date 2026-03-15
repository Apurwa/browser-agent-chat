import { useRef, useEffect } from 'react';
import type { AgentStatus } from '../types';

interface BrowserViewProps {
  screenshot: string | null;
  currentUrl: string | null;
  status: AgentStatus;
}

export function BrowserView({ screenshot, currentUrl, status }: BrowserViewProps) {
  const isStarting = status === 'working' && !screenshot;
  const imgRef = useRef<HTMLImageElement>(null);

  // Update img.src directly to avoid React re-render on every screencast frame
  useEffect(() => {
    if (imgRef.current && screenshot) {
      imgRef.current.src = screenshot;
    }
  }, [screenshot]);

  return (
    <div className="browser-view">
      <div className="browser-header">
        <div className="browser-controls">
          <span className="browser-dot red" />
          <span className="browser-dot yellow" />
          <span className="browser-dot green" />
        </div>
        <div className="browser-url-bar">
          {currentUrl || 'No page loaded'}
        </div>
        <div className={`browser-status ${status}`}>
          {status === 'working' && <span className="spinner" />}
        </div>
      </div>

      <div className="browser-content">
        {screenshot ? (
          <img
            ref={imgRef}
            alt="Browser view"
            className={`browser-screenshot${status === 'working' ? ' browser-screenshot-reconnecting' : ''}`}
          />
        ) : isStarting ? (
          <div className="browser-loading">
            <div className="browser-loading-spinner" />
            <p className="browser-loading-text">Launching browser...</p>
            <p className="browser-loading-subtext">This usually takes a few seconds</p>
          </div>
        ) : (
          <div className="browser-placeholder">
            <p>No browser session active</p>
            <p>Start an agent to see the browser view</p>
          </div>
        )}
      </div>
    </div>
  );
}
