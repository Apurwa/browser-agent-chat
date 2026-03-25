import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import EvalRunDetail from './EvalRunDetail';
import EvalCaseEditor from './EvalCaseEditor';
import { useAuth } from '../hooks/useAuth';
import { apiAuthFetch } from '../lib/api';
import type { EvalRun, EvalCase } from '../types/eval';
import {
  Play,
  Sprout,
  Plus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ClipboardList,
} from 'lucide-react';

type Tab = 'runs' | 'cases';

function RunStatusDot({ status }: { status: EvalRun['status'] }) {
  return <span className={`eval-run-status-dot eval-run-status-dot--${status}`} />;
}

export default function EvalDashboard() {
  const { id } = useParams<{ id: string }>();
  const { getAccessToken } = useAuth();

  const [tab, setTab] = useState<Tab>('runs');
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingCases, setLoadingCases] = useState(true);
  const [running, setRunning] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [selectedRun, setSelectedRun] = useState<EvalRun | null>(null);
  const [showCaseEditor, setShowCaseEditor] = useState(false);

  useEffect(() => { loadRuns(); }, [id]);
  useEffect(() => { loadCases(); }, [id]);

  const loadRuns = async () => {
    if (!id) return;
    setLoadingRuns(true);
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/agents/${id}/evals/runs`, token);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs ?? []);
      }
    } finally {
      setLoadingRuns(false);
    }
  };

  const loadCases = async () => {
    if (!id) return;
    setLoadingCases(true);
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/agents/${id}/evals/cases`, token);
      if (res.ok) {
        const data = await res.json();
        setCases(data.cases ?? []);
      }
    } finally {
      setLoadingCases(false);
    }
  };

  const handleRunAll = async () => {
    if (!id || running) return;
    setRunning(true);
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/agents/${id}/evals/run`, token, { method: 'POST' });
      if (res.ok) {
        // Switch to runs tab and reload
        setTab('runs');
        await loadRuns();
      }
    } finally {
      setRunning(false);
    }
  };

  const handleSeedFromFeatures = async () => {
    if (!id || seeding) return;
    setSeeding(true);
    try {
      const token = await getAccessToken();
      const res = await apiAuthFetch(`/api/agents/${id}/evals/seed`, token, { method: 'POST' });
      if (res.ok) {
        await loadCases();
        setTab('cases');
      }
    } finally {
      setSeeding(false);
    }
  };

  const handleCaseSaved = async () => {
    setShowCaseEditor(false);
    await loadCases();
    setTab('cases');
  };

  // If a run is selected, show its detail view
  if (selectedRun) {
    return (
      <div className="eval-content">
        <EvalRunDetail
          run={selectedRun}
          agentId={id!}
          onBack={() => setSelectedRun(null)}
        />
      </div>
    );
  }

  // If creating a new case, show the editor
  if (showCaseEditor) {
    return (
      <div className="eval-content">
        <EvalCaseEditor
          agentId={id!}
          onSaved={handleCaseSaved}
          onCancel={() => setShowCaseEditor(false)}
        />
      </div>
    );
  }

  return (
    <div className="eval-content">
      {/* Header */}
        <div className="eval-header">
          <div className="eval-header-left">
            <ClipboardList size={18} />
            <h2>Eval Suite</h2>
          </div>
          <div className="eval-header-actions">
            <button
              className="mv-btn mv-btn-outline"
              onClick={handleSeedFromFeatures}
              disabled={seeding}
              title="Generate eval cases from features"
            >
              {seeding ? <Loader2 size={14} className="eval-spinner" /> : <Sprout size={14} />}
              Seed from Features
            </button>
            <button
              className="mv-btn mv-btn-accept"
              onClick={handleRunAll}
              disabled={running || cases.length === 0}
              title={cases.length === 0 ? 'No eval cases yet' : 'Run all active eval cases'}
            >
              {running ? <Loader2 size={14} className="eval-spinner" /> : <Play size={14} />}
              Run All
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="eval-tabs">
          <button
            className={`eval-tab${tab === 'runs' ? ' eval-tab--active' : ''}`}
            onClick={() => setTab('runs')}
          >
            Runs
            {runs.length > 0 && <span className="eval-tab-count">{runs.length}</span>}
          </button>
          <button
            className={`eval-tab${tab === 'cases' ? ' eval-tab--active' : ''}`}
            onClick={() => setTab('cases')}
          >
            Cases
            {cases.length > 0 && <span className="eval-tab-count">{cases.length}</span>}
          </button>
        </div>

        {/* Runs tab */}
        {tab === 'runs' && (
          <div className="eval-tab-content">
            {loadingRuns ? (
              <div className="eval-loading">
                <Loader2 size={20} className="eval-spinner" />
                <span>Loading runs…</span>
              </div>
            ) : runs.length === 0 ? (
              <div className="eval-empty">
                <ClipboardList size={32} strokeWidth={1.5} />
                <p>No runs yet</p>
                <span>Click "Run All" to execute your eval suite</span>
              </div>
            ) : (
              <div className="eval-runs-list">
                {runs.map(run => (
                  <button
                    key={run.id}
                    className="eval-run-row"
                    onClick={() => setSelectedRun(run)}
                  >
                    <RunStatusDot status={run.status} />
                    <div className="eval-run-row-body">
                      <span className="eval-run-row-id">{run.id.slice(0, 8)}</span>
                      <span className="eval-run-row-trigger">{run.trigger}</span>
                    </div>
                    <div className="eval-run-row-stats">
                      {run.summary.passed != null && (
                        <span className="eval-mini-stat eval-mini-stat--pass">
                          <CheckCircle2 size={12} /> {run.summary.passed}
                        </span>
                      )}
                      {run.summary.failed != null && (
                        <span className="eval-mini-stat eval-mini-stat--fail">
                          <XCircle size={12} /> {run.summary.failed}
                        </span>
                      )}
                      {(run.summary.errored ?? 0) > 0 && (
                        <span className="eval-mini-stat eval-mini-stat--error">
                          <AlertCircle size={12} /> {run.summary.errored}
                        </span>
                      )}
                    </div>
                    <span className="eval-run-row-date">
                      {new Date(run.started_at).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Cases tab */}
        {tab === 'cases' && (
          <div className="eval-tab-content">
            <div className="eval-cases-toolbar">
              <button
                className="mv-btn mv-btn-outline"
                onClick={() => setShowCaseEditor(true)}
              >
                <Plus size={13} /> New Case
              </button>
            </div>

            {loadingCases ? (
              <div className="eval-loading">
                <Loader2 size={20} className="eval-spinner" />
                <span>Loading cases…</span>
              </div>
            ) : cases.length === 0 ? (
              <div className="eval-empty">
                <ClipboardList size={32} strokeWidth={1.5} />
                <p>No eval cases yet</p>
                <span>Seed from features or create manually</span>
              </div>
            ) : (
              <div className="eval-cases-list">
                {cases.map(ec => (
                  <div
                    key={ec.id}
                    className={`eval-case-row${ec.status === 'disabled' ? ' eval-case-row--disabled' : ''}`}
                  >
                    <div className="eval-case-row-body">
                      <span className="eval-case-row-name">{ec.name}</span>
                      <span className="eval-case-row-prompt">{ec.task_prompt}</span>
                    </div>
                    <div className="eval-case-row-meta">
                      <span className="eval-source-badge">{ec.source_type}</span>
                      {ec.tags.map(tag => (
                        <span key={tag} className="eval-tag">{tag}</span>
                      ))}
                      {ec.status === 'disabled' && (
                        <span className="eval-disabled-badge">disabled</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
  );
}
