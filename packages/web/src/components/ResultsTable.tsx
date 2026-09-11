import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, GitCompare } from 'lucide-react';
import type { ScoreWeights, ScoredJourney } from '@kfr/core';
import type { Verification } from '../api/client';
import { FinalPriceCell } from './VerificationPanel';
import { useCompareStore } from '../store/compare';
import { DealBadge, LabelChips, ScorePill } from './Badges';
import { ScoreBreakdownModal } from './ScoreBreakdown';
import { DEFAULT_SORT_DIR, SORT_OPTIONS, groupSimilar, sortJourneys, type SortKey } from '../lib/journeys';
import { cabinLabel, fmtDate, fmtTime, formatDuration, formatEur, hoursMinutes } from '../lib/format';

interface Props {
  journeys: ScoredJourney[];
  weights: ScoreWeights;
  baselineOrigin?: string;
  collapseSimilar: boolean;
  verifications?: Map<string, Verification>;
  onOpen: (j: ScoredJourney) => void;
  sort: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey, dir: 'asc' | 'desc') => void;
}

export function ResultsTable({ journeys, weights, baselineOrigin, collapseSimilar, verifications, onOpen, sort, sortDir, onSort }: Props) {
  const [breakdown, setBreakdown] = useState<ScoredJourney | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const compare = useCompareStore();
  const sorted = sortJourneys(journeys, sort, sortDir);
  const groups = groupSimilar(sorted, collapseSimilar);

  const header = (key: SortKey, label: string, className = ''): JSX.Element => (
    <th className={`${className} ${sort === key ? 'sorted' : ''}`} onClick={() => onSort(key, sort === key ? (sortDir === 'asc' ? 'desc' : 'asc') : DEFAULT_SORT_DIR[key])} data-testid={`sort-${key}`}>
      {label} {sort === key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  const toggleExpand = (k: string): void => {
    const next = new Set(expanded);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setExpanded(next);
  };

  const row = (j: ScoredJourney, groupKey?: string, others?: ScoredJourney[]): JSX.Element => {
    const it = j.itinerary;
    const selected = compare.ids.includes(it.id);
    const via = it.outbound.connections.map((c) => c.airport).join(' · ');
    return (
      <tr key={it.id} className={`clickable ${selected ? 'selected' : ''} ${j.paretoDominated ? 'dominated' : ''}`} data-testid="result-row" data-itinerary-id={it.id} onClick={() => onOpen(j)}>
        <td onClick={(e) => e.stopPropagation()}>
          <ScorePill score={j.overallScore} onClick={() => setBreakdown(j)} />
        </td>
        <td>
          <div className="route">
            {it.originAirport} <span className="via">→ {via ? `${via} → ` : ''}</span>
            {it.arrivalGateway}
            {j.groundTransfer.required && j.groundTransfer.minutes >= 60 && <span className="via"> → driver</span>}
          </div>
          <div className="small dim">
            {it.primaryAirlineName ?? it.primaryAirline} · {cabinLabel(it.cabinSummary.requestedCabin)}
            {it.cabinSummary.mixedCabin && <span className="muted"> (mixed)</span>}
          </div>
          <LabelChips labels={j.labels} baselineOrigin={baselineOrigin} />
          {others && others.length > 0 && groupKey && (
            <button
              type="button"
              className="btn ghost sm"
              style={{ marginTop: 4, padding: '2px 6px' }}
              data-testid="expand-group"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(groupKey);
              }}
            >
              {expanded.has(groupKey) ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {others.length} other date{others.length > 1 ? 's' : ''}
            </button>
          )}
        </td>
        <td>
          <div className="mono">{fmtDate(it.outbound.departureLocal)}</div>
          <div className="tiny muted">{j.tripDays} days</div>
        </td>
        <td className="nowrap">
          <div className="mono">
            {fmtTime(j.outboundTimeline.leaveHomeLocal)} <span className="muted">home</span>
          </div>
          <div className="mono">
            {fmtTime(it.outbound.departureLocal)} <span className="muted">{it.originAirport}</span>
          </div>
          <div className="mono">
            {fmtTime(j.outboundTimeline.arriveKrabiLocal)} <span className="muted">Krabi{fmtDate(j.outboundTimeline.arriveKrabiLocal) !== fmtDate(it.outbound.departureLocal) ? ' +1' : ''}</span>
          </div>
        </td>
        <td className="right">
          <div className="mono" data-testid="row-airfare">{formatEur(it.fareEur)}</div>
          <div className="tiny muted">airfare</div>
        </td>
        <td className="right">
          <FinalPriceCell journey={j} verification={verifications?.get(it.id)} />
        </td>
        <td className="right">
          <div className="mono strong" data-testid="row-true-cost">{formatEur(j.cost.trueJourneyCost)}</div>
          <div className="tiny muted">true cost</div>
        </td>
        <td className="right">
          <div className="mono">{formatDuration(j.doorToKrabiMinutes)}</div>
          <div className="tiny muted">{formatDuration(j.outboundTimeline.activeTravelBurdenMinutes)} active</div>
        </td>
        <td>
          <div>
            {it.outbound.transfers}+{it.inbound.transfers} · max {formatDuration(Math.max(it.outbound.longestConnectionMinutes, it.inbound.longestConnectionMinutes))}
          </div>
          <div className="tiny">
            {it.selfTransfers > 0 ? <span className="badge warn">self-transfer</span> : <span className="muted">protected</span>}
            {j.hotelOutbound.required && <span className="badge warn" style={{ marginLeft: 4 }}>hotel</span>}
          </div>
        </td>
        <td>
          <DealBadge level={j.deal.level} deal={j.deal} compact />
          <div className="tiny muted">{j.deal.percentOfMedian !== null ? `${Math.round(j.deal.percentOfMedian)}% of median` : 'no reference'}</div>
        </td>
        <td className="right">
          <div className="mono">{j.baseline.isBaseline ? 'baseline' : j.baseline.dominant ? <span className="badge accent">dominant</span> : j.baseline.savingPerExtraHour !== null ? `${formatEur(j.baseline.savingPerExtraHour)}/h` : '—'}</div>
          <div className="tiny muted">{j.baseline.isBaseline ? '' : `${formatEur(j.baseline.savingVsBaseline, { sign: true })} · ${hoursMinutes(j.baseline.extraMinutesVsBaseline, true)}`}</div>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <button className={`btn sm ${selected ? 'active' : 'ghost'}`} title="Add to compare" data-testid="row-compare" onClick={() => compare.toggle(it.id)}>
            <GitCompare size={14} />
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="table-wrap" data-testid="results-table">
      <table>
        <thead>
          <tr>
            {header('score', 'Score')}
            <th>Journey</th>
            {header('departure', 'Dates')}
            {header('arrival', 'Times')}
            {header('airfare', 'Airfare', 'right')}
            <th className="right" title="Final price seen on the payment page of the booking flow">Final price</th>
            {header('trueCost', 'True cost', 'right')}
            {header('doorToDoor', 'Door → Krabi', 'right')}
            <th>Transfers</th>
            {header('dealScore', 'Fare deal')}
            {header('savingPerExtraHour', 'Saving / extra h', 'right')}
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              {row(g.best, g.key, g.others)}
              {expanded.has(g.key) && g.others.map((o) => row(o))}
            </Fragment>
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={12} className="center muted" style={{ padding: 30 }}>
                No journeys match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {breakdown && <ScoreBreakdownModal journey={breakdown} weights={weights} onClose={() => setBreakdown(null)} />}
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Sorted by {SORT_OPTIONS.find((s) => s.key === sort)?.label.toLowerCase()} · {journeys.length} journeys{collapseSimilar ? `, ${groups.length} distinct routes (similar dates collapsed)` : ''}. Greyed rows are Pareto-dominated.
      </p>
    </div>
  );
}
