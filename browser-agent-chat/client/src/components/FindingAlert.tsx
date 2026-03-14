import { useNavigate, useParams } from 'react-router-dom';
import type { Finding } from '../types';

export default function FindingAlert({ finding }: { finding: Finding }) {
  const navigate = useNavigate();
  const { id } = useParams();

  return (
    <div className="finding-alert">
      <div className="finding-alert-header">
        <span className={`severity-badge severity-${finding.severity}`}>{finding.severity.toUpperCase()}</span>
        <span className={`type-badge type-${finding.type}`}>{finding.type.toUpperCase()}</span>
      </div>
      <p className="finding-alert-title">{finding.title}</p>
      {finding.feature && <p className="finding-alert-meta">{finding.feature}{finding.flow ? ` → ${finding.flow}` : ''}</p>}
      <button className="finding-alert-link" onClick={() => navigate(`/agents/${id}/findings`)}>
        View in Findings →
      </button>
    </div>
  );
}
