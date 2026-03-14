import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './components/LoginPage';
import Home from './components/Home';
import TestingView from './components/TestingView';
import FindingsDashboard from './components/FindingsDashboard';
import MemoryViewer from './components/MemoryViewer';
import AgentSettings from './components/AgentSettings';
import EvalDashboard from './components/EvalDashboard';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
      <Route path="/agents/:id/testing" element={<ProtectedRoute><TestingView /></ProtectedRoute>} />
      <Route path="/agents/:id/findings" element={<ProtectedRoute><FindingsDashboard /></ProtectedRoute>} />
      <Route path="/agents/:id/memory" element={<ProtectedRoute><MemoryViewer /></ProtectedRoute>} />
      <Route path="/agents/:id/settings" element={<ProtectedRoute><AgentSettings /></ProtectedRoute>} />
      <Route path="/agents/:id/evals" element={<ProtectedRoute><EvalDashboard /></ProtectedRoute>} />
      <Route path="/projects/*" element={<Navigate to={window.location.pathname.replace('/projects/', '/agents/')} replace />} />
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}
