import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { isAuthEnabled } from '../lib/supabase';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  // If auth is not enabled, allow access without authentication
  if (!isAuthEnabled()) {
    return <>{children}</>;
  }

  if (loading) {
    return <div className="loading-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
