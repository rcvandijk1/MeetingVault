import { Plus, Trash2 } from 'lucide-react';
import type { ScoringParams, SelfTransferPolicy, TimePreferenceBand, TimePreferenceProfile, TransferConstraints } from '@kfr/core';
import { Check, NumberField } from './ui';

export function ConstraintsEditor({ value, onChange, testPrefix }: { value: TransferConstraints; onChange: (c: TransferConstraints) => void; testPrefix: string }) {
  const set = <K extends keyof TransferConstraints>(k: K, v: TransferConstraints[K]): void => onChange({ ...value, [k]: v });
  return (
    <div className="stack" data-testid={`${testPrefix}-constraints`}>
      <div className="form-grid">
        <NumberField label="Max air transfers" value={value.maxAirTransfers} min={0} max={4} onChange={(v) => set('maxAirTransfers', v)} testId={`${testPrefix}-maxAirTransfers`} />
        <NumberField label="Max individual layover (min)" value={value.maxIndividualLayoverMinutes} min={30} step={15} onChange={(v) => set('maxIndividualLayoverMinutes', v)} testId={`${testPrefix}-maxIndividualLayoverMinutes`} />
        <NumberField label="Max total layover (min)" value={value.maxTotalLayoverMinutes} min={30} step={15} onChange={(v) => set('maxTotalLayoverMinutes', v)} />
        <NumberField label="Max air journey (min)" value={value.maxTotalJourneyMinutes} min={300} step={30} onChange={(v) => set('maxTotalJourneyMinutes', v)} />
        <NumberField label="Min connection (min)" value={value.minConnectionMinutes} min={20} step={5} onChange={(v) => set('minConnectionMinutes', v)} />
        <NumberField label="Max self-transfers" value={value.maxSelfTransfers} min={0} max={3} onChange={(v) => set('maxSelfTransfers', v)} />
        <NumberField label="Min self-transfer buffer (min)" value={value.minSelfTransferBufferMinutes} min={30} step={15} onChange={(v) => set('minSelfTransferBufferMinutes', v)} />
      </div>
      <div className="row">
        <Check label="Airport changes allowed" checked={value.airportChangesAllowed} onChange={(v) => set('airportChangesAllowed', v)} testId={`${testPrefix}-airportChangesAllowed`} />
        <Check label="Overnight airport layovers allowed" checked={value.overnightLayoversAllowed} onChange={(v) => set('overnightLayoversAllowed', v)} />
        <Check label="Self-transfer allowed" checked={value.selfTransferAllowed} onChange={(v) => set('selfTransferAllowed', v)} testId={`${testPrefix}-selfTransferAllowed`} />
        <Check label="Mixed tickets allowed" checked={value.mixedTicketAllowed} onChange={(v) => set('mixedTicketAllowed', v)} />
        <Check label="HKT + ground transfer allowed" checked={value.hktGroundTransferAllowed} onChange={(v) => set('hktGroundTransferAllowed', v)} testId={`${testPrefix}-hktGroundTransferAllowed`} />
      </div>
    </div>
  );
}

export function TimeBandsEditor({ label, bands, onChange, testPrefix }: { label: string; bands: TimePreferenceBand[]; onChange: (b: TimePreferenceBand[]) => void; testPrefix: string }) {
  const update = (i: number, patch: Partial<TimePreferenceBand>): void => onChange(bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  return (
    <div className="stack" data-testid={`${testPrefix}-bands`}>
      <div className="row between">
        <h3>{label}</h3>
        <button type="button" className="btn ghost sm" onClick={() => onChange([...bands, { start: '00:00', end: '06:00', score: 0 }])} data-testid={`${testPrefix}-add-band`}>
          <Plus size={12} /> Band
        </button>
      </div>
      <div className="band-row tiny muted">
        <span>From</span>
        <span>To</span>
        <span>Score</span>
        <span />
      </div>
      {bands.map((b, i) => (
        <div key={i} className="band-row">
          <input type="time" value={b.start} onChange={(e) => update(i, { start: e.target.value })} />
          <input type="time" value={b.end} onChange={(e) => update(i, { end: e.target.value })} />
          <input type="number" value={b.score} min={-100} max={100} data-testid={`${testPrefix}-band-${i}-score`} onChange={(e) => update(i, { score: Number(e.target.value) })} />
          <button type="button" className="btn ghost sm" onClick={() => onChange(bands.filter((_, idx) => idx !== i))} aria-label="Remove band">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <p className="tiny muted">Bands may cross midnight (e.g. 23:00 → 07:00). Times outside every band score 0. Scores are normalised so the best band = 100.</p>
    </div>
  );
}

export function TimePreferencesEditor({ value, onChange }: { value: TimePreferenceProfile; onChange: (v: TimePreferenceProfile) => void }) {
  return (
    <div className="grid grid-2">
      <TimeBandsEditor label="Outbound departure (Europe)" bands={value.outboundDeparture} onChange={(b) => onChange({ ...value, outboundDeparture: b })} testPrefix="outboundDeparture" />
      <TimeBandsEditor label="Outbound arrival (Thailand)" bands={value.outboundArrival} onChange={(b) => onChange({ ...value, outboundArrival: b })} testPrefix="outboundArrival" />
      <TimeBandsEditor label="Return departure (Thailand)" bands={value.returnDeparture} onChange={(b) => onChange({ ...value, returnDeparture: b })} testPrefix="returnDeparture" />
      <TimeBandsEditor label="Return arrival (Europe)" bands={value.returnArrival} onChange={(b) => onChange({ ...value, returnArrival: b })} testPrefix="returnArrival" />
    </div>
  );
}

const PARAM_LABELS: Record<keyof ScoringParams, string> = {
  journeyTimePointsPerExtraHour: 'Points lost per extra hour of burden',
  hotelRestBurdenFactor: 'Hotel rest counted as burden (0–1)',
  costPointsPerPercentAboveBest: 'Points lost per % above cheapest',
  idealConnectionMinMinutes: 'Ideal connection min (min)',
  idealConnectionMaxMinutes: 'Ideal connection max (min)',
  pointsPerTransfer: 'Points per transfer',
  pointsPerHourOverIdealConnection: 'Points per hour over ideal',
  shortConnectionMaxPenalty: 'Max penalty for too-short connection',
  overnightLayoverPenalty: 'Overnight layover penalty',
  airportChangePenalty: 'Airport change penalty',
  hotelInconveniencePenalty: 'Hotel needed penalty (origin)',
  selfTransferRiskPenalty: 'Self-transfer penalty',
  selfTransferTightBufferPenalty: 'Tight self-transfer buffer penalty',
  baggageRecheckPenalty: 'Baggage re-check penalty',
  sleepOpportunityMaxBonus: 'Max sleep-opportunity bonus',
  longHaulMinMinutes: 'Long-haul threshold (min)',
  timingDepartureWeight: 'Timing: departure weight',
  timingArrivalWeight: 'Timing: arrival weight',
};

export function ScoringParamsEditor({ value, onChange }: { value: ScoringParams; onChange: (v: ScoringParams) => void }) {
  return (
    <div className="form-grid">
      {(Object.keys(PARAM_LABELS) as Array<keyof ScoringParams>).map((k) => (
        <NumberField key={k} label={PARAM_LABELS[k]} value={value[k]} step={k === 'hotelRestBurdenFactor' || k === 'costPointsPerPercentAboveBest' ? 0.1 : 1} onChange={(v) => onChange({ ...value, [k]: v })} testId={`param-${k}`} />
      ))}
    </div>
  );
}

export function SelfTransferPolicyEditor({ value, onChange }: { value: SelfTransferPolicy; onChange: (v: SelfTransferPolicy) => void }) {
  return (
    <div className="form-grid">
      <NumberField label="Tight buffer threshold (min)" value={value.tightBufferMinutes} step={15} onChange={(v) => onChange({ ...value, tightBufferMinutes: v })} />
      <NumberField label="Extra buffer for baggage re-check (min)" value={value.baggageRecheckExtraMinutes} step={15} onChange={(v) => onChange({ ...value, baggageRecheckExtraMinutes: v })} />
    </div>
  );
}
