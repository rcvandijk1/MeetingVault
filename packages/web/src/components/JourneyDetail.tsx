import { useState } from 'react';
import { RefreshCw, GitCompare, Check } from 'lucide-react';
import type { ItineraryLeg, ScoreWeights, ScoredJourney } from '@kfr/core';
import { api } from '../api/client';
import { useInvalidate } from '../api/hooks';
import { useCompareStore } from '../store/compare';
import { CabinQualityBadge, DealBadge, LabelChips, OpportunityChip, ScorePill } from './Badges';
import { DealPanel } from './DealPanel';
import { ScoreBreakdownContent } from './ScoreBreakdown';
import { VerificationPanel } from './VerificationPanel';
import { Tabs } from './ui';
import { cabinLabel, fmtDate, fmtDateTime, fmtInstant, fmtPct, fmtTime, formatDuration, formatEur, hoursMinutes, routeOf } from '../lib/format';

function Leg({ leg, title }: { leg: ItineraryLeg; title: string }) {
  return (
    <div>
      <h3 style={{ marginBottom: 6 }}>
        {title} · {routeOf(leg)} · {formatDuration(leg.totalMinutes)}
      </h3>
      {leg.segments.map((s, i) => (
        <div key={i}>
          <div className="segment">
            <span className="mono dim">{s.flightNumber}</span>
            <span>
              {s.origin} <span className="mono">{fmtTime(s.departureLocal)}</span> → {s.destination} <span className="mono">{fmtTime(s.arrivalLocal)}</span>
              <span className="muted"> · {fmtDate(s.departureLocal)}</span>
            </span>
            <span className="dim">
              {s.marketingCarrierName ?? s.marketingCarrier}
              {s.operatingCarrier !== s.marketingCarrier && <span className="muted"> (op. {s.operatingCarrier})</span>}
            </span>
            <span className="dim">
              {cabinLabel(s.cabin)} · {s.aircraft ?? 'aircraft n/a'}
              {s.seatProduct && s.seatProduct !== 'standard' && <span className="muted"> · {s.seatProduct.replace('_', ' ')}</span>}
              <span className="muted"> · {formatDuration(s.durationMinutes)}</span>
            </span>
          </div>
          {leg.connections[i] && (
            <div className={`connection ${leg.connections[i]!.type === 'SELF_TRANSFER' ? 'self' : ''}`}>
              {leg.connections[i]!.type === 'SELF_TRANSFER' ? 'Self-transfer' : 'Protected connection'} at {leg.connections[i]!.airport}: {formatDuration(leg.connections[i]!.minutes)}
              {leg.connections[i]!.overnight && ' · overnight'}
              {leg.connections[i]!.airportChange && ` · airport change to ${leg.connections[i]!.nextAirport}`}
              {leg.connections[i]!.baggageRecheckExpected && ' · baggage re-check expected'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function JourneyDetail({ journey, weights, baselineOrigin }: { journey: ScoredJourney; weights: ScoreWeights; baselineOrigin?: string }) {
  const [tab, setTab] = useState<'overview' | 'deal' | 'flights' | 'score'>('overview');
  const [j, setJ] = useState(journey);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const compare = useCompareStore();
  const invalidate = useInvalidate();
  const it = j.itinerary;
  const inCompare = compare.ids.includes(it.id);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const r = await api.refreshItinerary(it.id);
      if (r.refreshed) {
        setJ(r.journey);
        setRefreshMsg(`Re-priced at ${fmtInstant(r.journey.itinerary.lastValidated)}`);
        await invalidate(['runs'], ['radar'], ['history']);
      } else setRefreshMsg(r.error ?? 'Could not refresh');
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const out = j.outboundTimeline;
  const ret = j.returnTimeline;
  return (
    <div className="stack" data-testid="journey-detail">
      <div className="row between">
        <div className="row">
          <ScorePill score={j.overallScore} onClick={() => setTab('score')} testId="detail-score" />
          <div>
            <div className="route" style={{ fontSize: 16 }}>
              {routeOf(it.outbound)}
            </div>
            <div className="dim">
              {it.primaryAirlineName ?? it.primaryAirline} {cabinLabel(it.cabinSummary.requestedCabin)} · {fmtDate(it.outbound.departureLocal)} → {fmtDate(it.inbound.departureLocal)} ({j.tripDays} days)
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <DealBadge level={j.deal.level} deal={j.deal} />
              <CabinQualityBadge label={j.deal.cabinQuality.label} cabin={it.cabinSummary.requestedCabin} />
              <LabelChips labels={j.labels} baselineOrigin={baselineOrigin} />
              {j.deal.opportunities.map((o) => (
                <OpportunityChip key={o.id} o={o} />
              ))}
            </div>
          </div>
        </div>
        <div className="row">
          <button className={`btn sm ${inCompare ? 'active' : ''}`} onClick={() => compare.toggle(it.id)} data-testid="detail-compare">
            {inCompare ? <Check size={14} /> : <GitCompare size={14} />} {inCompare ? 'In compare' : 'Compare'}
          </button>
          <button className="btn sm" onClick={() => void refresh()} disabled={refreshing} data-testid="detail-refresh">
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} /> Re-price
          </button>
        </div>
      </div>
      {refreshMsg && <div className="small muted">{refreshMsg}</div>}

      <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'deal', label: 'Fare deal' }, { key: 'flights', label: 'Flights' }, { key: 'score', label: 'Score' }]} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid grid-2">
          <div className="stack">
            <div>
              <h3 style={{ marginBottom: 6 }}>True journey cost</h3>
              <table className="cost-table">
                <tbody>
                  <tr>
                    <td>Airfare (quoted)</td>
                    <td data-testid="detail-airfare">{formatEur(j.cost.airfare)}</td>
                  </tr>
                  {j.cost.fareVerified && (
                    <tr>
                      <td>Booking fees found at payment step</td>
                      <td data-testid="detail-booking-fees">{formatEur(j.cost.bookingFees, { sign: true })}</td>
                    </tr>
                  )}
                  <tr>
                    <td>Travel to {it.originAirport} ({j.originAccess.mode.toLowerCase().replace('_', ' ')}) × 2</td>
                    <td>{formatEur(j.cost.accessOutbound + j.cost.accessReturn)}</td>
                  </tr>
                  {j.cost.parking > 0 && (
                    <tr>
                      <td>Parking</td>
                      <td>{formatEur(j.cost.parking)}</td>
                    </tr>
                  )}
                  <tr>
                    <td>Airport hotel {j.hotelOutbound.required ? `(${it.originAirport}, night before)` : ''}</td>
                    <td>{formatEur(j.cost.hotelOutbound)}</td>
                  </tr>
                  {j.cost.hotelReturn > 0 && (
                    <tr>
                      <td>Hotel after late arrival</td>
                      <td>{formatEur(j.cost.hotelReturn)}</td>
                    </tr>
                  )}
                  <tr>
                    <td>
                      {it.arrivalGateway} → Krabi {j.groundTransfer.mode ? `(${j.groundTransfer.mode.toLowerCase().replace('_', ' ')})` : ''} × 2
                    </td>
                    <td>{formatEur(j.cost.groundOutbound + j.cost.groundReturn)}</td>
                  </tr>
                  <tr className="total">
                    <td>True journey cost</td>
                    <td data-testid="detail-true-cost">{formatEur(j.cost.trueJourneyCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <VerificationPanel journey={j} />
            <div>
              <h3 style={{ marginBottom: 6 }}>Versus baseline {j.baseline.baselineOrigin ? `(best ${j.baseline.baselineOrigin})` : ''}</h3>
              {j.baseline.isBaseline ? (
                <p className="dim">This is the baseline journey.</p>
              ) : (
                <dl className="kv">
                  <dt>Saving vs baseline</dt>
                  <dd className="mono" data-testid="detail-saving">
                    {formatEur(j.baseline.savingVsBaseline, { sign: true })}
                  </dd>
                  <dt>Extra travel burden</dt>
                  <dd className="mono">{hoursMinutes(j.baseline.extraMinutesVsBaseline, true)}</dd>
                  <dt>Effective saving</dt>
                  <dd className="mono" data-testid="detail-saving-per-hour">
                    {j.baseline.dominant ? 'Cheaper and faster — dominant' : j.baseline.savingPerExtraHour !== null ? `${formatEur(j.baseline.savingPerExtraHour)} per additional hour` : '—'}
                  </dd>
                </dl>
              )}
              {j.paretoDominated && <p className="small muted" style={{ marginTop: 6 }}>Pareto-dominated: another journey is at least as cheap, as fast and as convenient.</p>}
            </div>
            <div>
              <h3 style={{ marginBottom: 6 }}>
                Fare quality{' '}
                <button type="button" className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setTab('deal')} data-testid="detail-open-deal">
                  full explanation
                </button>
              </h3>
              <dl className="kv">
                <dt>Classification</dt>
                <dd>
                  <DealBadge level={j.deal.level} deal={j.deal} />
                </dd>
                <dt>Typical range (p25–p75)</dt>
                <dd className="mono">{j.deal.referenceLow !== null ? `${formatEur(j.deal.referenceLow)} – ${formatEur(j.deal.referenceHigh)}` : 'no reference yet'}</dd>
                <dt>vs median</dt>
                <dd className="mono" data-testid="detail-vs-median">
                  {j.deal.percentBelowReference === null
                    ? '—'
                    : `${Math.abs(j.deal.percentBelowReference) < 0.5 ? 'at median' : j.deal.percentBelowReference > 0 ? `${fmtPct(j.deal.percentBelowReference)} below` : `${fmtPct(-j.deal.percentBelowReference)} above`} (${j.deal.source === 'HISTORY' ? `${j.deal.comparableObservations} observations, ${j.deal.confidence.toLowerCase()} confidence` : 'this search only'})`}
                </dd>
                <dt>Saving vs median</dt>
                <dd className="mono">{formatEur(j.deal.savingVsMedianEur, { sign: true })}</dd>
                <dt>First seen</dt>
                <dd className="mono">{fmtInstant(it.firstSeen)}</dd>
                <dt>Last validated</dt>
                <dd className="mono" data-testid="detail-last-validated">
                  {fmtInstant(it.lastValidated)}
                </dd>
                <dt>Provider</dt>
                <dd>
                  {it.provider}
                  {it.alternatives.length > 0 && <span className="muted"> · also {it.alternatives.map((a) => `${a.provider} ${formatEur(a.fareEur)}`).join(', ')}</span>}
                </dd>
              </dl>
            </div>
          </div>
          <div className="stack">
            <div>
              <h3 style={{ marginBottom: 6 }}>Door → Krabi · {formatDuration(j.doorToKrabiMinutes)}</h3>
              <div className="timeline" data-testid="detail-timeline">
                <span className="t">{fmtDateTime(out.leaveHomeLocal)}</span>
                <span>Leave home (Alphen aan den Rijn){j.hotelOutbound.required ? ' — evening before, airport hotel' : ''}</span>
                <span className="t">{formatDuration(out.homeToAirportMinutes)}</span>
                <span>
                  To {it.originAirport} by {j.originAccess.mode.toLowerCase().replace('_', ' ')}
                </span>
                {j.hotelOutbound.required && (
                  <>
                    <span className="t">{formatDuration(out.hotelRestMinutes)}</span>
                    <span>Hotel rest (excluded from active burden)</span>
                  </>
                )}
                <span className="t">{formatDuration(out.airportBufferMinutes)}</span>
                <span>Airport processing</span>
                <span className="t">{fmtDateTime(it.outbound.departureLocal)}</span>
                <span>Depart {it.originAirport}</span>
                <span className="t">{formatDuration(out.flightJourneyMinutes)}</span>
                <span>
                  Flights and {it.outbound.transfers} connection(s) ({formatDuration(out.connectionMinutes)} on the ground)
                </span>
                <span className="t">{fmtDateTime(it.outbound.arrivalLocal)}</span>
                <span>Arrive {it.arrivalGateway}</span>
                <span className="t">{formatDuration(out.destinationExitMinutes + out.destinationGroundMinutes)}</span>
                <span>
                  Exit airport + {j.groundTransfer.mode ? j.groundTransfer.mode.toLowerCase().replace('_', ' ') : 'transfer'} to Krabi
                </span>
                <span className="t">{fmtDateTime(out.arriveKrabiLocal)}</span>
                <span className="strong">Arrive in Krabi</span>
              </div>
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Total elapsed</dt>
                <dd className="mono">{formatDuration(out.totalElapsedMinutes)}</dd>
                <dt>Active travel burden</dt>
                <dd className="mono">{formatDuration(out.activeTravelBurdenMinutes)}</dd>
              </dl>
            </div>
            <div>
              <h3 style={{ marginBottom: 6 }}>Krabi → Door · {formatDuration(j.krabiToDoorMinutes)}</h3>
              <div className="timeline">
                <span className="t">{fmtDateTime(ret.leaveKrabiLocal)}</span>
                <span>Leave Krabi</span>
                <span className="t">{fmtDateTime(it.inbound.departureLocal)}</span>
                <span>Depart {it.inbound.segments[0]!.origin}</span>
                <span className="t">{fmtDateTime(it.inbound.arrivalLocal)}</span>
                <span>Arrive {it.inbound.segments[it.inbound.segments.length - 1]!.destination}</span>
                {j.hotelReturn.required && (
                  <>
                    <span className="t">{formatDuration(ret.hotelRestMinutes)}</span>
                    <span>Hotel night after late arrival</span>
                  </>
                )}
                <span className="t">{fmtDateTime(ret.arriveHomeLocal)}</span>
                <span className="strong">Arrive home</span>
              </div>
            </div>
            <dl className="kv">
              <dt>Cabin</dt>
              <dd>
                {cabinLabel(it.cabinSummary.requestedCabin)} · {fmtPct(it.cabinSummary.premiumCabinPercent)} of air time
                {it.cabinSummary.mixedCabin && <span className="badge warn" style={{ marginLeft: 6 }}>mixed cabin{it.cabinSummary.misleadingMixedCabin ? ' — misleading' : ''}</span>}
              </dd>
              <dt>Tickets</dt>
              <dd>
                {it.ticketGroups.length} ticket(s) · {it.protectedConnections} protected · {it.selfTransfers} self-transfer(s)
              </dd>
              <dt>Longest layover</dt>
              <dd className="mono">{formatDuration(Math.max(it.outbound.longestConnectionMinutes, it.inbound.longestConnectionMinutes))}</dd>
            </dl>
          </div>
        </div>
      )}

      {tab === 'flights' && (
        <div className="stack">
          <Leg leg={it.outbound} title="Outbound" />
          <Leg leg={it.inbound} title="Return" />
        </div>
      )}

      {tab === 'deal' && <DealPanel journey={j} />}

      {tab === 'score' && <ScoreBreakdownContent journey={j} weights={weights} />}
    </div>
  );
}
