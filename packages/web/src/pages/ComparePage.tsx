import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { ScoredJourney } from '@kfr/core';
import { useItineraries, useProfiles } from '../api/hooks';
import { useCompareStore } from '../store/compare';
import { DealBadge, ScorePill } from '../components/Badges';
import { ScoreBreakdownModal } from '../components/ScoreBreakdown';
import { Card, Empty, Loading } from '../components/ui';
import { cabinLabel, fmtDateTime, fmtScore, formatDuration, formatEur, hoursMinutes, routeOf } from '../lib/format';

type Best = 'max' | 'min' | 'none';
interface Row {
  label: string;
  value: (j: ScoredJourney) => number | null;
  render: (j: ScoredJourney) => React.ReactNode;
  best: Best;
}

const ROWS: Row[] = [
  { label: 'Overall score', value: (j) => j.overallScore, render: (j) => fmtScore(j.overallScore), best: 'max' },
  { label: 'Airfare', value: (j) => j.itinerary.fareEur, render: (j) => formatEur(j.itinerary.fareEur), best: 'min' },
  { label: 'True journey cost', value: (j) => j.cost.trueJourneyCost, render: (j) => formatEur(j.cost.trueJourneyCost), best: 'min' },
  { label: 'Home departure', value: () => null, render: (j) => fmtDateTime(j.outboundTimeline.leaveHomeLocal), best: 'none' },
  { label: 'Krabi arrival', value: () => null, render: (j) => fmtDateTime(j.outboundTimeline.arriveKrabiLocal), best: 'none' },
  { label: 'Door → Krabi', value: (j) => j.doorToKrabiMinutes, render: (j) => formatDuration(j.doorToKrabiMinutes), best: 'min' },
  { label: 'Door-to-door (both ways)', value: (j) => j.totalDoorToDoorMinutes, render: (j) => formatDuration(j.totalDoorToDoorMinutes), best: 'min' },
  { label: 'Active travel burden', value: (j) => j.totalActiveTravelBurdenMinutes, render: (j) => formatDuration(j.totalActiveTravelBurdenMinutes), best: 'min' },
  { label: 'Transfers (out + return)', value: (j) => j.itinerary.outbound.transfers + j.itinerary.inbound.transfers, render: (j) => `${j.itinerary.outbound.transfers} + ${j.itinerary.inbound.transfers}`, best: 'min' },
  { label: 'Longest layover', value: (j) => Math.max(j.itinerary.outbound.longestConnectionMinutes, j.itinerary.inbound.longestConnectionMinutes), render: (j) => formatDuration(Math.max(j.itinerary.outbound.longestConnectionMinutes, j.itinerary.inbound.longestConnectionMinutes)), best: 'min' },
  { label: 'Hotel required', value: (j) => (j.hotelOutbound.required ? 1 : 0) + (j.hotelReturn.required ? 1 : 0), render: (j) => (j.hotelOutbound.required || j.hotelReturn.required ? `Yes (${formatEur(j.cost.hotelOutbound + j.cost.hotelReturn)})` : 'No'), best: 'min' },
  { label: 'Origin access', value: (j) => j.categoryScores.originInconvenience, render: (j) => `${j.itinerary.originAirport} · ${formatDuration(j.originAccess.travelMinutes)} by ${j.originAccess.mode.toLowerCase().replace('_', ' ')} · ${formatEur(j.cost.accessOutbound + j.cost.accessReturn + j.cost.parking)}`, best: 'max' },
  { label: 'Flight timing score', value: (j) => j.categoryScores.flightTiming, render: (j) => fmtScore(j.categoryScores.flightTiming), best: 'max' },
  { label: 'Self-transfer', value: (j) => j.itinerary.selfTransfers, render: (j) => (j.itinerary.selfTransfers > 0 ? `${j.itinerary.selfTransfers} (risk score ${fmtScore(j.categoryScores.selfTransferRisk)})` : 'None'), best: 'min' },
  { label: 'Cabin', value: (j) => j.itinerary.cabinSummary.premiumCabinPercent, render: (j) => `${cabinLabel(j.itinerary.cabinSummary.requestedCabin)} · ${Math.round(j.itinerary.cabinSummary.premiumCabinPercent)}%`, best: 'max' },
  { label: 'Airline', value: () => null, render: (j) => j.itinerary.primaryAirlineName ?? j.itinerary.primaryAirline, best: 'none' },
  { label: 'Arrival gateway', value: () => null, render: (j) => `${j.itinerary.arrivalGateway}${j.groundTransfer.mode ? ` · ${j.groundTransfer.mode.toLowerCase().replace('_', ' ')} ${formatDuration(j.groundTransfer.minutes)}` : ''}`, best: 'none' },
  { label: 'Fare deal', value: (j) => j.deal.dealScore, render: (j) => <DealBadge level={j.deal.level} deal={j.deal} />, best: 'max' },
  { label: '% of historical median', value: (j) => (j.deal.percentOfMedian === null ? null : -j.deal.percentOfMedian), render: (j) => (j.deal.percentOfMedian === null ? '—' : `${Math.round(j.deal.percentOfMedian)}% (${j.deal.confidence.toLowerCase()})`), best: 'max' },
  { label: 'Saving vs median', value: (j) => j.deal.savingVsMedianEur, render: (j) => formatEur(j.deal.savingVsMedianEur, { sign: true }), best: 'max' },
  { label: 'Journey value score', value: (j) => j.journeyValueScore, render: (j) => fmtScore(j.journeyValueScore), best: 'max' },
  { label: 'Break-even airfare', value: (j) => j.baseline.breakEvenFareEur, render: (j) => (j.baseline.isBaseline ? 'baseline' : formatEur(j.baseline.breakEvenFareEur)), best: 'max' },
  { label: 'Airfare vs baseline', value: (j) => j.baseline.airfareSavingVsBaseline, render: (j) => (j.baseline.isBaseline ? 'baseline' : formatEur(j.baseline.airfareSavingVsBaseline, { sign: true })), best: 'max' },
  { label: 'True cost vs baseline', value: (j) => j.baseline.savingVsBaseline, render: (j) => (j.baseline.isBaseline ? 'baseline' : formatEur(j.baseline.savingVsBaseline, { sign: true })), best: 'max' },
  { label: 'Extra time vs baseline', value: (j) => j.baseline.extraMinutesVsBaseline, render: (j) => (j.baseline.isBaseline ? 'baseline' : hoursMinutes(j.baseline.extraMinutesVsBaseline, true)), best: 'min' },
  { label: 'Saving per extra hour', value: (j) => j.baseline.savingPerExtraHour, render: (j) => (j.baseline.dominant ? 'dominant' : j.baseline.savingPerExtraHour !== null ? `${formatEur(j.baseline.savingPerExtraHour)}/h` : '—'), best: 'max' },
];

export function ComparePage() {
  const store = useCompareStore();
  const query = useItineraries(store.ids);
  const profiles = useProfiles();
  const [breakdown, setBreakdown] = useState<ScoredJourney | null>(null);
  const journeys = (query.data ?? []).slice().sort((a, b) => store.ids.indexOf(a.itinerary.id) - store.ids.indexOf(b.itinerary.id));
  const weights = profiles.data?.find((p) => p.isDefault)?.scoringWeights ?? profiles.data?.[0]?.scoringWeights;

  const bestIndex = (row: Row): number => {
    if (row.best === 'none') return -1;
    let idx = -1;
    let bestVal: number | null = null;
    journeys.forEach((j, i) => {
      const v = row.value(j);
      if (v === null || v === undefined) return;
      if (bestVal === null || (row.best === 'max' ? v > bestVal : v < bestVal)) {
        bestVal = v;
        idx = i;
      }
    });
    return idx;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Compare</h1>
          <p>Side-by-side comparison of 2–5 journeys. The best value per row is highlighted.</p>
        </div>
        {store.ids.length > 0 && (
          <button className="btn ghost" onClick={store.clear} data-testid="compare-clear">
            Clear selection
          </button>
        )}
      </div>
      {store.ids.length === 0 && (
        <Card>
          <Empty>
            Nothing selected yet. Add journeys from the <Link to="/">Radar</Link> or <Link to="/search">Search</Link> results.
          </Empty>
        </Card>
      )}
      {store.ids.length === 1 && <p className="muted" style={{ marginBottom: 12 }}>Select at least one more journey to compare.</p>}
      {query.isLoading && <Loading />}
      {journeys.length > 0 && (
        <Card testId="compare-table">
          <div className="table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th />
                  {journeys.map((j) => (
                    <th key={j.itinerary.id} style={{ textTransform: 'none', letterSpacing: 0, minWidth: 190 }}>
                      <div className="row between">
                        <div>
                          <div className="route">{routeOf(j.itinerary.outbound)}</div>
                          <div className="tiny muted">
                            {j.itinerary.outbound.departureLocal.slice(0, 10)} · {j.itinerary.primaryAirlineName ?? j.itinerary.primaryAirline}
                          </div>
                        </div>
                        <button className="btn ghost sm" onClick={() => store.remove(j.itinerary.id)} aria-label="Remove" data-testid="compare-remove">
                          <X size={14} />
                        </button>
                      </div>
                      <div style={{ marginTop: 6 }}>{weights && <ScorePill score={j.overallScore} onClick={() => setBreakdown(j)} />}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const b = bestIndex(row);
                  return (
                    <tr key={row.label} data-testid={`compare-row-${row.label}`}>
                      <td className="muted nowrap">{row.label}</td>
                      {journeys.map((j, i) => (
                        <td key={j.itinerary.id} className={`mono ${i === b && journeys.length > 1 ? 'best' : ''}`}>
                          {row.render(j)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {breakdown && weights && <ScoreBreakdownModal journey={breakdown} weights={weights} onClose={() => setBreakdown(null)} />}
    </div>
  );
}
