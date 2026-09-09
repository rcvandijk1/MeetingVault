import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { DEAL_LEVELS } from '@kfr/core';
import { useProfiles, useRadar, useRunSearch } from '../api/hooks';
import { ResultsView } from '../components/ResultsView';
import { Card, Empty, Loading, Stat } from '../components/ui';
import { DEAL_COLORS, fmtInstant, formatEur } from '../lib/format';

export function RadarPage() {
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const radar = useRadar(profileId);
  const run = useRunSearch();
  const data = radar.data;
  const profile = data?.profile ?? profiles.data?.find((p) => p.isDefault) ?? profiles.data?.[0];

  const best = data?.journeys[0];
  const cheapest = data?.journeys.find((j) => j.labels.includes('CHEAPEST'));
  const altOrigin = data?.journeys.find((j) => j.labels.includes('BEST_ALTERNATIVE_ORIGIN'));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Radar</h1>
          <p>Current opportunities for the whole journey from Alphen aan den Rijn to Krabi.</p>
        </div>
        <div className="row">
          <select value={profileId ?? ''} data-testid="radar-profile" onChange={(e) => setProfileId(e.target.value || undefined)}>
            <option value="">Default profile</option>
            {profiles.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={run.isPending} data-testid="radar-run" onClick={() => run.mutate({ profileId: profile?.id })}>
            {run.isPending ? <span className="spinner" /> : <Play size={14} />} Run search now
          </button>
        </div>
      </div>

      {radar.isLoading && <Loading label="Loading radar…" />}
      {run.error && <p className="error">{run.error.message}</p>}

      {data && (
        <div className="stack">
          <div className="deal-counts" data-testid="deal-counts">
            {DEAL_LEVELS.slice().reverse().map((lvl) => (
              <div key={lvl} className="deal-count" style={{ ['--lvl' as string]: DEAL_COLORS[lvl] }} data-testid={`deal-count-${lvl}`}>
                <div className="n">{data.dealCounts[lvl] ?? 0}</div>
                <div className="l">{lvl}</div>
              </div>
            ))}
          </div>

          {data.run ? (
            <>
              <div className="grid grid-4">
                <Stat label="Best overall" value={best ? `${Math.round(best.overallScore)} / 100` : '—'} sub={best ? `${best.itinerary.originAirport} → ${best.itinerary.arrivalGateway} · ${formatEur(best.cost.trueJourneyCost)} true cost` : undefined} testId="stat-best" />
                <Stat label="Cheapest airfare" value={cheapest ? formatEur(cheapest.itinerary.fareEur) : '—'} sub={cheapest ? `${cheapest.itinerary.originAirport} → ${cheapest.itinerary.arrivalGateway} · true ${formatEur(cheapest.cost.trueJourneyCost)}` : undefined} />
                <Stat label="Best alternative origin" value={altOrigin ? altOrigin.itinerary.originAirport : '—'} sub={altOrigin ? (altOrigin.baseline.dominant ? 'cheaper and faster than baseline' : altOrigin.baseline.savingPerExtraHour !== null ? `${formatEur(altOrigin.baseline.savingPerExtraHour)} saved per extra hour` : `${formatEur(altOrigin.baseline.savingVsBaseline, { sign: true })} vs baseline`) : undefined} />
                <Stat label="Last search" value={fmtInstant(data.run.finishedAt)} sub={`${data.run.resultCount} journeys · ${data.run.stats?.rejected ?? 0} rejected by hard rules · ${data.run.providerErrors.length} provider errors`} />
              </div>
              {profile && <ResultsView journeys={data.journeys} profile={profile} title={`Opportunities · ${profile.name}`} />}
            </>
          ) : (
            <Card>
              <Empty>
                No search has been run yet for this profile. <button className="btn primary sm" onClick={() => run.mutate({ profileId: profile?.id })} style={{ marginLeft: 8 }}>Run the first search</button> or configure it on the <Link to="/search">Search</Link> screen.
              </Empty>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
