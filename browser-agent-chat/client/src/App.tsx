import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './components/LoginPage';
import ProjectList from './components/ProjectList';
import ProjectSetup from './components/ProjectSetup';
import TestingView from './components/TestingView';
import FindingsDashboard from './components/FindingsDashboard';
import MemoryViewer from './components/MemoryViewer';
import ProjectSettings from './components/ProjectSettings';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/projects" replace /> : <LoginPage />} />
      <Route path="/projects" element={<ProtectedRoute><ProjectList /></ProtectedRoute>} />
      <Route path="/projects/new" element={<ProtectedRoute><ProjectSetup /></ProtectedRoute>} />
      <Route path="/projects/:id/testing" element={<ProtectedRoute><TestingView /></ProtectedRoute>} />
      <Route path="/projects/:id/findings" element={<ProtectedRoute><FindingsDashboard /></ProtectedRoute>} />
      <Route path="/projects/:id/memory" element={<ProtectedRoute><MemoryViewer /></ProtectedRoute>} />
      <Route path="/projects/:id/settings" element={<ProtectedRoute><ProjectSettings /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to={user ? '/projects' : '/login'} replace />} />
    </Routes>
  );
}
