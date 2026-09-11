import { formatDuration, formatEur, DEAL_LEVEL_LABELS, type ScoredJourney, type ItineraryLeg, type DealLevel, type ResultLabel, type Cabin, type FareConfidence, type CabinQualityLabel, type FareOpportunityType, type OpportunitySeverity } from '@kfr/core';

export { formatDuration, formatEur };

export const fmtTime = (localIso: string | null | undefined): string => (localIso ? localIso.slice(11, 16) : '—');
export const fmtDate = (localIso: string | null | undefined): string => (localIso ? localIso.slice(0, 10) : '—');
export const fmtDateTime = (localIso: string | null | undefined): string => (localIso ? `${localIso.slice(0, 10)} ${localIso.slice(11, 16)}` : '—');
export const fmtDateShort = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
export const fmtInstant = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtPct = (n: number | null | undefined, digits = 0): string => (n === null || n === undefined ? '—' : `${n.toFixed(digits)}%`);
export const fmtScore = (n: number): string => (Math.round(n * 10) / 10).toFixed(n >= 99.95 ? 0 : 1);

export const cabinLabel = (c: Cabin): string => ({ ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium economy', BUSINESS: 'Business', FIRST: 'First' })[c];

export function routeOf(leg: ItineraryLeg): string {
  return [leg.segments[0]!.origin, ...leg.segments.map((s) => s.destination)].join(' → ');
}

export function outboundRoute(j: ScoredJourney): string {
  return routeOf(j.itinerary.outbound);
}

/** Key used to collapse near-identical results (same physical route/airline/cabin on other dates). */
export function routeKey(j: ScoredJourney): string {
  const it = j.itinerary;
  return [it.originAirport, ...it.outbound.connections.map((c) => c.airport), it.arrivalGateway, it.primaryAirline, it.cabinSummary.requestedCabin, it.ticketGroups.length].join('|');
}

export const DEAL_COLORS: Record<DealLevel, string> = {
  EXCEPTIONAL: 'var(--c-exceptional)',
  EXCELLENT: 'var(--c-excellent)',
  GOOD: 'var(--c-good)',
  NORMAL: 'var(--c-text-dim)',
  EXPENSIVE: 'var(--c-warn)',
  VERY_EXPENSIVE: 'var(--c-danger)',
  UNKNOWN: 'var(--c-muted)',
};
export const dealLabel = (l: DealLevel): string => DEAL_LEVEL_LABELS[l];

export const CONFIDENCE_COLORS: Record<FareConfidence, string> = { HIGH: 'var(--c-good)', MEDIUM: 'var(--c-warn)', LOW: 'var(--c-muted)', NONE: 'var(--c-muted)' };
export const CABIN_QUALITY_TEXT: Record<CabinQualityLabel, string> = { FULL: 'Full', MOSTLY: 'Mostly', MIXED: 'Mixed' };
export const OPPORTUNITY_TEXT: Record<FareOpportunityType, string> = {
  NEW_LOW: 'New low',
  SIGNIFICANT_DROP: 'Price drop',
  HISTORICAL_OUTLIER: 'Historical outlier',
  ALTERNATIVE_AIRPORT_OPPORTUNITY: 'Alternative airport',
  PREMIUM_CABIN_ANOMALY: 'Premium cabin anomaly',
  ROUTING_OPPORTUNITY: 'Routing opportunity',
};
export const SEVERITY_CLASS: Record<OpportunitySeverity, string> = { STRONG: 'accent', NOTABLE: 'good', INFO: '' };
export const fmtSignedPct = (n: number | null | undefined, digits = 0): string => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`);

export const LABEL_TEXT: Record<ResultLabel, string> = {
  CHEAPEST: 'Cheapest',
  FASTEST: 'Fastest',
  BEST_OVERALL: 'Best overall',
  BEST_TIMING: 'Best timing',
  BEST_BASELINE_ORIGIN: 'Best AMS',
  BEST_ALTERNATIVE_ORIGIN: 'Best alternative origin',
  DOMINANT: 'Dominant',
};

export function labelText(l: ResultLabel, baselineOrigin?: string): string {
  if (l === 'BEST_BASELINE_ORIGIN' && baselineOrigin) return `Best ${baselineOrigin}`;
  return LABEL_TEXT[l];
}

export function scoreColor(score: number): string {
  if (score >= 85) return 'var(--c-exceptional)';
  if (score >= 75) return 'var(--c-excellent)';
  if (score >= 65) return 'var(--c-good)';
  if (score >= 50) return 'var(--c-text)';
  return 'var(--c-muted)';
}

export function hoursMinutes(minutes: number | null | undefined, sign = false): string {
  if (minutes === null || minutes === undefined) return '—';
  const s = sign && minutes > 0 ? '+' : '';
  return `${s}${formatDuration(minutes)}`;
}
