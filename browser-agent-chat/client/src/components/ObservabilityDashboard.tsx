import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  Legend, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { apiAuthFetch } from '../lib/api';
import './ObservabilityDashboard.css';

interface Summary {
  totalTraces: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
  p95Latency: number;
}

interface Trends {
  cost: Record<string, string | number>[];
  traces: Record<string, string | number>[];
  agents: string[];
}

interface AgentRow {
  agentId: string;
  agentName: string;
  traceCount: number;
  totalCost: number;
  errorRate: number;
  avgLatency: number;
}

type SortKey = 'traceCount' | 'totalCost' | 'errorRate' | 'avgLatency' | 'agentName';
type SortDir = 'asc' | 'desc';

// CSS vars can't be used directly in Recharts SVG fills — use theme-aware hex arrays
const CHART_HEX_DARK = ['#3b82f6','#eab308','#22c55e','#ef4444','#a855f7','#f97316','#06b6d4','#ec4899'];
const CHART_HEX_LIGHT = ['#2563eb','#ca8a04','#16a34a','#dc2626','#9333ea','#ea580c','#0891b2','#db2777'];

function formatDateForInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function ObservabilityDashboard() {
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const { theme } = useTheme();

  // Date range state
  const [preset, setPreset] = useState<7 | 30 | 90 | null>(30);
  const [fromDate, setFromDate] = useState(formatDateForInput(daysAgo(30)));
  const [toDate, setToDate] = useState(formatDateForInput(new Date()));

  // Data state
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Table sort
  const [sortKey, setSortKey] = useState<SortKey>('traceCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const params = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

      const [summaryRes, trendsRes, agentsRes] = await Promise.all([
        apiAuthFetch(`/api/observability/summary?${params}`, token),
        apiAuthFetch(`/api/observability/trends?${params}`, token),
        apiAuthFetch(`/api/observability/agents?${params}`, token),
      ]);

      if (!summaryRes.ok || !trendsRes.ok || !agentsRes.ok) {
        const errData = await (summaryRes.ok ? trendsRes.ok ? agentsRes : trendsRes : summaryRes).json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to fetch observability data');
      }

      const [summaryData, trendsData, agentsData] = await Promise.all([
        summaryRes.json(),
        trendsRes.json(),
        agentsRes.json(),
      ]);

      setSummary(summaryData);
      setTrends(trendsData);
      setAgents(agentsData.agents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchData(fromDate, toDate);
  }, [fromDate, toDate, fetchData]);

  const handlePreset = (days: 7 | 30 | 90) => {
    setPreset(days);
    setFromDate(formatDateForInput(daysAgo(days)));
    setToDate(formatDateForInput(new Date()));
  };

  const handleFromChange = (val: string) => {
    setFromDate(val);
    setPreset(null);
  };

  const handleToChange = (val: string) => {
    setToDate(val);
    setPreset(null);
  };

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'agentName' ? 'asc' : 'desc');
    }
  };

  const sortedAgents = [...agents].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'agentName') return dir * a.agentName.localeCompare(b.agentName);
    return dir * (a[sortKey] - b[sortKey]);
  });

  const colors = theme === 'light' ? CHART_HEX_LIGHT : CHART_HEX_DARK;
  const isEmpty = !loading && summary && summary.totalTraces === 0;

  return (
    <div className="obs-dashboard">
      {/* Header */}
      <div className="obs-header">
        <div className="obs-header-left">
          <button className="obs-back-link" onClick={() => navigate('/')}>
            &larr; Home
          </button>
          <h1 className="obs-title">Observability</h1>
        </div>
        <div className="obs-date-controls">
          {([7, 30, 90] as const).map(d => (
            <button
              key={d}
              className={`obs-preset-btn${preset === d ? ' active' : ''}`}
              onClick={() => handlePreset(d)}
            >
              {d}d
            </button>
          ))}
          <span className="obs-date-sep">|</span>
          <input
            type="date"
            className="obs-date-input"
            value={fromDate}
            onChange={e => handleFromChange(e.target.value)}
          />
          <span className="obs-date-sep">to</span>
          <input
            type="date"
            className="obs-date-input"
            value={toDate}
            onChange={e => handleToChange(e.target.value)}
          />
        </div>
      </div>

      {/* Error */}
      {error && <div className="obs-error">{error}</div>}

      {/* Loading */}
      {loading && <div className="obs-loading">Loading...</div>}

      {/* Empty state */}
      {isEmpty && <div className="obs-empty">No trace data for this period.</div>}

      {/* Dashboard content */}
      {!loading && !isEmpty && summary && (
        <>
          {/* Summary cards */}
          <div className="obs-summary-cards">
            <div className="obs-card">
              <div className="obs-card-value">{summary.totalTraces.toLocaleString()}</div>
              <div className="obs-card-label">Total Traces</div>
            </div>
            <div className="obs-card">
              <div className="obs-card-value">${summary.totalCost.toFixed(2)}</div>
              <div className="obs-card-label">Total Cost</div>
            </div>
            <div className="obs-card">
              <div className={`obs-card-value ${summary.errorRate > 0.1 ? 'obs-error-high' : 'obs-error-low'}`}>
                {(summary.errorRate * 100).toFixed(1)}%
              </div>
              <div className="obs-card-label">Error Rate</div>
            </div>
            <div className="obs-card">
              <div className="obs-card-value">{summary.avgLatency.toFixed(1)}s</div>
              <div className="obs-card-label">Avg Latency</div>
              <div className="obs-card-sub">p95: {summary.p95Latency.toFixed(1)}s</div>
            </div>
          </div>

          {/* Trend charts */}
          {trends && trends.agents.length > 0 && (
            <div className="obs-charts-row">
              {/* Cost Over Time */}
              <div className="obs-chart-card">
                <div className="obs-chart-title">Cost Over Time</div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={trends.cost}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-dim)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--text-dim)" tickFormatter={v => `$${v}`} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {trends.agents.map((agent, i) => (
                      <Area
                        key={agent}
                        type="monotone"
                        dataKey={agent}
                        stroke={colors[i % colors.length]}
                        fill={colors[i % colors.length]}
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Trace Volume */}
              <div className="obs-chart-card">
                <div className="obs-chart-title">Trace Volume</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={trends.traces}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-dim)" />
                    <YAxis tick={{ fontSize: 10 }} stroke="var(--text-dim)" />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {trends.agents.map((agent, i) => (
                      <Bar
                        key={agent}
                        dataKey={agent}
                        stackId="traces"
                        fill={colors[i % colors.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Agent comparison table */}
          {sortedAgents.length > 0 && (
            <div className="obs-agent-table-wrapper">
              <div className="obs-agent-table-header">Agents</div>
              <table className="obs-agent-table">
                <thead>
                  <tr>
                    <th
                      className={sortKey === 'agentName' ? 'sorted' : ''}
                      onClick={() => handleSort('agentName')}
                    >
                      Agent {sortKey === 'agentName' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'traceCount' ? ' sorted' : ''}`}
                      onClick={() => handleSort('traceCount')}
                    >
                      Traces {sortKey === 'traceCount' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'totalCost' ? ' sorted' : ''}`}
                      onClick={() => handleSort('totalCost')}
                    >
                      Cost {sortKey === 'totalCost' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'errorRate' ? ' sorted' : ''}`}
                      onClick={() => handleSort('errorRate')}
                    >
                      Error Rate {sortKey === 'errorRate' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
                    </th>
                    <th
                      className={`align-right${sortKey === 'avgLatency' ? ' sorted' : ''}`}
                      onClick={() => handleSort('avgLatency')}
                    >
                      Avg Latency {sortKey === 'avgLatency' ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.map(agent => (
                    <tr
                      key={agent.agentId}
                      className="obs-agent-row"
                      onClick={() => navigate(`/agents/${agent.agentId}/traces`)}
                    >
                      <td className="obs-agent-name">{agent.agentName}</td>
                      <td className="align-right">{agent.traceCount}</td>
                      <td className="align-right">${agent.totalCost.toFixed(2)}</td>
                      <td className={`align-right ${agent.errorRate > 0.1 ? 'obs-error-high' : 'obs-error-low'}`}>
                        {(agent.errorRate * 100).toFixed(1)}%
                      </td>
                      <td className="align-right">{agent.avgLatency.toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
