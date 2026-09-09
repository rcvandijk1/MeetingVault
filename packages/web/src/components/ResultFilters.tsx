import type { DealLevel, ScoredJourney } from '@kfr/core';
import { DEAL_LEVELS } from '@kfr/core';
import { Card, Check, Chips, Field } from './ui';
import { EMPTY_FILTERS, distinct, type ResultFilters } from '../lib/journeys';

export function ResultFiltersPanel({ journeys, filters, onChange, airlines }: { journeys: ScoredJourney[]; filters: ResultFilters; onChange: (f: ResultFilters) => void; airlines: Record<string, string> }) {
  const origins = distinct(journeys.map((j) => j.itinerary.originAirport)).sort();
  const gateways = distinct(journeys.map((j) => j.itinerary.arrivalGateway)).sort();
  const carriers = distinct(journeys.map((j) => j.itinerary.primaryAirline)).sort();
  const cabins = distinct(journeys.map((j) => j.itinerary.cabinSummary.requestedCabin));
  const toggle = <K extends 'origins' | 'gateways' | 'airlines' | 'cabins' | 'dealLevels'>(key: K, v: ResultFilters[K][number]): void => {
    const cur = filters[key] as string[];
    onChange({ ...filters, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  const num = (v: string): number | null => (v === '' ? null : Number(v));
  return (
    <Card className="filters" title="Filters" testId="filters" actions={<button className="btn ghost sm" onClick={() => onChange({ ...EMPTY_FILTERS, collapseSimilar: filters.collapseSimilar })} data-testid="filters-reset">Reset</button>}>
      <div className="stack">
        <Check label="Only non-dominated options" checked={filters.nonDominatedOnly} onChange={(v) => onChange({ ...filters, nonDominatedOnly: v })} testId="filter-nondominated" />
        <Check label="Collapse similar dates" checked={filters.collapseSimilar} onChange={(v) => onChange({ ...filters, collapseSimilar: v })} testId="filter-collapse" />
        <Field label={`Minimum score: ${filters.minScore}`}>
          <input type="range" min={0} max={100} value={filters.minScore} data-testid="filter-min-score" onChange={(e) => onChange({ ...filters, minScore: Number(e.target.value) })} />
        </Field>
        <div className="grid grid-2">
          <Field label="Max airfare €">
            <input type="number" value={filters.maxAirfare ?? ''} data-testid="filter-max-airfare" onChange={(e) => onChange({ ...filters, maxAirfare: num(e.target.value) })} />
          </Field>
          <Field label="Max true cost €">
            <input type="number" value={filters.maxTrueCost ?? ''} data-testid="filter-max-true-cost" onChange={(e) => onChange({ ...filters, maxTrueCost: num(e.target.value) })} />
          </Field>
          <Field label="Max transfers">
            <input type="number" min={0} value={filters.maxTransfers ?? ''} data-testid="filter-max-transfers" onChange={(e) => onChange({ ...filters, maxTransfers: num(e.target.value) })} />
          </Field>
          <Field label="Max layover (min)">
            <input type="number" min={0} step={30} value={filters.maxLayoverMinutes ?? ''} onChange={(e) => onChange({ ...filters, maxLayoverMinutes: num(e.target.value) })} />
          </Field>
          <Field label="Max door→Krabi (h)">
            <input type="number" min={0} value={filters.maxDoorToDoorMinutes === null ? '' : filters.maxDoorToDoorMinutes / 60} onChange={(e) => onChange({ ...filters, maxDoorToDoorMinutes: e.target.value === '' ? null : Number(e.target.value) * 60 })} />
          </Field>
        </div>
        <div className="grid grid-2">
          <Field label="Outbound from">
            <input type="date" value={filters.outboundFrom} onChange={(e) => onChange({ ...filters, outboundFrom: e.target.value })} />
          </Field>
          <Field label="Outbound to">
            <input type="date" value={filters.outboundTo} onChange={(e) => onChange({ ...filters, outboundTo: e.target.value })} />
          </Field>
        </div>
        <Field label="Hotel">
          <select value={filters.hotel} data-testid="filter-hotel" onChange={(e) => onChange({ ...filters, hotel: e.target.value as ResultFilters['hotel'] })}>
            <option value="any">Any</option>
            <option value="no">No hotel needed</option>
            <option value="yes">Hotel needed</option>
          </select>
        </Field>
        <Field label="Self-transfer">
          <select value={filters.selfTransfer} data-testid="filter-self-transfer" onChange={(e) => onChange({ ...filters, selfTransfer: e.target.value as ResultFilters['selfTransfer'] })}>
            <option value="any">Any</option>
            <option value="no">Protected connections only</option>
            <option value="yes">Self-transfer only</option>
          </select>
        </Field>
        <Field label="Origin">
          <Chips options={origins} selected={filters.origins} onToggle={(v) => toggle('origins', v)} />
        </Field>
        <Field label="Arrival airport">
          <Chips options={gateways} selected={filters.gateways} onToggle={(v) => toggle('gateways', v)} />
        </Field>
        <Field label="Airline">
          <Chips options={carriers} selected={filters.airlines} onToggle={(v) => toggle('airlines', v)} labels={airlines} />
        </Field>
        {cabins.length > 1 && (
          <Field label="Cabin">
            <Chips options={cabins} selected={filters.cabins} onToggle={(v) => toggle('cabins', v)} />
          </Field>
        )}
        <Field label="Fare quality">
          <Chips options={DEAL_LEVELS as DealLevel[]} selected={filters.dealLevels} onToggle={(v) => toggle('dealLevels', v)} />
        </Field>
      </div>
    </Card>
  );
}
