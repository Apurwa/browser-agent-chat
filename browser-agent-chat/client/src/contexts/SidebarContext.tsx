import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import type { AgentListItem } from '../types';

interface SidebarContextValue {
  agents: AgentListItem[];
  agentsLoading: boolean;
  agentsError: string | null;
  refreshAgents: () => Promise<void>;
  omniboxActiveRef: React.RefObject<boolean>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const omniboxActiveRef = useRef(false);

  const refreshAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch('/api/agents', token);
      if (!res.ok) {
        throw new Error(`Failed to fetch agents: ${res.status}`);
      }
      const data = await res.json();
      const agentList = data.agents as AgentListItem[];
      const sorted = agentList.sort((a, b) => {
        const aTime = a.last_session_at ?? a.created_at;
        const bTime = b.last_session_at ?? b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });
      setAgents(sorted);
    } catch (err) {
      setAgentsError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setAgentsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  return (
    <SidebarContext.Provider value={{ agents, agentsLoading, agentsError, refreshAgents, omniboxActiveRef }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return ctx;
}
