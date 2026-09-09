import { useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldOff, Play } from 'lucide-react';
import type { ScoredJourney } from '@kfr/core';
import { api, type Verification } from '../api/client';
import { useInvalidate, useVerifications } from '../api/hooks';
import { fmtInstant, formatEur } from '../lib/format';

/** Compact "final price" cell for the results table. */
export function FinalPriceCell({ journey, verification }: { journey: ScoredJourney; verification?: Verification }) {
  const vf = journey.itinerary.verifiedFare;
  if (vf) {
    const delta = journey.cost.bookingFees;
    return (
      <div data-testid="row-final-price" data-status="VERIFIED">
        <div className="mono strong" style={{ color: 'var(--c-accent-2)' }}>
          <ShieldCheck size={12} style={{ verticalAlign: '-2px' }} /> {formatEur(vf.amountEur)}
        </div>
        <div className="tiny muted">{delta === 0 ? 'as quoted' : `${formatEur(delta, { sign: true })} fees`}</div>
      </div>
    );
  }
  const status = verification?.status;
  if (status === 'QUEUED' || status === 'RUNNING') {
    return (
      <div className="tiny muted" data-testid="row-final-price" data-status={status}>
        <span className="spinner" style={{ width: 10, height: 10, marginRight: 4 }} /> {status === 'RUNNING' ? 'checking booking…' : 'queued'}
      </div>
    );
  }
  if (status === 'FAILED') {
    return (
      <div className="tiny" style={{ color: 'var(--c-warn)' }} data-testid="row-final-price" data-status="FAILED" title={verification?.error ?? ''}>
        <ShieldAlert size={12} style={{ verticalAlign: '-2px' }} /> check failed
      </div>
    );
  }
  if (status === 'UNSUPPORTED') {
    return (
      <div className="tiny muted" data-testid="row-final-price" data-status="UNSUPPORTED" title={verification?.error ?? ''}>
        <ShieldOff size={12} style={{ verticalAlign: '-2px' }} /> no flow
      </div>
    );
  }
  return (
    <div className="tiny muted" data-testid="row-final-price" data-status="NONE">
      —
    </div>
  );
}

const STATUS_TEXT: Record<Verification['status'], string> = {
  QUEUED: 'Queued for booking-flow check',
  RUNNING: 'Walking the booking flow…',
  VERIFIED: 'Final price verified on the payment page',
  FAILED: 'Booking-flow check failed',
  UNSUPPORTED: 'No automated booking flow for this channel',
};

/** Full verification panel for the journey drawer: status, breakdown, steps and screenshots. */
export function VerificationPanel({ journey }: { journey: ScoredJourney }) {
  const it = journey.itinerary;
  const query = useVerifications({ ids: [it.id] });
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const v = query.data?.[0];
  const pending = v?.status === 'QUEUED' || v?.status === 'RUNNING';

  const verifyNow = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.verifyItinerary(it.id);
      await invalidate(['verifications']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="verification-panel">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h3>Booking-flow price check</h3>
        <button className="btn sm" disabled={busy || pending} onClick={() => void verifyNow()} data-testid="verify-now">
          <Play size={12} /> {pending ? 'Running…' : v ? 'Check again' : 'Check final price'}
        </button>
      </div>
      {!v && <p className="small muted">Not checked yet. The top-ranked journeys of each search are checked automatically; press the button to check this one.</p>}
      {v && (
        <div className="stack">
          <div className="row">
            <span className={`badge ${v.status === 'VERIFIED' ? 'good' : v.status === 'FAILED' ? 'danger' : v.status === 'UNSUPPORTED' ? '' : 'accent'}`} data-testid="verification-status">
              {v.status}
            </span>
            <span className="small dim">{STATUS_TEXT[v.status]}</span>
            {v.driver && <span className="tiny muted">via {v.driver}</span>}
          </div>
          {v.error && <p className="error small">{v.error}</p>}
          {v.status === 'VERIFIED' && (
            <table className="cost-table">
              <tbody>
                {v.breakdown.map((b, i) => (
                  <tr key={i}>
                    <td>{b.label}</td>
                    <td>
                      {v.finalCurrency} {b.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Final price at payment step</td>
                  <td data-testid="verification-final">{formatEur(v.finalPriceEur)}</td>
                </tr>
                <tr>
                  <td className="muted">Quoted fare</td>
                  <td className="muted">{formatEur(it.fareEur)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {v.steps.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 4 }}>Steps</h3>
              {v.steps.map((s, i) => (
                <div key={i} className={`reason ${s.ok ? 'plus' : 'minus'}`} data-testid="verification-step">
                  <span className="sign">{s.ok ? '✓' : '✗'}</span>
                  <span>
                    {s.name}
                    {s.note && <span className="muted"> · {s.note}</span>}
                    {s.screenshotUrl && (
                      <button type="button" className="btn ghost sm" style={{ marginLeft: 6, padding: '0 6px' }} onClick={() => setPreview(s.screenshotUrl)} data-testid="verification-screenshot">
                        screenshot
                      </button>
                    )}
                  </span>
                </div>
              ))}
              <p className="tiny muted">
                {v.finishedAt ? `Finished ${fmtInstant(v.finishedAt)}` : `Requested ${fmtInstant(v.requestedAt)}`} · attempt {v.attempts}. The flow stops at the payment page; nothing is ever booked.
              </p>
            </div>
          )}
          {preview && (
            <div>
              <img src={preview} alt="Booking step screenshot" style={{ maxWidth: '100%', border: '1px solid var(--c-border-strong)', borderRadius: 6 }} data-testid="verification-screenshot-img" />
              <button className="btn ghost sm" onClick={() => setPreview(null)}>
                Hide screenshot
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
