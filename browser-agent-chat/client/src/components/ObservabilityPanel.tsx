import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
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
  id: string;
  type: 'GENERATION' | 'SPAN';
  name: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  model: string | null;
  tokenCount: number | null;
  level: string;
  input: unknown;
  output: unknown;
  metadata: Record<string, unknown> | null;
  statusMessage: string | null;
  parentObservationId: string | null;
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

function summarizeData(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data.length > 120 ? data.slice(0, 120) + '…' : data;
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') {
        parts.push(`${k}: ${v.length > 60 ? v.slice(0, 60) + '…' : v}`);
      } else if (typeof v === 'boolean' || typeof v === 'number') {
        parts.push(`${k}: ${v}`);
      } else if (Array.isArray(v)) {
        parts.push(`${k}: [${v.length} items]`);
      } else {
        parts.push(`${k}: {…}`);
      }
      if (parts.join(', ').length > 140) break;
    }
    return parts.join(', ');
  }
  return String(data);
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
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());

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

                    // Build tree: group children under parents
                    const rootObs = traceDetail.observations.filter(o => !o.parentObservationId);
                    const childMap = new Map<string, TraceObservation[]>();
                    for (const obs of traceDetail.observations) {
                      if (obs.parentObservationId) {
                        const siblings = childMap.get(obs.parentObservationId) ?? [];
                        siblings.push(obs);
                        childMap.set(obs.parentObservationId, siblings);
                      }
                    }

                    const renderObs = (obs: TraceObservation, idx: number, depth: number) => {
                      const level = obs.level === 'ERROR' ? 'error' : 'default';
                      const pct = obs.duration ? (obs.duration / maxDuration) * 100 : 0;
                      const typeLabel = obs.type === 'GENERATION' ? 'LLM' : 'SPAN';
                      const metaParts = [
                        typeLabel,
                        obs.model,
                        obs.tokenCount ? `${obs.tokenCount.toLocaleString()} tokens` : null,
                      ].filter(Boolean).join(' \u00B7 ');

                      const children = childMap.get(obs.id) ?? [];
                      const inputSummary = obs.input ? summarizeData(obs.input) : null;
                      const outputSummary = obs.output ? summarizeData(obs.output) : null;

                      const spanKey = obs.id ?? `${idx}-${depth}`;
                      const isExpanded = expandedSpans.has(spanKey);
                      const toggleExpand = () => {
                        setExpandedSpans(prev => {
                          const next = new Set(prev);
                          if (next.has(spanKey)) next.delete(spanKey);
                          else next.add(spanKey);
                          return next;
                        });
                      };

                      return (
                        <div key={spanKey}>
                          <div
                            className={`span-item level-${level}${isExpanded ? ' span-item-expanded' : ''}`}
                            style={{ paddingLeft: `${12 + depth * 20}px`, cursor: 'pointer' }}
                            onClick={toggleExpand}
                          >
                            <div className={`span-type-badge ${obs.type === 'GENERATION' ? 'span-type-llm' : 'span-type-span'}`}>
                              {typeLabel}
                            </div>
                            <div className="span-info">
                              <div className="span-name">{obs.name ?? 'unnamed'}</div>
                              <div className="span-meta">
                                {metaParts}
                                {level === 'error' && <>{metaParts ? ' \u00B7 ' : ''}<span style={{ color: 'var(--color-error)' }}>ERROR</span></>}
                                {obs.statusMessage && <span style={{ color: 'var(--color-error)' }}> — {obs.statusMessage}</span>}
                              </div>
                              {!isExpanded && inputSummary && (
                                <div className="span-data-row">
                                  <span className="span-data-label">in:</span>
                                  <span className="span-data-value">{inputSummary}</span>
                                </div>
                              )}
                              {!isExpanded && outputSummary && (
                                <div className="span-data-row">
                                  <span className="span-data-label">out:</span>
                                  <span className="span-data-value">{outputSummary}</span>
                                </div>
                              )}
                            </div>
                            <div className="span-duration-bar">
                              <div
                                className={`span-duration-fill level-${level}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="span-duration-text">{formatLatency(obs.duration)}</div>
                          </div>
                          {isExpanded && (
                            <div className="span-expanded-detail" style={{ marginLeft: `${32 + depth * 20}px` }}>
                              {obs.input != null && (
                                <div className="span-detail-section">
                                  <div className="span-detail-label">Input</div>
                                  <pre className="span-detail-json">{JSON.stringify(obs.input, null, 2)}</pre>
                                </div>
                              )}
                              {obs.output != null && (
                                <div className="span-detail-section">
                                  <div className="span-detail-label">Output</div>
                                  <pre className="span-detail-json">{JSON.stringify(obs.output, null, 2)}</pre>
                                </div>
                              )}
                              {obs.metadata != null && Object.keys(obs.metadata).length > 0 && (
                                <div className="span-detail-section">
                                  <div className="span-detail-label">Metadata</div>
                                  <pre className="span-detail-json">{JSON.stringify(obs.metadata, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          )}
                          {children.map((child, ci) => renderObs(child, ci, depth + 1))}
                        </div>
                      );
                    };

                    return rootObs.map((obs, i) => renderObs(obs, i, 0));
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
  );
}
