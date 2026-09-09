import { useState } from 'react';
import { buildOriginMatrix, type MatrixMetric, type ScoredJourney } from '@kfr/core';
import { formatDuration, formatEur, fmtScore } from '../lib/format';

const METRICS: Array<{ key: MatrixMetric; label: string }> = [
  { key: 'airfare', label: 'Airfare' },
  { key: 'trueCost', label: 'True journey cost' },
  { key: 'score', label: 'Overall score' },
  { key: 'doorToDoor', label: 'Door-to-door' },
];

export function OriginMatrix({ journeys, gateways, onSelect }: { journeys: ScoredJourney[]; gateways?: string[]; onSelect?: (itineraryId: string) => void }) {
  const [metric, setMetric] = useState<MatrixMetric>('trueCost');
  const matrix = buildOriginMatrix(journeys, metric, gateways);
  const fmt = (c: NonNullable<ReturnType<typeof buildOriginMatrix>['rows'][number]['cells'][string]>): string => {
    switch (metric) {
      case 'airfare':
        return formatEur(c.airfare);
      case 'trueCost':
        return formatEur(c.trueCost);
      case 'score':
        return fmtScore(c.score);
      case 'doorToDoor':
        return formatDuration(c.doorToDoor);
    }
  };
  return (
    <div data-testid="origin-matrix">
      <div className="row" style={{ marginBottom: 10 }}>
        {METRICS.map((m) => (
          <button key={m.key} type="button" className={`btn sm ${metric === m.key ? 'active' : ''}`} data-testid={`matrix-metric-${m.key}`} onClick={() => setMetric(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Origin</th>
              {matrix.gateways.map((g) => (
                <th key={g} className="right">
                  {g}
                </th>
              ))}
              <th className="right">Best</th>
              <th className="right">Best score</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((r) => (
              <tr key={r.origin} data-testid={`matrix-row-${r.origin}`}>
                <td className="strong">{r.origin}</td>
                {matrix.gateways.map((g) => {
                  const c = r.cells[g];
                  return (
                    <td key={g} className={`right cell ${c ? '' : 'empty'} ${r.best === g ? 'best' : ''}`} onClick={() => c && onSelect?.(c.itineraryId)} title={c ? 'Open journey' : 'No acceptable journey'}>
                      {c ? fmt(c) : '—'}
                    </td>
                  );
                })}
                <td className="right strong">{r.best ?? '—'}</td>
                <td className="right mono">{r.bestScore === null ? '—' : fmtScore(r.bestScore)}</td>
              </tr>
            ))}
            {matrix.rows.length === 0 && (
              <tr>
                <td colSpan={matrix.gateways.length + 3} className="muted center">
                  No journeys.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
