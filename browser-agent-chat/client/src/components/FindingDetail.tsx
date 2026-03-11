import type { Finding } from '../types';

interface FindingDetailProps {
  finding: Finding;
  onConfirm: () => void;
  onDismiss: () => void;
}

export default function FindingDetail({ finding, onConfirm, onDismiss }: FindingDetailProps) {
  return (
    <div className="finding-detail">
      <div className="finding-detail-header">
        <div className="finding-detail-badges">
          <span className={`severity-badge severity-${finding.severity}`}>{finding.severity.toUpperCase()}</span>
          <span className={`type-badge type-${finding.type}`}>{finding.type.toUpperCase()}</span>
        </div>
        <h2>{finding.title}</h2>
        <p className="finding-detail-meta">
          {finding.feature}{finding.flow ? ` → ${finding.flow}` : ''} · Found {new Date(finding.created_at).toLocaleString()}
        </p>
      </div>

      {finding.screenshot_url && (
        <div className="finding-detail-section">
          <h3>Screenshot</h3>
          <img src={finding.screenshot_url} alt="Finding screenshot" className="finding-screenshot" />
        </div>
      )}

      <div className="finding-detail-comparison">
        <div className="expected">
          <h3>Expected</h3>
          <p>{finding.expected_behavior || 'Not specified'}</p>
        </div>
        <div className="actual">
          <h3>Actual</h3>
          <p>{finding.actual_behavior || 'Not specified'}</p>
        </div>
      </div>

      {finding.steps_to_reproduce.length > 0 && (
        <div className="finding-detail-section">
          <h3>Steps to Reproduce</h3>
          <ol className="repro-steps">
            {finding.steps_to_reproduce.map((step, i) => (
              <li key={i}>{step.action}{step.target ? ` → ${step.target}` : ''}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="finding-detail-actions">
        {finding.status === 'new' && (
          <>
            <button className="btn-confirm" onClick={onConfirm}>Confirm Bug</button>
            <button className="btn-dismiss" onClick={onDismiss}>Dismiss</button>
          </>
        )}
        <button className="btn-jira" disabled>Create JIRA Ticket (coming soon)</button>
      </div>
    </div>
  );
}
