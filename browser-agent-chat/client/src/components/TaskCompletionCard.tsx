import { useState } from 'react';
import './TaskCompletionCard.css';

interface TaskCompletionCardProps {
  taskId: string;
  success: boolean;
  stepCount: number;
  durationMs: number;
  onFeedback: (taskId: string, rating: 'positive' | 'negative', correction?: string) => void;
}

export default function TaskCompletionCard({
  taskId,
  success,
  stepCount,
  durationMs,
  onFeedback,
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

  if (state === 'submitted') {
    return (
      <div className={`task-completion-card task-completion-card--${success ? 'success' : 'failed'} task-completion-card--submitted`}>
        <div className="task-completion-card__header">
          <span className={`task-completion-card__dot task-completion-card__dot--${success ? 'success' : 'failed'}`} />
          <span className="task-completion-card__title">Task {success ? 'completed' : 'failed'}</span>
          <span className="task-completion-card__meta">{stepCount} steps · {formatDuration(durationMs)}</span>
        </div>
        <div className="task-completion-card__feedback-done">
          {submittedRating === 'positive'
            ? 'Marked as correct · Added to learning pool'
            : 'Marked as incorrect · Feedback recorded'}
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
