import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import EvalResultDetail from './EvalResultDetail';
import type { EvalRun, EvalResult } from '../types/eval';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronLeft,
  Loader2,
} from 'lucide-react';

interface EvalRunDetailProps {
  run: EvalRun;
  agentId: string;
  onBack: () => void;
}

function passRate(run: EvalRun): string {
  const total = run.summary.total ?? 0;
  const passed = run.summary.passed ?? 0;
  if (total === 0) return '—';
  return `${Math.round((passed / total) * 100)}%`;
}

function topErrorType(run: EvalRun): string | null {
  const breakdown = run.summary.error_breakdown;
  if (!breakdown) return null;
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

export default function EvalRunDetail({ run, agentId, onBack }: EvalRunDetailProps) {
  const { getAccessToken } = useAuth();
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResult, setSelectedResult] = useState<EvalResult | null>(null);

  useEffect(() => {
    loadResults();
  }, [run.id]);

  const loadResults = async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/agents/${agentId}/evals/runs/${run.id}`, token);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const top = topErrorType(run);

  if (selectedResult) {
    return (
      <EvalResultDetail
        result={selectedResult}
        onClose={() => setSelectedResult(null)}
      />
    );
  }

  return (
    <div className="eval-run-detail">
      <div className="eval-run-detail-header">
        <button className="eval-back-btn" onClick={onBack}>
          <ChevronLeft size={15} /> Runs
        </button>
        <div className="eval-run-detail-title">
          <span className={`eval-run-status-dot eval-run-status-dot--${run.status}`} />
          <h2>Run <span className="eval-run-id-short">{run.id.slice(0, 8)}</span></h2>
          <span className="eval-run-trigger">{run.trigger}</span>
        </div>
        <span className="eval-run-time">
          {new Date(run.started_at).toLocaleString()}
        </span>
      </div>

      {/* Summary stats */}
      <div className="eval-run-stats">
        <div className="eval-stat-card">
          <span className="eval-stat-value">{passRate(run)}</span>
          <span className="eval-stat-label">Pass Rate</span>
        </div>
        <div className="eval-stat-card">
          <span className="eval-stat-value">{run.summary.total ?? 0}</span>
          <span className="eval-stat-label">Total</span>
        </div>
        <div className="eval-stat-card eval-stat-card--pass">
          <span className="eval-stat-value">{run.summary.passed ?? 0}</span>
          <span className="eval-stat-label">Passed</span>
        </div>
        <div className="eval-stat-card eval-stat-card--fail">
          <span className="eval-stat-value">{run.summary.failed ?? 0}</span>
          <span className="eval-stat-label">Failed</span>
        </div>
        {(run.summary.errored ?? 0) > 0 && (
          <div className="eval-stat-card eval-stat-card--error">
            <span className="eval-stat-value">{run.summary.errored}</span>
            <span className="eval-stat-label">Errors</span>
          </div>
        )}
        {top && (
          <div className="eval-stat-card eval-stat-card--wide">
            <span className="eval-stat-value eval-stat-value--sm">{top}</span>
            <span className="eval-stat-label">Top Error</span>
          </div>
        )}
      </div>

      {/* Results list */}
      <div className="eval-results-list">
        <h3 className="eval-results-list-title">Results</h3>
        {loading ? (
          <div className="eval-loading">
            <Loader2 size={20} className="eval-spinner" />
            <span>Loading results…</span>
          </div>
        ) : results.length === 0 ? (
          <div className="eval-empty">No results found.</div>
        ) : (
          results.map(result => (
            <button
              key={result.id}
              className={`eval-result-row eval-result-row--${result.verdict}`}
              onClick={() => setSelectedResult(result)}
            >
              <span className="eval-result-row-icon">
                {result.verdict === 'pass' && <CheckCircle2 size={14} />}
                {result.verdict === 'fail' && <XCircle size={14} />}
                {result.verdict === 'error' && <AlertCircle size={14} />}
              </span>
              <span className="eval-result-row-name">{result.case_name ?? result.case_id.slice(0, 8)}</span>
              {result.case_source_type && (
                <span className="eval-source-badge eval-source-badge--sm">{result.case_source_type}</span>
              )}
              {result.error_type && (
                <span className="eval-error-type-badge">{result.error_type}</span>
              )}
              {result.duration_ms != null && (
                <span className="eval-result-row-duration">
                  {(result.duration_ms / 1000).toFixed(1)}s
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
