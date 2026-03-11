import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { ProjectListItem } from '../types';

export default function ProjectList() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const token = await getAccessToken();
    const res = await fetch('/api/projects', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setProjects(data.projects);
    }
    setLoading(false);
  };

  if (loading) return <div className="loading-screen">Loading projects...</div>;

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <h2>No projects yet</h2>
        <p>Create your first project to start testing.</p>
        <button className="btn-primary" onClick={() => navigate('/projects/new')}>
          Create Project
        </button>
      </div>
    );
  }

  return (
    <div className="project-list-page">
      <div className="project-list-header">
        <h1>Projects</h1>
        <button className="btn-primary" onClick={() => navigate('/projects/new')}>
          + New Project
        </button>
      </div>
      <div className="project-grid">
        {projects.map(p => (
          <div key={p.id} className="project-card" onClick={() => navigate(`/projects/${p.id}/testing`)}>
            <h3>{p.name}</h3>
            <p className="project-url">{p.url}</p>
            <div className="project-meta">
              <span>{p.findings_count} findings</span>
              {p.last_session_at && <span>Last tested {new Date(p.last_session_at).toLocaleDateString()}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
