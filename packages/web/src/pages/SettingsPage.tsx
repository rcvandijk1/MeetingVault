import { useEffect, useState } from 'react';
import { Play, Save, Plus, Trash2 } from 'lucide-react';
import { ACCESS_MODES, GROUND_MODES, type Airport, type DestinationGateway, type GroundTransferProfile, type OriginAccessProfile } from '@kfr/core';
import { api, ApiError, type Settings } from '../api/client';
import { useGateways, useGroundTransfers, useInvalidate, useOrigins, useProviderStatus, useReference, useScheduler, useSettings, useVerificationStatus } from '../api/hooks';
import { Card, Check, Drawer, Field, Loading, NumberField, SelectField, Tabs, TextField } from '../components/ui';
import { fmtInstant, formatDuration, formatEur } from '../lib/format';

type Tab = 'home' | 'origins' | 'destination' | 'thresholds' | 'providers';

function useSaver() {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const wrap = async (fn: () => Promise<unknown>, ok = 'Saved'): Promise<void> => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
    } catch (e) {
      const text = e instanceof ApiError && e.issues ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e instanceof Error ? e.message : 'Failed';
      setMsg({ kind: 'error', text });
    }
  };
  return { msg, wrap };
}

function HomeSettingsCard() {
  const settings = useSettings();
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<Settings | null>(null);
  const { msg, wrap } = useSaver();
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);
  if (!draft) return <Loading />;
  const home = draft.home;
  const setHome = (patch: Partial<Settings['home']>): void => setDraft({ ...draft, home: { ...home, ...patch } });
  return (
    <Card title="Home location" testId="home-settings" actions={<button className="btn primary sm" data-testid="home-save" onClick={() => void wrap(() => api.updateSettings({ home: draft.home }).then(() => invalidate(['settings'])))}><Save size={12} /> Save</button>}>
      {msg && <p className={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</p>}
      <div className="form-grid">
        <TextField label="Home" value={home.name} onChange={(v) => setHome({ name: v })} testId="home-name" />
        <TextField label="Country" value={home.countryCode} onChange={(v) => setHome({ countryCode: v.toUpperCase() })} />
        <TextField label="Timezone (IANA)" value={home.timezone} onChange={(v) => setHome({ timezone: v })} />
        <TextField label="Evening departure when hotel needed" type="time" value={home.hotelEveningDepartureTime} onChange={(v) => setHome({ hotelEveningDepartureTime: v })} testId="home-hotel-evening" />
        <NumberField label="Minimum hotel rest (min)" value={home.minHotelRestMinutes} step={30} onChange={(v) => setHome({ minHotelRestMinutes: v })} />
        <NumberField label="Airport exit on return (min)" value={home.airportExitMinutes} step={5} onChange={(v) => setHome({ airportExitMinutes: v })} />
      </div>
      <h3 style={{ margin: '14px 0 6px' }}>Currency conversion to EUR</h3>
      <div className="form-grid">
        {Object.entries(home.fxRatesToEur)
          .filter(([c]) => c !== 'EUR')
          .map(([c, r]) => (
            <NumberField key={c} label={`1 ${c} =`} value={r} step={0.001} onChange={(v) => setHome({ fxRatesToEur: { ...home.fxRatesToEur, [c]: v } })} hint="EUR" />
          ))}
      </div>
    </Card>
  );
}

function OriginEditor({ origin, onClose }: { origin: OriginAccessProfile; onClose: () => void }) {
  const [d, setD] = useState(origin);
  const invalidate = useInvalidate();
  const { msg, wrap } = useSaver();
  const set = <K extends keyof OriginAccessProfile>(k: K, v: OriginAccessProfile[K]): void => setD({ ...d, [k]: v });
  return (
    <Drawer title={`Origin access · ${d.airportCode}`} onClose={onClose} testId="origin-editor">
      <div className="stack">
        {msg && <p className={msg.kind === 'ok' ? 'success' : 'error'} data-testid="origin-status">{msg.text}</p>}
        <Check label="Enabled as departure airport" checked={d.enabled} onChange={(v) => set('enabled', v)} testId="origin-enabled" />
        <div className="form-grid">
          <SelectField label="Access mode" value={d.preferredAccessMode} options={ACCESS_MODES.map((m) => ({ value: m, label: m.toLowerCase().replace('_', ' ') }))} onChange={(v) => set('preferredAccessMode', v)} />
          <NumberField label="Travel time home → airport (min)" value={d.accessTravelMinutes} step={5} onChange={(v) => set('accessTravelMinutes', v)} testId="origin-travel" />
          <NumberField label="Airport buffer before departure (min)" value={d.airportBufferMinutes} step={5} onChange={(v) => set('airportBufferMinutes', v)} />
          <TextField label="Earliest same-day departure" type="time" value={d.sameDayEarliestDepartureTime} onChange={(v) => set('sameDayEarliestDepartureTime', v)} testId="origin-earliest" />
          <SelectField label="Hotel rule" value={d.hotelRequiredRule} options={[{ value: 'AUTO', label: 'Auto (by departure time)' }, { value: 'ALWAYS', label: 'Always' }, { value: 'NEVER', label: 'Never' }]} onChange={(v) => set('hotelRequiredRule', v)} />
          <NumberField label="Hotel cost per night €" value={d.hotelCost} step={5} onChange={(v) => set('hotelCost', v)} testId="origin-hotel-cost" />
          <TextField label="Latest same-day arrival on return (blank = always)" type="time" value={d.returnHotelLatestArrivalTime ?? ''} onChange={(v) => set('returnHotelLatestArrivalTime', v || null)} />
          <NumberField label="Access cost per direction € (flight/taxi)" value={d.accessMonetaryCost} step={5} onChange={(v) => set('accessMonetaryCost', v)} />
          <NumberField label="Train cost per direction €" value={d.trainCost} step={5} onChange={(v) => set('trainCost', v)} />
          <NumberField label="Fuel cost per direction €" value={d.fuelCost} step={5} onChange={(v) => set('fuelCost', v)} />
          <NumberField label="Toll cost per direction €" value={d.tollCost} step={5} onChange={(v) => set('tollCost', v)} />
          <NumberField label="Parking cost per trip €" value={d.parkingCost} step={5} onChange={(v) => set('parkingCost', v)} />
          <NumberField label="Inconvenience penalty (0–100)" value={d.inconveniencePenalty} min={0} max={100} onChange={(v) => set('inconveniencePenalty', v)} testId="origin-penalty" />
        </div>
        <Field label="Notes">
          <textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="row">
          <button className="btn primary" data-testid="origin-save" onClick={() => void wrap(() => api.saveOrigin(d).then(() => invalidate(['origins'])), 'Origin saved')}>
            <Save size={14} /> Save
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function OriginsCard() {
  const origins = useOrigins();
  const ref = useReference();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<OriginAccessProfile | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const airports = ref.data?.airports ?? [];
  const missing = airports.filter((a) => a.region === 'EUROPE' && !origins.data?.some((o) => o.airportCode === a.code));

  const add = async (): Promise<void> => {
    const code = newCode.trim().toUpperCase();
    if (code.length !== 3) return;
    if (!airports.some((a) => a.code === code)) {
      const airport: Airport = { code, name: code, city: code, country: 'XX', timezone: 'Europe/Amsterdam', region: 'EUROPE' };
      await api.saveAirport(airport);
      await invalidate(['reference']);
    }
    const base = origins.data?.find((o) => o.airportCode === 'AMS');
    const profile: OriginAccessProfile = { ...(base ?? { airportCode: code, enabled: true, preferredAccessMode: 'CAR', accessTravelMinutes: 60, accessMonetaryCost: 0, airportBufferMinutes: 150, sameDayEarliestDepartureTime: '07:00', hotelCost: 100, hotelRequiredRule: 'AUTO', returnHotelLatestArrivalTime: null, parkingCost: 0, trainCost: 0, fuelCost: 0, tollCost: 0, inconveniencePenalty: 10, notes: '' }), airportCode: code, notes: '' };
    await api.saveOrigin(profile);
    await invalidate(['origins']);
    setAdding(false);
    setNewCode('');
    setEditing(profile);
  };

  return (
    <Card
      title="Departure airports & access"
      testId="origins-card"
      actions={
        <div className="row">
          {adding ? (
            <>
              <input list="airport-codes" value={newCode} placeholder="IATA" style={{ width: 90 }} onChange={(e) => setNewCode(e.target.value)} data-testid="origin-new-code" />
              <datalist id="airport-codes">
                {missing.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name}
                  </option>
                ))}
              </datalist>
              <button className="btn sm primary" onClick={() => void add()} data-testid="origin-new-confirm">
                Add
              </button>
              <button className="btn sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn sm" onClick={() => setAdding(true)} data-testid="origin-new">
              <Plus size={12} /> Add airport
            </button>
          )}
        </div>
      }
    >
      <p className="tiny muted" style={{ marginBottom: 8 }}>
        Access and hotel costs are per direction / per night for your party; parking is per trip. Hotel need is derived from the flight time versus the earliest same-day departure.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Airport</th>
              <th>On</th>
              <th>Mode</th>
              <th className="right">Travel</th>
              <th className="right">Cost/dir</th>
              <th className="right">Parking</th>
              <th>Same-day from</th>
              <th className="right">Hotel</th>
              <th className="right">Penalty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {origins.data?.map((o) => (
              <tr key={o.airportCode} className="clickable" onClick={() => setEditing(o)} data-testid={`origin-row-${o.airportCode}`}>
                <td className="strong">
                  {o.airportCode} <span className="muted tiny">{airports.find((a) => a.code === o.airportCode)?.city}</span>
                </td>
                <td>{o.enabled ? <span className="badge good">on</span> : <span className="badge">off</span>}</td>
                <td className="small">{o.preferredAccessMode.toLowerCase().replace('_', ' ')}</td>
                <td className="right mono">{formatDuration(o.accessTravelMinutes)}</td>
                <td className="right mono">{formatEur(o.accessMonetaryCost + o.trainCost + o.fuelCost + o.tollCost)}</td>
                <td className="right mono">{formatEur(o.parkingCost)}</td>
                <td className="mono">{o.sameDayEarliestDepartureTime}</td>
                <td className="right mono">{formatEur(o.hotelCost)}</td>
                <td className="right mono">{o.inconveniencePenalty}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost sm" aria-label="Delete" onClick={() => void (window.confirm(`Remove ${o.airportCode}?`) && api.deleteOrigin(o.airportCode).then(() => invalidate(['origins'])))}>
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <OriginEditor origin={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function DestinationCard() {
  const gateways = useGateways();
  const ground = useGroundTransfers();
  const invalidate = useInvalidate();
  const { msg, wrap } = useSaver();
  const [gw, setGw] = useState<DestinationGateway[] | null>(null);
  const [gt, setGt] = useState<GroundTransferProfile[] | null>(null);
  useEffect(() => {
    if (gateways.data && !gw) setGw(gateways.data);
  }, [gateways.data, gw]);
  useEffect(() => {
    if (ground.data && !gt) setGt(ground.data);
  }, [ground.data, gt]);
  if (!gw || !gt) return <Loading />;
  const saveAll = (): Promise<void> => wrap(async () => {
    for (const g of gw) await api.saveGateway(g);
    for (const t of gt) await api.saveGroundTransfer(t);
    await invalidate(['gateways'], ['ground']);
  }, 'Destination settings saved');
  return (
    <Card title="Krabi gateways & ground transfers" testId="destination-card" actions={<button className="btn primary sm" onClick={() => void saveAll()} data-testid="destination-save"><Save size={12} /> Save</button>}>
      {msg && <p className={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</p>}
      <h3 style={{ marginBottom: 6 }}>Arrival gateways</h3>
      <div className="stack">
        {gw.map((g, i) => (
          <div key={g.code} className="form-grid" style={{ alignItems: 'end' }}>
            <div className="strong">{g.code}</div>
            <Check label="Enabled" checked={g.enabled} onChange={(v) => setGw(gw.map((x, k) => (k === i ? { ...x, enabled: v } : x)))} testId={`gateway-enabled-${g.code}`} />
            <NumberField label="Exit buffer after landing (min)" value={g.exitBufferMinutes} step={5} onChange={(v) => setGw(gw.map((x, k) => (k === i ? { ...x, exitBufferMinutes: v } : x)))} />
            <NumberField label="Check-in buffer on return (min)" value={g.checkInBufferMinutes} step={5} onChange={(v) => setGw(gw.map((x, k) => (k === i ? { ...x, checkInBufferMinutes: v } : x)))} />
          </div>
        ))}
      </div>
      <h3 style={{ margin: '16px 0 6px' }}>Ground transfers to Krabi</h3>
      <div className="stack">
        {gt.map((t, i) => (
          <div key={t.id} className="form-grid" style={{ alignItems: 'end' }}>
            <div className="strong">
              {t.fromCode} → {t.toPlace}
            </div>
            <Check label="Enabled" checked={t.enabled} onChange={(v) => setGt(gt.map((x, k) => (k === i ? { ...x, enabled: v } : x)))} testId={`ground-enabled-${t.id}`} />
            <SelectField label="Mode" value={t.mode} options={GROUND_MODES.map((m) => ({ value: m, label: m.toLowerCase().replace('_', ' ') }))} onChange={(v) => setGt(gt.map((x, k) => (k === i ? { ...x, mode: v } : x)))} />
            <NumberField label="Minutes" value={t.minutes} step={5} onChange={(v) => setGt(gt.map((x, k) => (k === i ? { ...x, minutes: v } : x)))} testId={`ground-minutes-${t.id}`} />
            <NumberField label="Cost per direction €" value={t.monetaryCost} step={5} onChange={(v) => setGt(gt.map((x, k) => (k === i ? { ...x, monetaryCost: v } : x)))} testId={`ground-cost-${t.id}`} />
            <NumberField label="Inconvenience (0–100)" value={t.inconveniencePenalty} min={0} max={100} onChange={(v) => setGt(gt.map((x, k) => (k === i ? { ...x, inconveniencePenalty: v } : x)))} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ThresholdsCard() {
  const settings = useSettings();
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<Settings | null>(null);
  const { msg, wrap } = useSaver();
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);
  if (!draft) return <Loading />;
  return (
    <Card title="Deal levels & alert thresholds" testId="thresholds-card" actions={<button className="btn primary sm" onClick={() => void wrap(() => api.updateSettings({ dealThresholds: draft.dealThresholds, alertThresholds: draft.alertThresholds }).then(() => invalidate(['settings'])))}><Save size={12} /> Save</button>}>
      {msg && <p className={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</p>}
      <div className="grid grid-2">
        <div>
          <h3 style={{ marginBottom: 6 }}>Deal level = % below comparable reference fare</h3>
          <div className="form-grid">
            {(['good', 'excellent', 'exceptional', 'insane'] as const).map((k) => (
              <NumberField key={k} label={`${k} ≥ %`} value={draft.dealThresholds[k]} onChange={(v) => setDraft({ ...draft, dealThresholds: { ...draft.dealThresholds, [k]: v } })} />
            ))}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: 6 }}>Alert channel by overall score</h3>
          <div className="form-grid">
            {(['digest', 'notification', 'immediate', 'urgent'] as const).map((k) => (
              <NumberField key={k} label={`${k} ≥ score`} value={draft.alertThresholds[k]} onChange={(v) => setDraft({ ...draft, alertThresholds: { ...draft.alertThresholds, [k]: v } })} />
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>Below the digest threshold results only appear on the dashboard.</p>
        </div>
      </div>
    </Card>
  );
}

function VerificationCard() {
  const s = useVerificationStatus();
  if (!s.data) return <Loading />;
  const d = s.data;
  return (
    <Card title="Booking-flow price verification" testId="verification-card">
      <dl className="kv">
        <dt>Enabled</dt>
        <dd>{d.enabled ? 'yes' : 'no (VERIFY_ENABLED=false)'}</dd>
        <dt>Queue</dt>
        <dd>
          {d.queued} queued · {d.running} running · concurrency {d.concurrency}
        </dd>
        <dt>Drivers</dt>
        <dd>{d.drivers.map((x) => `${x.name} (${x.kind === 'BROWSER' ? 'headless browser' : 'pricing API'})`).join(', ') || 'none'}</dd>
        <dt>Browser</dt>
        <dd>
          {d.browser.running ? 'running' : 'idle'}
          {d.browser.executablePath && <span className="muted"> · {d.browser.executablePath}</span>}
          {d.browser.lastError && <span className="error"> · {d.browser.lastError}</span>}
        </dd>
        <dt>Processed</dt>
        <dd>
          {d.processed} · {d.verified} verified · {d.failed} failed
          {d.lastError && <span className="error"> · last error: {d.lastError}</span>}
        </dd>
      </dl>
      <p className="tiny muted" style={{ marginTop: 8 }}>
        After each search the top {`VERIFY_TOP_N`} journeys are checked by walking the selling channel's booking process up to the payment page and reading the final price there. Nothing is ever booked or paid. Browser drivers exist per airline / website; API channels (Duffel, Amadeus) use their pricing endpoint.
      </p>
    </Card>
  );
}

function ProvidersCard() {
  const status = useProviderStatus();
  const scheduler = useScheduler();
  const invalidate = useInvalidate();
  const [running, setRunning] = useState(false);
  const s = status.data;
  return (
    <div className="stack">
      <Card title="Flight data providers" testId="providers-card">
        {!s && <Loading />}
        {s && (
          <div className="stack">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Message</th>
                  <th className="right">Calls 24h</th>
                  <th className="right">Live</th>
                  <th className="right">Errors</th>
                  <th className="right">Avg ms</th>
                </tr>
              </thead>
              <tbody>
                {s.health.map((h) => {
                  const u = s.usage24h.find((x) => x.provider === h.provider);
                  return (
                    <tr key={h.provider}>
                      <td className="strong">{h.provider}</td>
                      <td>{h.ok ? <span className="badge good">ok</span> : h.configured ? <span className="badge danger">error</span> : <span className="badge warn">not configured</span>}</td>
                      <td className="small dim">{h.message}</td>
                      <td className="right mono">{u?.calls ?? 0}</td>
                      <td className="right mono">{u?.liveCalls ?? 0}</td>
                      <td className="right mono">{u?.errors ?? 0}</td>
                      <td className="right mono">{u?.avgDurationMs ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="tiny muted">
              Limits: {s.limits.maxConcurrency} concurrent calls, ≥{s.limits.minIntervalMs} ms between live calls, cache {s.limits.cacheTtlMinutes} min. Credentials are configured in the server environment (.env); they are never sent to the browser.
            </p>
            {s.recentErrors.length > 0 && (
              <details>
                <summary className="small">Recent provider errors ({s.recentErrors.length})</summary>
                <table className="small">
                  <tbody>
                    {s.recentErrors.map((e, i) => (
                      <tr key={i}>
                        <td className="mono nowrap">{fmtInstant(e.time)}</td>
                        <td>{e.provider}</td>
                        <td>{e.kind}</td>
                        <td className="dim">{e.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}
      </Card>
      <Card
        title="Background search scheduler"
        testId="scheduler-card"
        actions={
          <button
            className="btn sm"
            disabled={running}
            data-testid="scheduler-run"
            onClick={() => {
              setRunning(true);
              void api.runScheduler().finally(() => {
                setRunning(false);
                void invalidate(['scheduler'], ['runs'], ['radar'], ['history']);
              });
            }}
          >
            <Play size={12} /> Run cycle now
          </button>
        }
      >
        {scheduler.data ? (
          <dl className="kv">
            <dt>Enabled</dt>
            <dd>{scheduler.data.enabled ? `yes, every ${scheduler.data.intervalHours} h` : 'no (SCHEDULER_ENABLED=false)'}</dd>
            <dt>Last run</dt>
            <dd>
              {fmtInstant(scheduler.data.lastRunAt)} {scheduler.data.lastRunStatus ?? ''} {scheduler.data.lastError && <span className="error">{scheduler.data.lastError}</span>}
            </dd>
            <dt>Next run</dt>
            <dd>{fmtInstant(scheduler.data.nextRunAt)}</dd>
            <dt>Cycles / alerts</dt>
            <dd>
              {scheduler.data.runsCompleted} / {scheduler.data.alertsSent}
            </dd>
          </dl>
        ) : (
          <Loading />
        )}
        <p className="tiny muted" style={{ marginTop: 8 }}>Each cycle searches the default profile, appends fare observations and pushes alerts for new or cheaper journeys above the alert thresholds through the configured notification provider.</p>
      </Card>
      <VerificationCard />
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('home');
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Home location, departure airport access, Krabi gateways, thresholds and providers.</p>
        </div>
      </div>
      <Tabs
        tabs={[
          { key: 'home', label: 'Home' },
          { key: 'origins', label: 'Departure airports' },
          { key: 'destination', label: 'Krabi gateways' },
          { key: 'thresholds', label: 'Deal & alerts' },
          { key: 'providers', label: 'Providers & scheduler' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'home' && <HomeSettingsCard />}
      {tab === 'origins' && <OriginsCard />}
      {tab === 'destination' && <DestinationCard />}
      {tab === 'thresholds' && <ThresholdsCard />}
      {tab === 'providers' && <ProvidersCard />}
    </div>
  );
}
