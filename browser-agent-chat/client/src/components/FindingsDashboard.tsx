import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import FindingDetail from './FindingDetail';
import { useAuth } from '../hooks/useAuth';
import type { Finding, FindingType, Criticality, FindingStatus } from '../types';

export default function FindingsDashboard() {
  const { id } = useParams();
  const { getAccessToken } = useAuth();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [filterType, setFilterType] = useState<FindingType | ''>('');
  const [filterSeverity, setFilterSeverity] = useState<Criticality | ''>('');
  const [filterStatus, setFilterStatus] = useState<FindingStatus | ''>('');

  useEffect(() => { loadFindings(); }, [id, filterType, filterSeverity, filterStatus]);

  const loadFindings = async () => {
    const token = await getAccessToken();
    const params = new URLSearchParams();
    if (filterType) params.set('type', filterType);
    if (filterSeverity) params.set('severity', filterSeverity);
    if (filterStatus) params.set('status', filterStatus);

    const res = await fetch(`/api/projects/${id}/findings?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setFindings(data.findings);
      setTotal(data.total);
      if (!selected && data.findings.length > 0) setSelected(data.findings[0]);
    }
  };

  const handleStatusUpdate = async (findingId: string, status: FindingStatus) => {
    const token = await getAccessToken();
    const res = await fetch(`/api/projects/${id}/findings/${findingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const { finding } = await res.json();
      setFindings(prev => prev.map(f => f.id === findingId ? finding : f));
      if (selected?.id === findingId) setSelected(finding);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar findingsCount={findings.filter(f => f.status === 'new').length} />
      <div className="findings-content">
        <div className="findings-list">
          <div className="findings-list-header">
            <h2>Findings <span className="count">({total})</span></h2>
            <div className="findings-filters">
              <select value={filterType} onChange={e => setFilterType(e.target.value as FindingType | '')}>
                <option value="">All Types</option>
                <option value="visual">Visual</option>
                <option value="functional">Functional</option>
                <option value="data">Data</option>
                <option value="ux">UX</option>
              </select>
              <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value as Criticality | '')}>
                <option value="">All Severity</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as FindingStatus | '')}>
                <option value="">All Status</option>
                <option value="new">New</option>
                <option value="confirmed">Confirmed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
          </div>
          <div className="findings-items">
            {findings.map(f => (
              <div
                key={f.id}
                className={`finding-item ${selected?.id === f.id ? 'active' : ''} ${f.status === 'dismissed' ? 'dismissed' : ''}`}
                onClick={() => setSelected(f)}
              >
                <div className="finding-item-badges">
                  <span className={`severity-badge severity-${f.severity}`}>{f.severity.toUpperCase()}</span>
                  <span className={`type-badge type-${f.type}`}>{f.type.toUpperCase()}</span>
                  {f.status === 'dismissed' && <span className="status-dismissed">Dismissed</span>}
                </div>
                <div className={`finding-item-title ${f.status === 'dismissed' ? 'strikethrough' : ''}`}>{f.title}</div>
                {f.feature && <div className="finding-item-meta">{f.feature}{f.flow ? ` → ${f.flow}` : ''}</div>}
              </div>
            ))}
          </div>
        </div>
        {selected && (
          <FindingDetail
            finding={selected}
            onConfirm={() => handleStatusUpdate(selected.id, 'confirmed')}
            onDismiss={() => handleStatusUpdate(selected.id, 'dismissed')}
          />
        )}
      </div>
    </div>
  );
}
