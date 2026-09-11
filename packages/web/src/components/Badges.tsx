import type { CabinQualityLabel, DealAssessment, DealLevel, FareConfidence, FareOpportunity, ResultLabel } from '@kfr/core';
import { CABIN_QUALITY_TEXT, CONFIDENCE_COLORS, DEAL_COLORS, OPPORTUNITY_TEXT, SEVERITY_CLASS, dealLabel, fmtScore, labelText, scoreColor } from '../lib/format';

/** Classification badge; with `deal` it also shows the deal score and the confidence dot. */
export function DealBadge({ level, deal, compact }: { level: DealLevel; deal?: Pick<DealAssessment, 'dealScore' | 'confidence'>; compact?: boolean }) {
  return (
    <span className="badge deal" style={{ color: DEAL_COLORS[level] }} data-testid="deal-badge" title={deal ? `Deal score ${deal.dealScore ?? '—'} · ${deal.confidence.toLowerCase()} confidence` : undefined}>
      {compact ? dealLabel(level).replace('Very expensive', 'V. expensive') : dealLabel(level)}
      {deal && deal.dealScore !== null && <span className="mono" style={{ opacity: 0.85 }}> {deal.dealScore}</span>}
      {deal && <ConfidenceDot confidence={deal.confidence} />}
    </span>
  );
}

export function ConfidenceDot({ confidence }: { confidence: FareConfidence }) {
  return <span className="conf-dot" style={{ background: CONFIDENCE_COLORS[confidence] }} title={`${confidence.toLowerCase()} confidence`} data-testid={`confidence-${confidence}`} />;
}

export function ConfidenceBadge({ confidence }: { confidence: FareConfidence }) {
  return (
    <span className="badge" style={{ color: CONFIDENCE_COLORS[confidence] }}>
      <ConfidenceDot confidence={confidence} /> {confidence.toLowerCase()} confidence
    </span>
  );
}

export function CabinQualityBadge({ label, cabin }: { label: CabinQualityLabel; cabin: string }) {
  const cls = label === 'FULL' ? 'good' : label === 'MOSTLY' ? '' : 'warn';
  return (
    <span className={`badge ${cls}`} data-testid={`cabin-quality-${label}`}>
      {CABIN_QUALITY_TEXT[label]} {cabin.toLowerCase().replace('_', ' ')}
    </span>
  );
}

export function OpportunityChip({ o }: { o: Pick<FareOpportunity, 'type' | 'severity' | 'reason'> }) {
  return (
    <span className={`badge ${SEVERITY_CLASS[o.severity]}`} title={o.reason} data-testid={`opportunity-${o.type}`}>
      {OPPORTUNITY_TEXT[o.type]}
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
