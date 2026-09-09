import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Play, Save } from 'lucide-react';
import type { TripProfile } from '@kfr/core';
import { api, type TripProfileInput } from '../api/client';
import { useInvalidate, useProfiles, useRun, useRunSearch, useRuns } from '../api/hooks';
import { ProfileForm } from '../components/ProfileForm';
import { ResultsView } from '../components/ResultsView';
import { Card, Loading, Modal, TextField } from '../components/ui';
import { fmtInstant, formatDuration } from '../lib/format';

const toInput = (p: TripProfile): TripProfileInput => {
  const { id: _id, ...rest } = p;
  void _id;
  return rest;
};

export function SearchPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const profiles = useProfiles();
  const runs = useRuns();
  const runQuery = useRun(runId);
  const runSearch = useRunSearch();
  const invalidate = useInvalidate();
  const [profileId, setProfileId] = useState<string>('');
  const [config, setConfig] = useState<TripProfileInput | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialise the editable configuration from the selected (or default) profile.
  useEffect(() => {
    if (!profiles.data || config) return;
    const p = profiles.data.find((x) => x.isDefault) ?? profiles.data[0];
    if (p) {
      setProfileId(p.id);
      setConfig(toInput(p));
    }
  }, [profiles.data, config]);

  const selectProfile = (id: string): void => {
    const p = profiles.data?.find((x) => x.id === id);
    if (!p) return;
    setProfileId(id);
    setConfig(toInput(p));
  };

  const run = (): void => {
    if (!config) return;
    runSearch.mutate({ profileId: profileId || undefined, overrides: config }, { onSuccess: (r) => navigate(`/search/${r.run.id}`) });
  };

  const save = async (): Promise<void> => {
    if (!config || saveName === null) return;
    setSaveError(null);
    try {
      const created = await api.createProfile({ ...config, name: saveName, isDefault: false });
      await invalidate(['profiles']);
      setSaveName(null);
      setProfileId(created.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save profile');
    }
  };

  const result = runQuery.data;
  const profileForResults = result?.run.profileSnapshot;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Search</h1>
          <p>Configure the trip, run the two-stage search across all enabled departure airports and gateways, and inspect the ranked journeys.</p>
        </div>
        <div className="row">
          <select value={profileId} data-testid="search-profile" onChange={(e) => selectProfile(e.target.value)}>
            {profiles.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setSaveName(config?.name ? `${config.name} (copy)` : 'New profile')} disabled={!config} data-testid="search-save-profile">
            <Save size={14} /> Save as profile
          </button>
          <button className="btn primary" onClick={run} disabled={!config || runSearch.isPending} data-testid="search-run">
            {runSearch.isPending ? <span className="spinner" /> : <Play size={14} />} Run search
          </button>
        </div>
      </div>

      {runSearch.error && <p className="error">{runSearch.error.message}</p>}

      <div className="stack">
        <Card title="Search configuration" testId="search-config">
          {config ? <ProfileForm value={config} onChange={setConfig} showName={false} /> : <Loading />}
        </Card>

        {runId && runQuery.isLoading && <Loading label="Loading results…" />}
        {result && profileForResults && (
          <>
            <Card testId="run-summary">
              <div className="row between">
                <div>
                  <span className="strong">Run {result.run.id.slice(0, 8)}</span> · {result.run.profileName} · {fmtInstant(result.run.finishedAt)} · {result.run.stats ? `${result.run.stats.datePairs} date pairs, ${result.run.stats.discoveryCalls} discovery + ${result.run.stats.searchCalls} live searches (${result.run.stats.cacheHits} cached), ${result.run.stats.received} offers, ${result.run.stats.afterDedup} unique, ${result.run.stats.rejected} rejected by hard rules, ${result.run.stats.scored} scored in ${formatDuration(Math.round(result.run.stats.durationMs / 60000))}` : ''}
                </div>
                {result.run.providerErrors.length > 0 && <span className="badge danger">{result.run.providerErrors.length} provider error(s)</span>}
              </div>
              {result.rejected.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="small dim" data-testid="rejected-toggle">
                    {result.rejected.length} itineraries rejected by hard constraints
                  </summary>
                  <table className="small" style={{ marginTop: 6 }}>
                    <tbody>
                      {result.rejected.slice(0, 50).map((r) => (
                        <tr key={r.itineraryId}>
                          <td className="mono nowrap">
                            {r.originAirport} → {r.arrivalGateway}
                          </td>
                          <td className="mono">€{Math.round(r.fareEur)}</td>
                          <td className="dim">{r.reasons.join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </Card>
            <ResultsView journeys={result.journeys} profile={profileForResults} initialWeights={config?.scoringWeights} title="Ranked journeys" runId={result.run.id} />
          </>
        )}

        {!runId && (
          <Card title="Recent search runs">
            {runs.data && runs.data.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Profile</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th className="right">Journeys</th>
                    <th className="right">Rejected</th>
                    <th className="right">Live calls</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => navigate(`/search/${r.id}`)} data-testid="run-row">
                      <td className="mono">{fmtInstant(r.startedAt)}</td>
                      <td>{r.profileName ?? '—'}</td>
                      <td>{r.trigger}</td>
                      <td>{r.status}</td>
                      <td className="right mono">{r.resultCount}</td>
                      <td className="right mono">{r.stats?.rejected ?? '—'}</td>
                      <td className="right mono">{r.stats?.searchCalls ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No searches yet. Press “Run search”.</p>
            )}
          </Card>
        )}
        {runId && (
          <p className="small">
            <Link to="/search">← All runs</Link>
          </p>
        )}
      </div>

      {saveName !== null && (
        <Modal title="Save configuration as profile" onClose={() => setSaveName(null)} testId="save-profile-modal">
          <div className="stack">
            <TextField label="Profile name" value={saveName} onChange={setSaveName} testId="save-profile-name" />
            {saveError && <p className="error">{saveError}</p>}
            <div className="row">
              <button className="btn primary" onClick={() => void save()} data-testid="save-profile-confirm">
                Save
              </button>
              <button className="btn" onClick={() => setSaveName(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
