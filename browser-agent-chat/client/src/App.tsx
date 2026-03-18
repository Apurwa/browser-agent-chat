import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { HealthProvider } from './contexts/HealthContext';
import ProtectedRoute from './components/ProtectedRoute';
import SidebarLayout from './components/SidebarLayout';
import LoginPage from './components/LoginPage';
import Home from './components/Home';
import TestingView from './components/TestingView';
import FindingsDashboard from './components/FindingsDashboard';
import MemoryViewer from './components/MemoryViewer';
import AgentSettings from './components/AgentSettings';
import EvalDashboard from './components/EvalDashboard';
import ObservabilityPanel from './components/ObservabilityPanel';
import ObservabilityDashboard from './components/ObservabilityDashboard';
import VaultPage from './components/Vault/VaultPage';
import AgentDetailLayout from './components/AgentDetailLayout';
import { useHealth } from './contexts/HealthContext';

function TracesGuard() {
  const { langfuseEnabled, loading } = useHealth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!langfuseEnabled) return <Navigate to="testing" replace />;
  return <ObservabilityPanel />;
}

function DashboardGuard() {
  const { langfuseEnabled, loading } = useHealth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!langfuseEnabled) return <Navigate to="/" replace />;
  return <ObservabilityDashboard />;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <HealthProvider>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route element={<ProtectedRoute><SidebarLayout /></ProtectedRoute>}>
          <Route index element={<Home />} />
          <Route path="/agents/:id" element={<AgentDetailLayout />}>
            <Route path="testing" element={<TestingView />} />
            <Route path="findings" element={<FindingsDashboard />} />
            <Route path="memory" element={<MemoryViewer />} />
            <Route path="settings" element={<AgentSettings />} />
            <Route path="evals" element={<EvalDashboard />} />
            <Route path="traces" element={<TracesGuard />} />
            <Route index element={<Navigate to="testing" replace />} />
          </Route>
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/observability" element={<DashboardGuard />} />
        </Route>
        <Route path="/projects/*" element={<Navigate to={window.location.pathname.replace('/projects/', '/agents/')} replace />} />
        <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
      </Routes>
    </HealthProvider>
  );
}
