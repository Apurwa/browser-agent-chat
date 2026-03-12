import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Sidebar from './Sidebar';

export default function ProjectSetup() {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [context, setContext] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const token = await getAccessToken();
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name, url,
        credentials: { username, password },
        context: context || undefined,
      }),
    });

    if (res.ok) {
      const project = await res.json();
      navigate(`/projects/${project.id}/testing`);
    } else {
      setSaving(false);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar disabled />
      <div className="setup-page">
        <h1>Create a new project</h1>
        <p className="setup-subtitle">Set up the target application for your QA agent</p>

        <form onSubmit={handleSubmit} className="setup-form">
          <label>Project Name
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Acme Dashboard" required />
          </label>
          <label>Application URL
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://app.acme.com" required />
          </label>
          <div className="form-row">
            <label>Login Email / Username
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="qa@acme.com" />
            </label>
            <label>Login Password
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </label>
          </div>
          <label>Context <span className="optional">(optional)</span>
            <textarea value={context} onChange={e => setContext(e.target.value)} placeholder="Describe your product for the agent..." rows={3} />
          </label>
          <button type="submit" className="btn-primary" disabled={saving || !name || !url}>
            {saving ? 'Creating...' : 'Create Project'}
          </button>
        </form>
      </div>
    </div>
  );
}
