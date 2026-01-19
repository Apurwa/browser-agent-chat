import type { AgentStatus } from '../types';

interface BrowserViewProps {
  screenshot: string | null;
  currentUrl: string | null;
  status: AgentStatus;
}

export function BrowserView({ screenshot, currentUrl, status }: BrowserViewProps) {
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
            src={screenshot}
            alt="Browser view"
            className="browser-screenshot"
          />
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
