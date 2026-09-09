import type { DealLevel, ResultLabel } from '@kfr/core';
import { DEAL_COLORS, fmtScore, labelText, scoreColor } from '../lib/format';

export function DealBadge({ level }: { level: DealLevel }) {
  return (
    <span className="badge deal" style={{ color: DEAL_COLORS[level] }} data-testid="deal-badge">
      {level}
    </span>
  );
}

export function ScorePill({ score, onClick, testId }: { score: number; onClick?: () => void; testId?: string }) {
  return (
    <button type="button" className="score-pill" onClick={onClick} data-testid={testId ?? 'score-pill'} title="Show score breakdown">
      <span className="value" style={{ color: scoreColor(score) }}>
        {fmtScore(score)}
      </span>
      <span className="sub">/ 100</span>
    </button>
  );
}

export function LabelChips({ labels, baselineOrigin }: { labels: ResultLabel[]; baselineOrigin?: string }) {
  if (labels.length === 0) return null;
  const cls = (l: ResultLabel): string => (l === 'BEST_OVERALL' || l === 'DOMINANT' ? 'accent' : l === 'CHEAPEST' || l === 'FASTEST' ? 'good' : '');
  return (
    <div className="labels">
      {labels.map((l) => (
        <span key={l} className={`badge ${cls(l)}`} data-testid={`label-${l}`}>
          {labelText(l, baselineOrigin)}
        </span>
      ))}
    </div>
  );
}
