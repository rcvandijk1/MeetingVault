import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CABINS } from '@kfr/core';
import { useHistory, useHistorySummary, useReference } from '../api/hooks';
import { Card, Chips, Empty, Field, Loading } from '../components/ui';
import { cabinLabel, fmtInstant, formatEur } from '../lib/format';

const SERIES_COLORS = ['#4cc9f0', '#7cf5c2', '#f6c667', '#b28dff', '#ff8bd1', '#8fd694', '#ff7b7b', '#59c2ff', '#e6edf7', '#7b8aa5'];

export function HistoryPage() {
  const ref = useReference();
  const summary = useHistorySummary();
  const [origins, setOrigins] = useState<string[]>([]);
  const [gateway, setGateway] = useState<string>('');
  const [cabin, setCabin] = useState<string>('BUSINESS');
  const [days, setDays] = useState<number>(365);
  const history = useHistory({ gateway: gateway || undefined, cabin: cabin || undefined, days });

  const originOptions = useMemo(() => [...new Set((summary.data ?? []).map((s) => s.originAirport))].sort(), [summary.data]);

  // One series per origin: lowest fare per observation time (minute granularity).
  const chart = useMemo(() => {
    const obs = (history.data?.observations ?? []).filter((o) => origins.length === 0 || origins.includes(o.originAirport));
    const byTime = new Map<number, Record<string, number>>();
    const series = new Set<string>();
    for (const o of obs) {
      const t = Math.floor(new Date(o.observedAt).getTime() / 60000) * 60000;
      const row = byTime.get(t) ?? {};
      const key = `${o.originAirport}→${o.arrivalGateway}`;
      series.add(key);
      row[key] = Math.min(row[key] ?? Infinity, o.fareEur);
      byTime.set(t, row);
    }
    const points = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, row]) => ({ t, ...row }));
    return { points, series: [...series].sort() };
  }, [history.data, origins]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Price history</h1>
          <p>Every fare observation is stored. Compare how routes from different origins move over time.</p>
        </div>
      </div>
      <div className="stack">
        <Card title="Filters">
          <div className="grid grid-3">
            <Field label="Origins (none = all)">
              <Chips options={originOptions} selected={origins} onToggle={(o) => setOrigins(origins.includes(o) ? origins.filter((x) => x !== o) : [...origins, o])} />
            </Field>
            <Field label="Gateway">
              <select value={gateway} onChange={(e) => setGateway(e.target.value)} data-testid="history-gateway">
                <option value="">All</option>
                <option value="KBV">KBV</option>
                <option value="HKT">HKT</option>
              </select>
            </Field>
            <div className="grid grid-2">
              <Field label="Cabin">
                <select value={cabin} onChange={(e) => setCabin(e.target.value)}>
                  <option value="">All</option>
                  {CABINS.map((c) => (
                    <option key={c} value={c}>
                      {cabinLabel(c)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Days">
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {[7, 30, 90, 365, 1095].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Card>
        <Card title={`Fare over time · ${history.data?.count ?? 0} observations`} testId="history-chart">
          {history.isLoading && <Loading />}
          {chart.points.length === 0 && !history.isLoading && <Empty>No observations yet. Run a search to start collecting price history.</Empty>}
          {chart.points.length > 0 && (
            <div style={{ height: 360 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart.points} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#223049" strokeDasharray="3 3" />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} stroke="#7b8aa5" fontSize={11} />
                  <YAxis tickFormatter={(v: number) => `€${v}`} stroke="#7b8aa5" fontSize={11} width={60} />
                  <Tooltip contentStyle={{ background: '#111a2b', border: '1px solid #223049', fontSize: 12 }} labelFormatter={(t) => fmtInstant(new Date(Number(t)).toISOString())} formatter={(v: number) => formatEur(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {chart.series.map((s, i) => (
                    <Line key={s} type="monotone" dataKey={s} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Routes observed" testId="history-summary">
          {summary.data && summary.data.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Origin</th>
                    <th>Gateway</th>
                    <th>Cabin</th>
                    <th className="right">Observations</th>
                    <th className="right">Lowest</th>
                    <th className="right">Median</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.map((s) => (
                    <tr key={`${s.originAirport}-${s.arrivalGateway}-${s.cabin}`}>
                      <td className="strong">
                        {s.originAirport} <span className="muted tiny">{ref.data?.airports.find((a) => a.code === s.originAirport)?.city}</span>
                      </td>
                      <td>{s.arrivalGateway}</td>
                      <td>{cabinLabel(s.cabin as 'BUSINESS')}</td>
                      <td className="right mono">{s.count}</td>
                      <td className="right mono">{formatEur(s.minFareEur)}</td>
                      <td className="right mono">{formatEur(s.medianFareEur)}</td>
                      <td className="mono">{fmtInstant(s.lastObservedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No observations yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
