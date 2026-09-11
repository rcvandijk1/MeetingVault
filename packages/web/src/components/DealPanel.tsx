import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ScoredJourney } from '@kfr/core';
import { useFingerprintHistory } from '../api/hooks';
import { CabinQualityBadge, ConfidenceBadge, DealBadge, OpportunityChip } from './Badges';
import { Empty, Loading } from './ui';
import { fmtInstant, fmtPct, fmtSignedPct, formatDuration, formatEur } from '../lib/format';

/**
 * Fare-history graph of one physical itinerary: every observation over time,
 * the current fare, the historical median and the historical low of the
 * comparison cohort as reference lines.
 */
export function FareHistoryChart({ journey }: { journey: ScoredJourney }) {
  const it = journey.itinerary;
  const history = useFingerprintHistory(it.fingerprint, it.fareEur);
  const points = useMemo(() => (history.data?.observations ?? []).map((o) => ({ t: new Date(o.observedAt).getTime(), fare: o.fareEur, verified: o.verified ? o.fareEur : null })), [history.data]);
  const d = journey.deal;
  if (history.isLoading) return <Loading label="Loading fare history…" />;
  if (points.length === 0) return <Empty>No earlier observations of these exact flights yet.</Empty>;
  const data = [...points, { t: new Date(it.lastValidated ?? it.lastSeen ?? Date.now()).getTime() + 1, fare: it.fareEur, verified: null }];
  return (
    <div style={{ height: 240 }} data-testid="fare-history-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#223049" strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} stroke="#7b8aa5" fontSize={11} />
          <YAxis tickFormatter={(v: number) => `€${v}`} stroke="#7b8aa5" fontSize={11} width={60} domain={['auto', 'auto']} />
          <Tooltip contentStyle={{ background: '#111a2b', border: '1px solid #223049', fontSize: 12 }} labelFormatter={(t) => fmtInstant(new Date(Number(t)).toISOString())} formatter={(v: number, name: string) => [formatEur(v), name === 'fare' ? 'observed fare' : 'verified final price']} />
          {d.referenceFare !== null && <ReferenceLine y={d.referenceFare} stroke="#b28dff" strokeDasharray="4 4" label={{ value: `median ${formatEur(d.referenceFare)}`, fill: '#b28dff', fontSize: 11, position: 'insideTopRight' }} />}
          {d.lowestObservedComparable !== null && <ReferenceLine y={d.lowestObservedComparable} stroke="#7cf5c2" strokeDasharray="4 4" label={{ value: `low ${formatEur(d.lowestObservedComparable)}`, fill: '#7cf5c2', fontSize: 11, position: 'insideBottomRight' }} />}
          <ReferenceLine y={it.fareEur} stroke="#4cc9f0" label={{ value: `now ${formatEur(it.fareEur)}`, fill: '#4cc9f0', fontSize: 11, position: 'insideTopLeft' }} />
          <Line type="stepAfter" dataKey="fare" stroke="#e6edf7" dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="verified" stroke="#f6c667" dot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Full deal explanation for the journey drawer: verdict, why, statistics, market, trend, costs and break-even. */
export function DealPanel({ journey }: { journey: ScoredJourney }) {
  const j = journey;
  const it = j.itinerary;
  const d = j.deal;
  const cabin = it.cabinSummary.requestedCabin.toLowerCase().replace('_', ' ');
  return (
    <div className="stack" data-testid="deal-panel">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <DealBadge level={d.level} deal={d} />
        <ConfidenceBadge confidence={d.confidence} />
        <CabinQualityBadge label={d.cabinQuality.label} cabin={it.cabinSummary.requestedCabin} />
        {d.opportunities.map((o) => (
          <OpportunityChip key={o.id} o={o} />
        ))}
      </div>

      <div>
        <h3 style={{ marginBottom: 6 }}>Why</h3>
        <ul className="explain" data-testid="deal-explanations">
          {d.explanations.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>

      <div className="grid grid-2">
        <div>
          <h3 style={{ marginBottom: 6 }}>Historical baseline</h3>
          {d.stats && d.cohort ? (
            <dl className="kv">
              <dt>Comparison set</dt>
              <dd>
                {d.source === 'HISTORY' ? `Level ${d.cohort.level} · ` : 'This search · '}
                {d.cohort.description}
              </dd>
              <dt>Window</dt>
              <dd className="mono">
                {d.cohort.windowDays === 0 ? 'all history' : `${d.cohort.windowDays} days`} · {d.cohort.sampleCount} fares on {d.cohort.distinctDays} day{d.cohort.distinctDays === 1 ? '' : 's'}
              </dd>
              <dt>Fare vs median</dt>
              <dd className="mono" data-testid="deal-percent-of-median">
                {fmtPct(d.percentOfMedian)} of {formatEur(d.stats.median)}
              </dd>
              <dt>Saving vs median</dt>
              <dd className="mono" data-testid="deal-saving-vs-median">
                {formatEur(d.savingVsMedianEur, { sign: true })}
              </dd>
              <dt>Percentile rank</dt>
              <dd className="mono">cheaper than {Math.round((1 - d.stats.percentileRank) * 100)}% of comparable fares</dd>
              <dt>Mean / stdev</dt>
              <dd className="mono">
                {formatEur(d.stats.mean)} / {formatEur(d.stats.stdev)}
              </dd>
              <dt>p10 · p25 · p75 · p90</dt>
              <dd className="mono">
                {formatEur(d.stats.p10)} · {formatEur(d.stats.p25)} · {formatEur(d.stats.p75)} · {formatEur(d.stats.p90)}
              </dd>
              <dt>Lowest · highest</dt>
              <dd className="mono">
                {formatEur(d.stats.min)} · {formatEur(d.stats.max)}
              </dd>
              {d.stats.recentMedian !== null && (
                <>
                  <dt>Recent · rolling</dt>
                  <dd className="mono">
                    {formatEur(d.stats.recentMedian)} (7d) · {formatEur(d.stats.rollingMedian)} (30d)
                  </dd>
                </>
              )}
              {d.stats.seasonalMedian !== null && (
                <>
                  <dt>Same-season median</dt>
                  <dd className="mono">{formatEur(d.stats.seasonalMedian)}</dd>
                </>
              )}
              {d.cohort.excludedOutliers + d.cohort.excludedInvalid > 0 && (
                <>
                  <dt>Data quality</dt>
                  <dd className="muted">
                    {d.cohort.excludedOutliers} outlier(s), {d.cohort.excludedInvalid} non-comparable observation(s) excluded
                  </dd>
                </>
              )}
            </dl>
          ) : (
            <p className="muted">No reference yet — cold start. Run more searches to build history.</p>
          )}
        </div>
        <div className="stack">
          <div>
            <h3 style={{ marginBottom: 6 }}>Current market (this search only)</h3>
            {d.market.rank !== null ? (
              <dl className="kv" data-testid="deal-market">
                <dt>Comparable options</dt>
                <dd className="mono">
                  {d.market.comparableCount} ({d.market.scope.toLowerCase()})
                </dd>
                <dt>Rank</dt>
                <dd className="mono">#{d.market.rank} cheapest</dd>
                <dt>Cheapest · median</dt>
                <dd className="mono">
                  {formatEur(d.market.cheapestEur)} · {formatEur(d.market.medianEur)}
                </dd>
                <dt>vs cheapest</dt>
                <dd className="mono">
                  {formatEur(d.market.differenceToBestEur, { sign: true })} ({fmtSignedPct(d.market.percentAboveBest)})
                </dd>
              </dl>
            ) : (
              <p className="muted">Not enough comparable options in this search.</p>
            )}
          </div>
          <div>
            <h3 style={{ marginBottom: 6 }}>Price movement of these flights</h3>
            {d.trend ? (
              <dl className="kv" data-testid="deal-trend">
                <dt>Seen before</dt>
                <dd className="mono">
                  {d.trend.timesSeenBefore}× since {fmtInstant(d.trend.firstSeenAt)} at {formatEur(d.trend.firstSeenFareEur)}
                </dd>
                <dt>Previous</dt>
                <dd className="mono">
                  {formatEur(d.trend.previousFareEur)} → {formatEur(d.trend.currentFareEur)} ({fmtSignedPct(d.trend.changeVsPreviousPercent, 1)})
                </dd>
                <dt>Lowest · highest</dt>
                <dd className="mono">
                  {formatEur(d.trend.lowestSeenEur)} · {formatEur(d.trend.highestSeenEur)}
                  {d.trend.isNewLow && <span className="badge good" style={{ marginLeft: 6 }}>new low</span>}
                </dd>
                <dt>7d · 30d median</dt>
                <dd className="mono">
                  {formatEur(d.trend.median7dEur)} · {formatEur(d.trend.median30dEur)} ({fmtSignedPct(d.trend.changeVs30dMedianPercent, 1)} vs 30d)
                </dd>
              </dl>
            ) : (
              <p className="muted">First time these exact flights were seen.</p>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: 6 }}>Fare history · current, median and low</h3>
        <FareHistoryChart journey={j} />
      </div>

      <div className="grid grid-2">
        <div>
          <h3 style={{ marginBottom: 6 }}>Cost and burden (kept separate)</h3>
          <dl className="kv" data-testid="deal-costs">
            <dt>Financial true cost</dt>
            <dd className="mono">{formatEur(j.cost.trueJourneyCost)}</dd>
            <dt>Journey burden</dt>
            <dd className="mono">{formatDuration(j.totalActiveTravelBurdenMinutes)} active travel, both ways</dd>
            <dt>Value of time</dt>
            <dd className="mono">{d.costs?.valueOfTimeEur !== null && d.costs?.valueOfTimeEur !== undefined ? `${formatEur(d.costs.valueOfTimeEur)} → ${formatEur(d.costs.trueTripCostIncludingTimeEur)} incl. time` : 'disabled (Settings → Fare intelligence)'}</dd>
            <dt>Journey value score</dt>
            <dd className="mono">{Math.round(j.journeyValueScore * 10) / 10} / 100 (all nine categories, weighted)</dd>
            <dt>Fare deal score</dt>
            <dd className="mono">{d.dealScore ?? '—'} / 100 (fare only)</dd>
          </dl>
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Alternative airport break-even {j.baseline.baselineOrigin ? `(vs best ${j.baseline.baselineOrigin})` : ''}</h3>
          {j.baseline.isBaseline ? (
            <p className="muted">This is the baseline journey.</p>
          ) : j.baseline.breakEvenFareEur !== null ? (
            <dl className="kv" data-testid="deal-break-even">
              <dt>Airfare vs baseline</dt>
              <dd className="mono">{formatEur(j.baseline.airfareSavingVsBaseline, { sign: true })}</dd>
              <dt>True cost vs baseline</dt>
              <dd className="mono" data-testid="deal-true-cost-vs-baseline">
                {formatEur(j.baseline.savingVsBaseline, { sign: true })}
                {j.baseline.airfareSavingVsBaseline !== null && j.baseline.savingVsBaseline !== null && j.baseline.airfareSavingVsBaseline > 0 && (
                  <span className="muted"> — the {formatEur(j.baseline.airfareSavingVsBaseline)} airfare advantage {j.baseline.savingVsBaseline <= 0 ? 'disappears' : `shrinks to ${formatEur(j.baseline.savingVsBaseline)}`} once positioning, hotel and transfer costs are included</span>
                )}
              </dd>
              <dt>Extra burden</dt>
              <dd className="mono">{j.baseline.extraMinutesVsBaseline !== null ? formatDuration(Math.max(0, j.baseline.extraMinutesVsBaseline)) : '—'}</dd>
              <dt>Break-even airfare</dt>
              <dd className="mono">
                {formatEur(j.baseline.breakEvenFareEur)} <span className="muted">— {it.originAirport} only pays off while its fare stays below this</span>
              </dd>
              {j.baseline.breakEvenFareWithTimeEur !== null && (
                <>
                  <dt>Incl. value of time</dt>
                  <dd className="mono">{formatEur(j.baseline.breakEvenFareWithTimeEur)}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="muted">No baseline available.</p>
          )}
        </div>
      </div>
      <p className="tiny muted">
        Reference prices are medians of this application&apos;s own observed {cabin} fares. Maximum fares, list prices and marketing &quot;was&quot; prices are never used as a baseline.
      </p>
    </div>
  );
}
