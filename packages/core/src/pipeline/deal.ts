import type { DealAssessment, DealLevel, DealThresholds, FareObservation, NormalizedItinerary } from '../types.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function dealLevelFor(percentBelow: number | null, t: DealThresholds): DealLevel {
  if (percentBelow === null) return 'NORMAL';
  if (percentBelow >= t.insane) return 'INSANE';
  if (percentBelow >= t.exceptional) return 'EXCEPTIONAL';
  if (percentBelow >= t.excellent) return 'EXCELLENT';
  if (percentBelow >= t.good) return 'GOOD';
  return 'NORMAL';
}

export const MIN_HISTORY_OBSERVATIONS = 5;

/**
 * Deal intelligence. Reference "normal" fare comes, in order of preference,
 * from the application's own observation history for the same cabin (same
 * origin+gateway first, then any origin), and otherwise from the fare
 * distribution of the current search. Marketing "was/now" prices are never used.
 */
export function assessDeal(it: NormalizedItinerary, set: NormalizedItinerary[], history: FareObservation[], thresholds: DealThresholds): DealAssessment {
  const cabin = it.cabinSummary.requestedCabin;
  const sameCabin = history.filter((h) => h.cabin === cabin);
  const sameRoute = sameCabin.filter((h) => h.originAirport === it.originAirport && h.arrivalGateway === it.arrivalGateway);
  let sample: number[] = [];
  let source: DealAssessment['source'] = 'NONE';
  if (sameRoute.length >= MIN_HISTORY_OBSERVATIONS) {
    sample = sameRoute.map((h) => h.fareEur);
    source = 'HISTORY';
  } else if (sameCabin.length >= MIN_HISTORY_OBSERVATIONS) {
    sample = sameCabin.map((h) => h.fareEur);
    source = 'HISTORY';
  } else {
    // Same cabin, and comparable route: same origin + gateway first (a deal is
    // abnormal *for its route*), then same gateway, then everything.
    const sameCabinSet = set.filter((x) => x.cabinSummary.requestedCabin === it.cabinSummary.requestedCabin);
    const tiers = [
      sameCabinSet.filter((x) => x.originAirport === it.originAirport && x.arrivalGateway === it.arrivalGateway),
      sameCabinSet.filter((x) => x.arrivalGateway === it.arrivalGateway),
      sameCabinSet,
    ];
    const tier = tiers.find((t) => t.length >= 3);
    if (tier) {
      sample = tier.map((x) => x.fareEur);
      source = 'SEARCH_DISTRIBUTION';
    }
  }
  if (sample.length === 0) {
    return { level: 'NORMAL', referenceFare: null, referenceLow: null, referenceHigh: null, percentBelowReference: null, source: 'NONE', comparableObservations: 0, lowestObservedComparable: null };
  }
  const sorted = [...sample].sort((a, b) => a - b);
  const reference = percentile(sorted, 0.5);
  const low = percentile(sorted, 0.25);
  const high = percentile(sorted, 0.75);
  const percentBelow = reference > 0 ? Math.round(((reference - it.fareEur) / reference) * 1000) / 10 : null;
  return {
    level: dealLevelFor(percentBelow, thresholds),
    referenceFare: Math.round(reference),
    referenceLow: Math.round(low),
    referenceHigh: Math.round(high),
    percentBelowReference: percentBelow,
    source,
    comparableObservations: sample.length,
    lowestObservedComparable: Math.round(sorted[0]!),
  };
}
