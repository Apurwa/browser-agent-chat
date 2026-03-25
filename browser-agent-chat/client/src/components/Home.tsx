import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSidebar } from '../contexts/SidebarContext';
import { apiAuthFetch } from '../lib/api';
import { deriveProjectName } from '../lib/url-utils';
import Omnibox from './Omnibox';
import './Home.css';

export default function Home() {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [omniboxHasInput, setOmniboxHasInput] = useState(false);

  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const { agents, refreshAgents, omniboxActiveRef } = useSidebar();

  // Signal that the omnibox is active on this page
  useEffect(() => {
    omniboxActiveRef.current = true;
    return () => {
      omniboxActiveRef.current = false;
    };
  }, [omniboxActiveRef]);

  const handleCreateAgent = useCallback(async (url: string) => {
    if (!url.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);

    // Normalize URL: prepend https:// if no protocol
    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      const token = await getAccessToken();
      const name = deriveProjectName(normalizedUrl);
      const res = await apiAuthFetch('/api/agents', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url: normalizedUrl }),
      });

      if (res.ok) {
        const agent = await res.json();
        refreshAgents();
        navigate(`/agents/${agent.id}/testing`, { state: { autoStart: true } });
      } else {
        setError('Failed to create agent. Please try again.');
        setIsCreating(false);
      }
    } catch {
      setError('Network error. Please check your connection.');
      setIsCreating(false);
    }
  }, [isCreating, getAccessToken, refreshAgents, navigate]);

  return (
    <div className="home-page">
      {/* Center content */}
      <div className="home-center">
        <h1 className="home-headline">What do you want to test?</h1>

        <Omnibox
          onCreateAgent={handleCreateAgent}
          isCreating={isCreating}
          error={error}
          onInputChange={setOmniboxHasInput}
        />

        {isCreating && (
          <p className="home-status-text">Creating agent &amp; launching browser...</p>
        )}

        {!isCreating && (
          <div style={{ visibility: omniboxHasInput ? 'hidden' : 'visible' }}>
            <div className="home-chips">
              <span className="home-chip">Explore &amp; learn features</span>
              <span className="home-chip">Test a specific flow</span>
              <span className="home-chip">Find bugs</span>
            </div>

            {agents.length === 0 && (
              <p className="home-hint">Paste any web app URL to get started</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
