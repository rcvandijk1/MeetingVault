import { useState } from 'react';
import { CABINS, type Cabin } from '@kfr/core';
import type { TripProfileInput } from '../api/client';
import { useGateways, useOrigins } from '../api/hooks';
import { Card, Check, Chips, Field, NumberField, SelectField, Tabs, TextField } from './ui';
import { ConstraintsEditor, ScoringParamsEditor, SelfTransferPolicyEditor, TimePreferencesEditor } from './editors';
import { WeightsPanel } from './WeightsPanel';
import { cabinLabel } from '../lib/format';

type Section = 'trip' | 'airports' | 'constraints' | 'timing' | 'scoring';

export function ProfileForm({ value, onChange, showName = true }: { value: TripProfileInput; onChange: (v: TripProfileInput) => void; showName?: boolean }) {
  const [section, setSection] = useState<Section>('trip');
  const origins = useOrigins();
  const gateways = useGateways();
  const set = <K extends keyof TripProfileInput>(k: K, v: TripProfileInput[K]): void => onChange({ ...value, [k]: v });
  const toggleIn = (k: 'enabledOrigins' | 'enabledArrivalGateways', code: string): void => set(k, value[k].includes(code) ? value[k].filter((x) => x !== code) : [...value[k], code]);
  const originOptions = (origins.data ?? []).filter((o) => o.enabled).map((o) => o.airportCode);
  const gatewayOptions = (gateways.data ?? []).filter((g) => g.enabled).map((g) => g.code);

  return (
    <div className="stack" data-testid="profile-form">
      <Tabs
        tabs={[
          { key: 'trip', label: 'Trip' },
          { key: 'airports', label: 'Airports' },
          { key: 'constraints', label: 'Transfers' },
          { key: 'timing', label: 'Flight times' },
          { key: 'scoring', label: 'Scoring' },
        ]}
        active={section}
        onChange={setSection}
      />

      {section === 'trip' && (
        <div className="stack">
          {showName && <TextField label="Profile name" value={value.name} onChange={(v) => set('name', v)} testId="profile-name" />}
          <div className="form-grid">
            <NumberField label="Passengers" value={value.passengers} min={1} max={9} onChange={(v) => set('passengers', v)} testId="profile-passengers" />
            <TextField label="Outbound earliest" type="date" value={value.outboundEarliestDate} onChange={(v) => set('outboundEarliestDate', v)} testId="profile-outbound-earliest" />
            <TextField label="Outbound latest" type="date" value={value.outboundLatestDate} onChange={(v) => set('outboundLatestDate', v)} testId="profile-outbound-latest" />
            <TextField label="Return earliest" type="date" value={value.returnEarliestDate} onChange={(v) => set('returnEarliestDate', v)} testId="profile-return-earliest" />
            <TextField label="Return latest" type="date" value={value.returnLatestDate} onChange={(v) => set('returnLatestDate', v)} testId="profile-return-latest" />
            <NumberField label="Min trip days" value={value.minTripDays} min={1} onChange={(v) => set('minTripDays', v)} />
            <NumberField label="Preferred days (min)" value={value.preferredTripDaysMin} min={1} onChange={(v) => set('preferredTripDaysMin', v)} />
            <NumberField label="Preferred days (max)" value={value.preferredTripDaysMax} min={1} onChange={(v) => set('preferredTripDaysMax', v)} />
            <NumberField label="Max trip days" value={value.maxTripDays} min={1} onChange={(v) => set('maxTripDays', v)} />
            <NumberField label="Live validation budget (searches per run)" value={value.maxValidationCandidates} min={1} max={500} onChange={(v) => set('maxValidationCandidates', v)} hint="Upper bound of Stage B provider searches" />
          </div>
          <div className="grid grid-2">
            <Field label="Flight classes to search (each is searched and ranked separately)">
              <Chips
                options={CABINS as Cabin[]}
                selected={value.cabins}
                labels={Object.fromEntries(CABINS.map((c) => [c, cabinLabel(c as Cabin)]))}
                onToggle={(c) => set('cabins', value.cabins.includes(c) ? (value.cabins.length > 1 ? value.cabins.filter((x) => x !== c) : value.cabins) : [...value.cabins, c])}
              />
            </Field>
            <SelectField label="Minimum class on feeder / short-haul flights" value={value.feederMinCabin} options={CABINS.map((c) => ({ value: c, label: cabinLabel(c as Cabin) }))} onChange={(v) => set('feederMinCabin', v)} testId="profile-feeder-cabin" />
          </div>
          <div className="row">
            <Check label="Mixed-cabin itineraries allowed" checked={value.mixedCabinAllowed} onChange={(v) => set('mixedCabinAllowed', v)} />
          </div>
          <p className="tiny muted">Long-haul flights must be in the searched class; feeder flights may be lower down to the minimum you set here. Set the minimum equal to the searched class to require it on every flight.</p>
        </div>
      )}

      {section === 'airports' && (
        <div className="stack">
          <Field label="Departure airports (only enabled origin access profiles are listed — manage them in Settings)">
            <Chips options={originOptions} selected={value.enabledOrigins} onToggle={(c) => toggleIn('enabledOrigins', c)} />
          </Field>
          <Field label="Arrival gateways for Krabi">
            <Chips options={gatewayOptions} selected={value.enabledArrivalGateways} onToggle={(c) => toggleIn('enabledArrivalGateways', c)} />
          </Field>
          <div className="form-grid">
            <SelectField label="Baseline origin (for saving per extra hour)" value={value.baselineOrigin} options={originOptions.map((o) => ({ value: o, label: o }))} onChange={(v) => set('baselineOrigin', v)} testId="profile-baseline-origin" />
          </div>
        </div>
      )}

      {section === 'constraints' && (
        <div className="stack">
          <Card title="Outbound hard constraints">
            <ConstraintsEditor value={value.outboundConstraints} onChange={(c) => set('outboundConstraints', c)} testPrefix="outbound" />
          </Card>
          <Card
            title="Return hard constraints"
            actions={
              <button type="button" className="btn ghost sm" onClick={() => set('returnConstraints', { ...value.outboundConstraints })}>
                Copy from outbound
              </button>
            }
          >
            <ConstraintsEditor value={value.returnConstraints} onChange={(c) => set('returnConstraints', c)} testPrefix="return" />
          </Card>
          <Card title="Self-transfer risk policy (soft)">
            <SelfTransferPolicyEditor value={value.selfTransferPolicy} onChange={(v) => set('selfTransferPolicy', v)} />
          </Card>
          <p className="tiny muted">Hard constraints eliminate itineraries before scoring. Everything under Scoring only changes the score.</p>
        </div>
      )}

      {section === 'timing' && <TimePreferencesEditor value={value.timePreferences} onChange={(v) => set('timePreferences', v)} />}

      {section === 'scoring' && (
        <div className="grid grid-2">
          <Card title="Scoring weights">
            <WeightsPanel weights={value.scoringWeights} onChange={(w) => set('scoringWeights', w)} />
          </Card>
          <Card title="Soft preference parameters">
            <ScoringParamsEditor value={value.scoringParams} onChange={(v) => set('scoringParams', v)} />
          </Card>
        </div>
      )}
    </div>
  );
}
