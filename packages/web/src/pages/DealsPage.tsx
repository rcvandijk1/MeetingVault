import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CABINS, CABIN_QUALITY_LABELS, DEAL_LEVELS, DEAL_LEVEL_LABELS, FARE_CONFIDENCES, type CabinQualityLabel, type DealLevel, type FareConfidence, type ScoredJourney } from '@kfr/core';
import { useDeals, useProfiles, useRuns } from '../api/hooks';
import { CabinQualityBadge, DealBadge, OpportunityChip, ScorePill } from '../components/Badges';
import { JourneyDetail } from '../components/JourneyDetail';
import { Card, Check, Chips, Drawer, Empty, Field, Loading, Stat } from '../components/ui';
import { CABIN_QUALITY_TEXT, DEAL_COLORS, OPPORTUNITY_TEXT, cabinLabel, fmtDate, fmtInstant, fmtSignedPct, formatDuration, formatEur, routeOf } from '../lib/format';
import { DEFAULT_SORT_DIR, sortJourneys, type SortKey } from '../lib/journeys';

const DEAL_SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'dealScore', label: 'Deal score' },
  { key: 'percentOfMedian', label: '% of historical median' },
  { key: 'savingVsMedian', label: 'Saving vs median' },
  { key: 'airfare', label: 'Airfare' },
  { key: 'trueCost', label: 'True journey cost' },
  { key: 'score', label: 'Journey value score' },
  { key: 'doorToDoor', label: 'Door-to-door time' },
];

/**
 * Deal Explorer. Defaults to the Business Class deal detector view: every
 * business journey of the latest run, classified against its historical cohort,
 * with the current-market position and opportunity events alongside.
 */
export function DealsPage() {
  const profiles = useProfiles();
  const runs = useRuns();
  const [runId, setRunId] = useState<string>('');
  const [cabin, setCabin] = useState<string>('BUSINESS');
  const deals = useDeals({ runId: runId || undefined, cabin: cabin || undefined });
  const [levels, setLevels] = useState<DealLevel[]>([]);
  const [confidences, setConfidences] = useState<FareConfidence[]>([]);
  const [qualities, setQualities] = useState<CabinQualityLabel[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(0);
  const [opportunitiesOnly, setOpportunitiesOnly] = useState(false);
  const [nonDominated, setNonDominated] = useState(false);
  const [sort, setSort] = useState<SortKey>('dealScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [open, setOpen] = useState<ScoredJourney | null>(null);

  const data = deals.data;
  const profile = data?.run?.profileId ? profiles.data?.find((p) => p.id === data.run!.profileId) : profiles.data?.find((p) => p.isDefault);
  const weights = profile?.scoringWeights ?? data?.journeys[0]?.categoryScores;
  const originOptions = useMemo(() => [...new Set((data?.journeys ?? []).map((j) => j.itinerary.originAirport))].sort(), [data]);

  const filtered = useMemo(() => {
    const list = (data?.journeys ?? []).filter((j) => {
      if (levels.length && !levels.includes(j.deal.level)) return false;
      if (confidences.length && !confidences.includes(j.deal.confidence)) return false;
      if (qualities.length && !qualities.includes(j.deal.cabinQuality.label)) return false;
      if (origins.length && !origins.includes(j.itinerary.originAirport)) return false;
      if (minScore > 0 && (j.deal.dealScore ?? -1) < minScore) return false;
      if (opportunitiesOnly && j.deal.opportunities.length === 0) return false;
      if (nonDominated && j.paretoDominated) return false;
      return true;
    });
    return sortJourneys(list, sort, sortDir);
  }, [data, levels, confidences, qualities, origins, minScore, opportunitiesOnly, nonDominated, sort, sortDir]);

  const toggle = <T,>(list: T[], v: T, set: (l: T[]) => void): void => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const best = filtered[0];
  const withHistory = (data?.journeys ?? []).filter((j) => j.deal.source === 'HISTORY').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Deal Explorer</h1>
          <p>Every fare judged against its own history: classification, deal score and confidence, separate from the current-market position and from the journey value score.</p>
        </div>
        <div className="row">
          <select value={cabin} onChange={(e) => setCabin(e.target.value)} data-testid="deals-cabin">
            <option value="">All cabins</option>
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {cabinLabel(c)} class deals
              </option>
            ))}
          </select>
          <select value={runId} onChange={(e) => setRunId(e.target.value)} data-testid="deals-run">
            <option value="">Latest search</option>
            {runs.data?.filter((r) => r.status === 'COMPLETED').map((r) => (
              <option key={r.id} value={r.id}>
                {fmtInstant(r.startedAt)} · {r.profileName ?? 'profile'} · {r.resultCount}
              </option>
            ))}
          </select>
        </div>
      </div>

      {deals.isLoading && <Loading label="Loading deals…" />}
      {data && !data.run && (
        <Card>
          <Empty>
            No completed search yet. Run one from the <Link to="/">Radar</Link>.
          </Empty>
        </Card>
      )}
      {data && data.run && (
        <div className="stack">
          <div className="deal-counts" data-testid="deal-summary">
            {DEAL_LEVELS.map((lvl) => (
              <div key={lvl} className="deal-count" style={{ ['--lvl' as string]: DEAL_COLORS[lvl] }} data-testid={`deal-summary-${lvl}`}>
                <div className="n">{data.summary.byClassification[lvl] ?? 0}</div>
                <div className="l">{DEAL_LEVEL_LABELS[lvl]}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-4">
            <Stat label="Best deal" value={best ? <DealBadge level={best.deal.level} deal={best.deal} /> : '—'} sub={best ? `${routeOf(best.itinerary.outbound)} · ${formatEur(best.itinerary.fareEur)} · ${best.deal.percentOfMedian !== null ? `${Math.round(best.deal.percentOfMedian)}% of median` : 'no reference'}` : undefined} testId="deals-best" />
            <Stat label="Historical baseline coverage" value={`${withHistory} / ${data.summary.total}`} sub={`journeys with a historical cohort · ${data.observationCount.toLocaleString('en-GB')} observations stored`} testId="deals-coverage" />
            <Stat label="Confidence" value={FARE_CONFIDENCES.map((c) => `${data.summary.byConfidence[c] ?? 0} ${c.toLowerCase()}`).join(' · ')} sub="high needs 20+ comparable fares on 5+ days" />
            <Stat label="Opportunities" value={data.opportunities.length} sub={Object.entries(data.opportunities.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.type]: (acc[o.type] ?? 0) + 1 }), {})).map(([t, n]) => `${n} ${OPPORTUNITY_TEXT[t as keyof typeof OPPORTUNITY_TEXT].toLowerCase()}`).join(' · ') || 'none in this run'} testId="deals-opportunities" />
          </div>

          <div className="results-layout">
            <div className="stack">
              <Card title="Filters" testId="deals-filters">
                <div className="stack">
                  <Field label="Classification">
                    <Chips options={DEAL_LEVELS} selected={levels} onToggle={(v) => toggle(levels, v, setLevels)} labels={DEAL_LEVEL_LABELS} />
                  </Field>
                  <Field label="Confidence">
                    <Chips options={FARE_CONFIDENCES} selected={confidences} onToggle={(v) => toggle(confidences, v, setConfidences)} />
                  </Field>
                  <Field label="Cabin quality">
                    <Chips options={CABIN_QUALITY_LABELS} selected={qualities} onToggle={(v) => toggle(qualities, v, setQualities)} labels={CABIN_QUALITY_TEXT} />
                  </Field>
                  <Field label="Origin">
                    <Chips options={originOptions} selected={origins} onToggle={(v) => toggle(origins, v, setOrigins)} />
                  </Field>
                  <Field label={`Minimum deal score: ${minScore}`}>
                    <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} data-testid="deals-min-score" />
                  </Field>
                  <Check label="Only journeys with an opportunity event" checked={opportunitiesOnly} onChange={setOpportunitiesOnly} testId="deals-opportunities-only" />
                  <Check label="Hide Pareto-dominated journeys" checked={nonDominated} onChange={setNonDominated} />
                </div>
              </Card>
              <Card title="How to read this">
                <ul className="explain tiny">
                  <li>Classification compares the fare with the median of comparable observed fares (same cabin quality, same route where possible). ≤60% exceptional, ≤72% excellent, ≤85% good, 85–115% normal, ≤135% expensive.</li>
                  <li>Deal score (0–100) is not a discount: it blends percentile rank, distance below the median and to the low, and is pulled towards 50 when confidence is low. Mixed-cabin fares lose points.</li>
                  <li>Journey value is the weighted score of all nine categories; a great fare from a bad airport can still be a poor journey.</li>
                </ul>
              </Card>
            </div>
            <Card
              title={`${filtered.length} ${cabin ? `${cabinLabel(cabin as 'BUSINESS').toLowerCase()} ` : ''}journeys · ${fmtInstant(data.run.finishedAt)}`}
              testId="deals-table-card"
              actions={
                <label className="field" style={{ minWidth: 200 }}>
                  <select
                    value={sort}
                    data-testid="deals-sort"
                    onChange={(e) => {
                      const k = e.target.value as SortKey;
                      setSort(k);
                      setSortDir(DEFAULT_SORT_DIR[k]);
                    }}
                  >
                    {DEAL_SORTS.map((o) => (
                      <option key={o.key} value={o.key}>
                        Sort: {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              }
            >
              <div className="table-wrap">
                <table data-testid="deals-table">
                  <thead>
                    <tr>
                      <th>Fare deal</th>
                      <th>Journey</th>
                      <th>Dates</th>
                      <th className="right">Airfare</th>
                      <th className="right">vs median</th>
                      <th className="right">Saving</th>
                      <th>Market</th>
                      <th>Trend</th>
                      <th className="right">True cost</th>
                      <th>Journey value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((j) => {
                      const it = j.itinerary;
                      const d = j.deal;
                      return (
                        <tr key={it.id} className={`clickable ${j.paretoDominated ? 'dominated' : ''}`} data-testid="deal-row" onClick={() => setOpen(j)}>
                          <td>
                            <DealBadge level={d.level} deal={d} compact />
                            <div className="tiny muted">{d.source === 'HISTORY' ? `level ${d.cohort?.level} · ${d.comparableObservations} fares` : d.source === 'SEARCH_DISTRIBUTION' ? 'this search only' : 'no reference'}</div>
                          </td>
                          <td>
                            <div className="route">{routeOf(it.outbound)}</div>
                            <div className="small dim">
                              {it.primaryAirlineName ?? it.primaryAirline} · <CabinQualityBadge label={d.cabinQuality.label} cabin={it.cabinSummary.requestedCabin} />
                            </div>
                            <div className="labels">
                              {d.opportunities.map((o) => (
                                <OpportunityChip key={o.id} o={o} />
                              ))}
                            </div>
                          </td>
                          <td>
                            <div className="mono">{fmtDate(it.outbound.departureLocal)}</div>
                            <div className="tiny muted">{j.tripDays} days</div>
                          </td>
                          <td className="right mono">{formatEur(it.fareEur)}</td>
                          <td className="right">
                            <div className="mono">{d.percentOfMedian !== null ? `${Math.round(d.percentOfMedian)}%` : '—'}</div>
                            <div className="tiny muted">{d.referenceFare !== null ? `median ${formatEur(d.referenceFare)}` : ''}</div>
                          </td>
                          <td className="right mono">{formatEur(d.savingVsMedianEur, { sign: true })}</td>
                          <td className="small">{d.market.rank !== null ? `#${d.market.rank}/${d.market.comparableCount} · ${fmtSignedPct(d.market.percentAboveBest)} vs best` : '—'}</td>
                          <td className="small">{d.trend ? (d.trend.isNewLow ? <span className="badge good">new low</span> : `${fmtSignedPct(d.trend.changeVsPreviousPercent, 1)} · seen ${d.trend.timesSeenBefore}×`) : <span className="muted">first seen</span>}</td>
                          <td className="right">
                            <div className="mono strong">{formatEur(j.cost.trueJourneyCost)}</div>
                            <div className="tiny muted">{formatDuration(j.doorToKrabiMinutes)} door → Krabi</div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <ScorePill score={j.journeyValueScore} onClick={() => setOpen(j)} />
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={10} className="center muted" style={{ padding: 30 }}>
                          No journeys match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
      {open && weights && (
        <Drawer title="Journey" onClose={() => setOpen(null)} testId="journey-drawer">
          <JourneyDetail journey={open} weights={weights} baselineOrigin={profile?.baselineOrigin} />
        </Drawer>
      )}
    </div>
  );
}
