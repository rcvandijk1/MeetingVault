import { useEffect, useMemo, useState } from 'react';
import { rescoreJourneys, type ScoreWeights, type ScoredJourney, type TripProfile } from '@kfr/core';
import { useReference, useVerifications } from '../api/hooks';
import type { Verification } from '../api/client';
import { ResultsTable } from './ResultsTable';
import { ResultFiltersPanel } from './ResultFilters';
import { WeightsPanel } from './WeightsPanel';
import { OriginMatrix } from './OriginMatrix';
import { JourneyDetail } from './JourneyDetail';
import { Card, Drawer, Tabs } from './ui';
import { EMPTY_FILTERS, SORT_OPTIONS, applyFilters, type ResultFilters, type SortKey } from '../lib/journeys';

interface Props {
  journeys: ScoredJourney[];
  profile: TripProfile;
  /** Optional externally controlled weights (e.g. from the profile editor). */
  initialWeights?: ScoreWeights;
  title?: string;
  /** Search run the journeys belong to; enables booking-flow verification status. */
  runId?: string;
}

/**
 * Results cockpit shared by the Radar and Search screens: filters, sorting,
 * immediate re-scoring on weight changes, origin matrix and journey detail.
 */
export function ResultsView({ journeys, profile, initialWeights, title, runId }: Props) {
  const ref = useReference();
  const verifications = useVerifications({ runId });
  const verificationByItinerary = useMemo(() => {
    const m = new Map<string, Verification>();
    for (const v of verifications.data ?? []) if (!m.has(v.itineraryId)) m.set(v.itineraryId, v);
    return m;
  }, [verifications.data]);
  const [weights, setWeights] = useState<ScoreWeights>(initialWeights ?? profile.scoringWeights);
  const [filters, setFilters] = useState<ResultFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [open, setOpen] = useState<ScoredJourney | null>(null);
  const [tab, setTab] = useState<'results' | 'matrix'>('results');

  useEffect(() => setWeights(initialWeights ?? profile.scoringWeights), [initialWeights, profile.scoringWeights, profile.id]);

  // Re-score in the browser: category scores are fixed, the weighted overall is recomputed instantly.
  const rescored = useMemo(() => rescoreJourneys(journeys, weights, profile.baselineOrigin), [journeys, weights, profile.baselineOrigin]);
  const filtered = useMemo(() => applyFilters(rescored, filters), [rescored, filters]);
  const current = open ? rescored.find((j) => j.itinerary.id === open.itinerary.id) ?? open : null;

  return (
    <div className="results-layout">
      <div className="stack">
        <ResultFiltersPanel journeys={rescored} filters={filters} onChange={setFilters} airlines={ref.data?.airlines ?? {}} />
        <Card title="Scoring weights" testId="weights-card">
          <p className="tiny muted" style={{ marginBottom: 8 }}>
            Changing weights re-scores the loaded results immediately. Save them in the profile to make them permanent.
          </p>
          <WeightsPanel weights={weights} onChange={setWeights} onReset={() => setWeights(profile.scoringWeights)} compact />
        </Card>
      </div>
      <div className="stack">
        <Card
          title={title ?? 'Journeys'}
          actions={
            <div className="row">
              <Tabs tabs={[{ key: 'results', label: 'Results' }, { key: 'matrix', label: 'Origin matrix' }]} active={tab} onChange={setTab} />
              <label className="field" style={{ minWidth: 180 }}>
                <select
                  value={sort}
                  data-testid="sort-select"
                  onChange={(e) => {
                    const k = e.target.value as SortKey;
                    setSort(k);
                    setSortDir(k === 'score' || k === 'savingPerExtraHour' ? 'desc' : 'asc');
                  }}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      Sort: {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          }
        >
          {tab === 'results' ? (
            <ResultsTable
              journeys={filtered}
              weights={weights}
              baselineOrigin={profile.baselineOrigin}
              collapseSimilar={filters.collapseSimilar}
              verifications={verificationByItinerary}
              onOpen={setOpen}
              sort={sort}
              sortDir={sortDir}
              onSort={(k, d) => {
                setSort(k);
                setSortDir(d);
              }}
            />
          ) : (
            <OriginMatrix journeys={filtered} gateways={profile.enabledArrivalGateways} onSelect={(id) => setOpen(rescored.find((j) => j.itinerary.id === id) ?? null)} />
          )}
        </Card>
      </div>
      {current && (
        <Drawer title="Journey" onClose={() => setOpen(null)} testId="journey-drawer">
          <JourneyDetail journey={current} weights={weights} baselineOrigin={profile.baselineOrigin} />
        </Drawer>
      )}
    </div>
  );
}
