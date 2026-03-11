import { useNavigate, useLocation, useParams } from 'react-router-dom';

interface SidebarProps {
  findingsCount?: number;
  disabled?: boolean;
}

export default function Sidebar({ findingsCount = 0, disabled = false }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const isActive = (path: string) => location.pathname.includes(path);

  const navTo = (path: string) => {
    if (!disabled && id) navigate(`/projects/${id}/${path}`);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-logo" onClick={() => navigate('/projects')}>QA</div>
      <div
        className={`sidebar-item ${isActive('testing') ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => navTo('testing')}
        title="Testing"
      >
        <span role="img" aria-label="Testing">&#x1F9EA;</span>
      </div>
      <div
        className={`sidebar-item ${isActive('findings') ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => navTo('findings')}
        title="Findings"
      >
        <span role="img" aria-label="Findings">&#x1F41B;</span>
        {findingsCount > 0 && <span className="sidebar-badge">{findingsCount}</span>}
      </div>
      <div
        className={`sidebar-item ${isActive('memory') ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => navTo('memory')}
        title="Memory"
      >
        <span role="img" aria-label="Memory">&#x1F9E0;</span>
      </div>
      <div className="sidebar-spacer" />
      <div
        className={`sidebar-item ${isActive('settings') ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => navTo('settings')}
        title="Settings"
      >
        <span role="img" aria-label="Settings">&#x2699;&#xFE0F;</span>
      </div>
    </div>
  );
}
