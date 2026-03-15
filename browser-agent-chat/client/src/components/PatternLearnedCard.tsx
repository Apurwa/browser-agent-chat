import { useState } from 'react';
import './PatternLearnedCard.css';

interface PatternLearnedCardProps {
  name: string;
  steps: string[];
  successRate: number;
  runs: number;
  transition: 'active' | 'dominant';
  isCelebration?: boolean;
}

export default function PatternLearnedCard({
  name,
  steps,
  successRate,
  runs,
  transition,
  isCelebration,
}: PatternLearnedCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (isCelebration) {
    return (
      <div className="pattern-learned-card pattern-learned-card--celebration">
        <div className="pattern-learned-card__celebration-icon">🎉</div>
        <div className="pattern-learned-card__celebration-title">
          Your agent learned its first workflow
        </div>
        <div className="pattern-learned-card__celebration-name">{name}</div>
        <div className="pattern-learned-card__celebration-stats">
          <span className="pattern-learned-card__celebration-stat pattern-learned-card__celebration-stat--runs">
            {runs} runs
          </span>
          <span className="pattern-learned-card__celebration-stat pattern-learned-card__celebration-stat--success">
            {Math.round(successRate * 100)}% success
          </span>
          <span className="pattern-learned-card__celebration-stat pattern-learned-card__celebration-stat--steps">
            {steps.length} steps
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pattern-learned-card ${transition === 'dominant' ? 'pattern-learned-card--dominant' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="pattern-learned-card__header">
        <span className="pattern-learned-card__icon">✨</span>
        <div className="pattern-learned-card__info">
          <div className="pattern-learned-card__label">Learned Workflow</div>
          <div className="pattern-learned-card__name">{name}</div>
        </div>
        <div className="pattern-learned-card__stats">
          <span className="pattern-learned-card__stat">{runs} runs</span>
          <span className="pattern-learned-card__stat pattern-learned-card__stat--success">
            {Math.round(successRate * 100)}%
          </span>
          <span className="pattern-learned-card__chevron">
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="pattern-learned-card__steps">
          <div className="pattern-learned-card__steps-label">Steps learned</div>
          <div className="pattern-learned-card__step-list">
            {steps.map((step, i) => (
              <div key={i} className="pattern-learned-card__step">
                <span className="pattern-learned-card__step-num">{i + 1}.</span>
                {step}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
