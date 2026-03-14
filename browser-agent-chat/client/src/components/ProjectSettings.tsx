import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Sidebar from './Sidebar';

export default function ProjectSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [context, setContext] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    const token = await getAccessToken();
    const res = await fetch(`/api/projects/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setName(data.name);
      setUrl(data.url);
      setContext(data.context ?? '');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const token = await getAccessToken();
    const body: Record<string, unknown> = { name, url, context };
    if (newUsername && newPassword) {
      body.credentials = { username: newUsername, password: newPassword };
    }
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setNewUsername('');
    setNewPassword('');
  };

  const handleDelete = async () => {
    const token = await getAccessToken();
    await fetch(`/api/projects/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    navigate('/');
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="settings-page">
        <h1>Project Settings</h1>

        <section className="settings-section">
          <h2>Details</h2>
          <label>Name <input type="text" value={name} onChange={e => setName(e.target.value)} /></label>
          <label>URL <input type="url" value={url} onChange={e => setUrl(e.target.value)} /></label>
          <label>Context <textarea value={context} onChange={e => setContext(e.target.value)} rows={3} /></label>
        </section>

        <section className="settings-section">
          <h2>Credentials</h2>
          <p className="settings-hint">Leave empty to keep existing credentials.</p>
          <div className="form-row">
            <label>Username <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} /></label>
            <label>Password <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
          </div>
        </section>

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>

        <section className="settings-danger">
          <h2>Danger Zone</h2>
          {!showDelete ? (
            <button className="btn-danger" onClick={() => setShowDelete(true)}>Delete Project</button>
          ) : (
            <div>
              <p>Are you sure? This deletes all findings, memory, and sessions.</p>
              <button className="btn-danger" onClick={handleDelete}>Confirm Delete</button>
              <button className="btn-secondary" onClick={() => setShowDelete(false)}>Cancel</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
