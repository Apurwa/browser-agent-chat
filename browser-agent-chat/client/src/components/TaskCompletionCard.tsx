import { useState } from 'react';
import './TaskCompletionCard.css';

interface TaskCompletionCardProps {
  taskId: string;
  success: boolean;
  stepCount: number;
  durationMs: number;
  onFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
  feedbackAck?: {
    taskId: string;
    rating: 'positive' | 'negative';
    clustered: boolean;
    clusterName?: string;
    clusterProgress?: { current: number; needed: number };
  } | null;
}

export default function TaskCompletionCard({
  taskId,
  success,
  stepCount,
  durationMs,
  onFeedback,
  feedbackAck,
}: TaskCompletionCardProps) {
  const [state, setState] = useState<'pending' | 'positive' | 'negative' | 'submitted'>('pending');
  const [submittedRating, setSubmittedRating] = useState<'positive' | 'negative'>('positive');
  const [correction, setCorrection] = useState('');

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${Math.round(ms / 1000)}s`;
  };

  const handlePositive = () => {
    setSubmittedRating('positive');
    setState('submitted');
    onFeedback(taskId, 'positive');
  };

  const handleNegative = () => {
    setState('negative');
  };

  const handleSubmitCorrection = () => {
    setSubmittedRating('negative');
    setState('submitted');
    onFeedback(taskId, 'negative', correction || undefined);
  };

  const handleSkipCorrection = () => {
    setSubmittedRating('negative');
    setState('submitted');
    onFeedback(taskId, 'negative');
  };

  const getConfirmationStage = (): 1 | 2 | 3 => {
    if (!feedbackAck || feedbackAck.taskId !== taskId) return 1;
    if (submittedRating === 'negative') return 1;
    if (!feedbackAck.clustered) return 1;
    if (feedbackAck.clusterProgress) {
      const ratio = feedbackAck.clusterProgress.current / feedbackAck.clusterProgress.needed;
      if (ratio >= 0.8) return 3;
    }
    return 2;
  };

  if (state === 'submitted') {
    const stage = getConfirmationStage();
    const isNearExtraction = stage === 3;
    const progress = feedbackAck?.clusterProgress;
    const progressPct = progress ? (progress.current / progress.needed) * 100 : 0;

    return (
      <div className={`task-completion-card task-completion-card--${success ? 'success' : 'failed'} task-completion-card--submitted`}>
        <div className="task-completion-card__header">
          <span className={`task-completion-card__dot task-completion-card__dot--${success ? 'success' : 'failed'}`} />
          <span className="task-completion-card__title">Task {success ? 'completed' : 'failed'}</span>
          <span className="task-completion-card__meta">{stepCount} steps · {formatDuration(durationMs)}</span>
        </div>
        <div className="task-completion-card__confirmation">
          <div className="task-completion-card__confirmation-check">
            <span className="task-completion-card__check-icon">✓</span>
            <span className={`task-completion-card__check-text ${stage > 1 ? 'task-completion-card__check-text--pool' : ''}`}>
              {stage > 1 && submittedRating === 'positive' ? 'Added to learning pool' : 'Feedback recorded'}
            </span>
          </div>
          {stage === 1 && submittedRating === 'positive' && (
            <div className="task-completion-card__confirmation-subtext">
              This helps your agent improve
            </div>
          )}
          {stage >= 2 && progress && (
            <div className="task-completion-card__progress-row">
              <span className="task-completion-card__cluster-name">{feedbackAck?.clusterName}</span>
              <span className="task-completion-card__progress-dot">·</span>
              <div className="task-completion-card__progress-bar-wrap">
                <div className="task-completion-card__progress-bar-bg">
                  <div
                    className={`task-completion-card__progress-bar-fill ${isNearExtraction ? 'task-completion-card__progress-bar-fill--near' : ''}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className={`task-completion-card__progress-label ${isNearExtraction ? 'task-completion-card__progress-label--near' : ''}`}>
                  {progress.current} / {progress.needed} runs
                </span>
              </div>
            </div>
          )}
          {stage === 3 && (
            <div className="task-completion-card__near-extraction">
              One more successful run will teach a reusable workflow
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`task-completion-card task-completion-card--${success ? 'success' : 'failed'}`}>
      <div className="task-completion-card__header">
        <span className={`task-completion-card__dot task-completion-card__dot--${success ? 'success' : 'failed'}`} />
        <span className="task-completion-card__title">Task {success ? 'completed' : 'failed'}</span>
        <span className="task-completion-card__meta">{stepCount} steps · {formatDuration(durationMs)}</span>
      </div>

      {state === 'pending' && success && (
        <div className="task-completion-card__actions">
          <button className="task-completion-card__btn task-completion-card__btn--positive" onClick={handlePositive}>
            Correct
          </button>
          <button className="task-completion-card__btn task-completion-card__btn--negative" onClick={handleNegative}>
            Incorrect
          </button>
        </div>
      )}

      {state === 'pending' && !success && (
        <div className="task-completion-card__correction">
          <label className="task-completion-card__label">What went wrong? (optional)</label>
          <textarea
            className="task-completion-card__textarea"
            value={correction}
            onChange={e => setCorrection(e.target.value)}
            placeholder="e.g., Button was renamed to 'Create Job'..."
            rows={2}
          />
          <div className="task-completion-card__correction-actions">
            <button className="task-completion-card__btn task-completion-card__btn--skip" onClick={handleSkipCorrection}>
              Skip
            </button>
            <button className="task-completion-card__btn task-completion-card__btn--submit" onClick={handleSubmitCorrection}>
              Submit
            </button>
          </div>
        </div>
      )}

      {state === 'negative' && (
        <div className="task-completion-card__correction">
          <label className="task-completion-card__label">What should have happened?</label>
          <textarea
            className="task-completion-card__textarea"
            value={correction}
            onChange={e => setCorrection(e.target.value)}
            placeholder="e.g., Should have used Settings → Pipelines instead..."
            rows={2}
          />
          <div className="task-completion-card__correction-actions">
            <button className="task-completion-card__btn task-completion-card__btn--skip" onClick={handleSkipCorrection}>
              Skip
            </button>
            <button className="task-completion-card__btn task-completion-card__btn--submit" onClick={handleSubmitCorrection}>
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
