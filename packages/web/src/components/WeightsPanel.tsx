import { SCORE_CATEGORIES, SCORE_CATEGORY_LABELS, type ScoreWeights } from '@kfr/core';

export function WeightsPanel({ weights, onChange, onReset, compact = false }: { weights: ScoreWeights; onChange: (w: ScoreWeights) => void; onReset?: () => void; compact?: boolean }) {
  const total = SCORE_CATEGORIES.reduce((s, c) => s + weights[c], 0);
  return (
    <div className="weights" data-testid="weights-panel">
      {SCORE_CATEGORIES.map((c) => (
        <div key={c} className="weight-row">
          <span className={compact ? 'tiny dim truncate' : 'small dim'}>{SCORE_CATEGORY_LABELS[c]}</span>
          <input type="range" min={0} max={100} step={1} value={weights[c]} data-testid={`weight-${c}`} onChange={(e) => onChange({ ...weights, [c]: Number(e.target.value) })} />
          <input type="number" min={0} max={100} value={weights[c]} className="mono" data-testid={`weight-input-${c}`} style={{ padding: '3px 5px', fontSize: 12 }} onChange={(e) => onChange({ ...weights, [c]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
        </div>
      ))}
      <div className="row between tiny muted">
        <span>
          Total {total} {total !== 100 && '(normalised)'}
        </span>
        {onReset && (
          <button type="button" className="btn ghost sm" onClick={onReset} data-testid="weights-reset">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
