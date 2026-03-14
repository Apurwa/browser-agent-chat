import type { EvalResult } from '../types/eval';
import { X, CheckCircle2, XCircle, AlertCircle, Bot, Camera } from 'lucide-react';

interface EvalResultDetailProps {
  result: EvalResult;
  onClose: () => void;
}

function VerdictIcon({ verdict }: { verdict: EvalResult['verdict'] }) {
  if (verdict === 'pass') return <CheckCircle2 size={16} className="eval-verdict-icon eval-verdict-icon--pass" />;
  if (verdict === 'fail') return <XCircle size={16} className="eval-verdict-icon eval-verdict-icon--fail" />;
  return <AlertCircle size={16} className="eval-verdict-icon eval-verdict-icon--error" />;
}

export default function EvalResultDetail({ result, onClose }: EvalResultDetailProps) {
  const failedChecks = Object.entries(result.code_checks).filter(([, v]) => !v);
  const passedChecks = Object.entries(result.code_checks).filter(([, v]) => v);
  const lastScreenshot = result.screenshots[result.screenshots.length - 1];

  return (
    <div className="eval-result-detail">
      <div className="eval-result-detail-header">
        <div className="eval-result-detail-title">
          <VerdictIcon verdict={result.verdict} />
          <h2 className="eval-detail-name">{result.case_name ?? 'Result'}</h2>
          {result.case_source_type && (
            <span className="eval-source-badge">{result.case_source_type}</span>
          )}
        </div>
        <button className="eval-close-btn" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>

      <div className="eval-result-detail-body">
        {/* Error type */}
        {result.error_type && (
          <div className="eval-detail-section eval-detail-error-banner">
            <AlertCircle size={14} />
            <span><strong>Error type:</strong> {result.error_type}</span>
          </div>
        )}

        {/* Duration */}
        {result.duration_ms != null && (
          <div className="eval-detail-meta">
            Completed in {(result.duration_ms / 1000).toFixed(1)}s
          </div>
        )}

        {/* Code checks */}
        {Object.keys(result.code_checks).length > 0 && (
          <div className="eval-detail-section">
            <h3 className="eval-detail-section-title">Checks</h3>
            <div className="eval-checks-list">
              {failedChecks.map(([key]) => (
                <div key={key} className="eval-check-row eval-check-row--fail">
                  <XCircle size={13} />
                  <span>{key}</span>
                </div>
              ))}
              {passedChecks.map(([key]) => (
                <div key={key} className="eval-check-row eval-check-row--pass">
                  <CheckCircle2 size={13} />
                  <span>{key}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LLM judge */}
        {result.llm_judge && (
          <div className="eval-detail-section">
            <h3 className="eval-detail-section-title">
              <Bot size={13} />
              LLM Judge
            </h3>
            <div className={`eval-judge-verdict eval-judge-verdict--${result.llm_judge.verdict}`}>
              {result.llm_judge.verdict.toUpperCase()}
            </div>
            {result.llm_judge.reasoning && (
              <p className="eval-judge-reasoning">{result.llm_judge.reasoning}</p>
            )}
          </div>
        )}

        {/* Agent step trace */}
        {result.steps_taken.length > 0 && (
          <div className="eval-detail-section">
            <h3 className="eval-detail-section-title">Agent Steps</h3>
            <ol className="eval-steps-list">
              {result.steps_taken.map((step) => (
                <li key={step.order} className="eval-step-row">
                  <span className="eval-step-num">{step.order}</span>
                  <span className="eval-step-action">{step.action}</span>
                  {step.target && <span className="eval-step-target">{step.target}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Final screenshot */}
        {lastScreenshot && (
          <div className="eval-detail-section">
            <h3 className="eval-detail-section-title">
              <Camera size={13} />
              Final Screenshot
            </h3>
            <img
              src={lastScreenshot}
              alt="Final browser state"
              className="eval-screenshot"
            />
          </div>
        )}
      </div>
    </div>
  );
}
