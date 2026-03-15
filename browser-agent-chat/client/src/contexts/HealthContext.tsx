import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface HealthState {
  langfuseEnabled: boolean;
  loading: boolean;
}

const HealthContext = createContext<HealthState>({ langfuseEnabled: false, loading: true });

export function useHealth(): HealthState {
  return useContext(HealthContext);
}

export function HealthProvider({ children }: { children: ReactNode }) {
  const [langfuseEnabled, setLangfuseEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/health')
      .then(res => res.json())
      .then(data => {
        setLangfuseEnabled(data.langfuseEnabled ?? false);
      })
      .catch(() => {
        // Health check failed — assume features disabled
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <HealthContext.Provider value={{ langfuseEnabled, loading }}>
      {children}
    </HealthContext.Provider>
  );
}
