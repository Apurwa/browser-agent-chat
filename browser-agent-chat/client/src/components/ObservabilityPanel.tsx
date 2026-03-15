import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../hooks/useAuth';
import './ObservabilityPanel.css';

interface TraceSummary {
  id: string;
  name: string;
  input: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  observationCount: number;
  timestamp: string;
  sessionId: string | null;
}

interface TraceObservation {
  name: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  model: string | null;
  tokenCount: number | null;
  level: string;
}

interface TraceDetail {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  latency: number | null;
  totalCost: number | null;
  status: 'success' | 'error';
  timestamp: string;
  observations: TraceObservation[];
}

interface SessionGroup {
  sessionId: string | null;
  startedAt: string | null;
  traces: TraceSummary[];
}

function formatLatency(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(1)}s`;
}

function formatCost(cost: number | null): string {
  if (cost === null) return '—';
  return `$${cost.toFixed(2)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getInputText(input: unknown): string {
  if (!input) return 'unnamed';
  if (typeof input === 'string') return input;
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    return (obj.task ?? obj.username ?? obj.context ?? obj.prompt ?? JSON.stringify(input)) as string;
  }
  return String(input);
}

function getOutputText(output: unknown): string {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;
    if (obj.error) return String(obj.error);
    return JSON.stringify(output, null, 2);
  }
  return String(output);
}

export default function ObservabilityPanel() {
  const { id } = useParams();
  const { getAccessToken } = useAuth();

  const [sessions, setSessions] = useState<SessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set());

  // Fetch trace list (reset detail state when agent changes)
  useEffect(() => {
    setSelectedTraceId(null);
    setTraceDetail(null);
    loadTraces();
  }, [id]);

  const loadTraces = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/agents/${id}/traces?page=1&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traces');
    } finally {
      setLoading(false);
    }
  };

  // Fetch trace detail
  const selectTrace = async (traceId: string) => {
    setSelectedTraceId(traceId);
    setDetailLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/agents/${id}/traces/${traceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTraceDetail(data);
    } catch {
      setTraceDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleSession = (sessionId: string) => {
    setCollapsedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const totalTraces = sessions.reduce((sum, s) => sum + s.traces.length, 0);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="observability-content">
        {/* Left panel — trace list */}
        <div className="traces-list">
          <div className="traces-list-header">
            <h2>Traces <span className="count">({totalTraces})</span></h2>
          </div>

          <div className="traces-items">
            {loading && <div className="traces-loading">Loading traces...</div>}
            {error && <div className="traces-error">{error}</div>}
            {!loading && !error && sessions.length === 0 && (
              <div className="traces-empty">
                No traces yet. Run a task to see observability data here.
              </div>
            )}

            {sessions.map(session => {
              const key = session.sessionId ?? '__no_session__';
              const collapsed = collapsedSessions.has(key);
              return (
                <div key={key} className="session-group">
                  <div
                    className="session-header"
                    onClick={() => toggleSession(key)}
                  >
                    <div className="session-header-left">
                      <span className="chevron">{collapsed ? '\u25B6' : '\u25BC'}</span>
                      <span>
                        {session.startedAt
                          ? `Session — ${formatTime(session.startedAt)}`
                          : 'No Session'}
                      </span>
                    </div>
                    <span className="session-header-count">
                      {session.traces.length} trace{session.traces.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {!collapsed && session.traces.map(trace => (
                    <div
                      key={trace.id}
                      className={`trace-item status-${trace.status} ${selectedTraceId === trace.id ? 'active' : ''}`}
                      onClick={() => selectTrace(trace.id)}
                    >
                      <div className="trace-item-left">
                        <div className="trace-item-name">{getInputText(trace.input)}</div>
                        <div className="trace-item-meta">
                          <span className={`trace-type-badge type-${trace.name}`}>
                            {trace.name}
                          </span>
                          <span className="trace-item-steps">
                            {trace.observationCount} step{trace.observationCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="trace-item-right">
                        <div className={`trace-item-latency status-${trace.status}`}>
                          {formatLatency(trace.latency)}
                        </div>
                        <div className="trace-item-cost">
                          {formatCost(trace.totalCost)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel — trace detail */}
        {!selectedTraceId && (
          <div className="trace-detail-empty">Select a trace to view details</div>
        )}

        {selectedTraceId && detailLoading && (
          <div className="trace-detail-empty">Loading...</div>
        )}

        {selectedTraceId && !detailLoading && traceDetail && (
          <div className="trace-detail">
            {/* Header */}
            <div className="trace-detail-header">
              <div className="trace-detail-title-row">
                <span className="trace-detail-title">{getInputText(traceDetail.input)}</span>
                <span className={`trace-status-badge status-${traceDetail.status}`}>
                  {traceDetail.status === 'success' ? 'SUCCESS' : 'FAILED'}
                </span>
              </div>
              <div className="trace-detail-timestamp">{formatTime(traceDetail.timestamp)}</div>
            </div>

            {/* Summary stats */}
            <div className="trace-stats">
              <div className="trace-stat">
                <div className={`trace-stat-value ${traceDetail.status === 'error' ? 'status-error' : ''}`}>
                  {formatLatency(traceDetail.latency)}
                </div>
                <div className="trace-stat-label">Total Latency</div>
              </div>
              <div className="trace-stat">
                <div className="trace-stat-value">{formatCost(traceDetail.totalCost)}</div>
                <div className="trace-stat-label">Total Cost</div>
              </div>
              <div className="trace-stat">
                <div className="trace-stat-value">{traceDetail.observations.length}</div>
                <div className="trace-stat-label">Steps</div>
              </div>
            </div>

            {/* Span tree */}
            {traceDetail.observations.length > 0 && (
              <>
                <div className="span-tree-title">Span Tree</div>
                <div className="span-list">
                  {(() => {
                    const maxDuration = Math.max(
                      ...traceDetail.observations.map(o => o.duration ?? 0),
                      0.001
                    );
                    return traceDetail.observations.map((obs, i) => {
                      const level = obs.level === 'ERROR' ? 'error' : 'default';
                      const pct = obs.duration ? (obs.duration / maxDuration) * 100 : 0;
                      const metaParts = [obs.model, obs.tokenCount ? `${obs.tokenCount.toLocaleString()} tokens` : null]
                        .filter(Boolean).join(' \u00B7 ');

                      return (
                        <div key={i} className={`span-item level-${level}`}>
                          <div className={`span-number level-${level}`}>{i + 1}</div>
                          <div className="span-info">
                            <div className="span-name">{obs.name ?? 'unnamed'}</div>
                            {(metaParts || level === 'error') && <div className="span-meta">
                              {metaParts}
                              {level === 'error' && <>{metaParts ? ' \u00B7 ' : ''}<span style={{ color: 'var(--color-error)' }}>ERROR</span></>}
                            </div>}
                          </div>
                          <div className="span-duration-bar">
                            <div
                              className={`span-duration-fill level-${level}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="span-duration-text">{formatLatency(obs.duration)}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </>
            )}

            {/* Error output */}
            {traceDetail.status === 'error' && Boolean(traceDetail.output) && (
              <div className="trace-error-output">
                <div className="trace-error-output-title">Error Output</div>
                <div className="trace-error-output-content">
                  {getOutputText(traceDetail.output)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
