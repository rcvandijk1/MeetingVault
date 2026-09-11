import type { Airport, Cabin, CabinQualityLabel, CohortLevel, CohortSummary, FareIntelligenceConfig, FareObservation, TravelObjective } from '../types.js';
import { daysBetween } from '../time.js';
import { advancePurchaseBand, daysToDeparture, originRegionFor, routeFamilyFor, seasonOf, tripDaysBand } from './objective.js';
import { median, percentile } from './stats.js';

/** The itinerary a cohort is built for. */
export interface CohortTarget {
  originAirport: string;
  arrivalGateway: string;
  cabin: Cabin;
  cabinQuality: CabinQualityLabel;
  outboundDate: string;
  inboundDate: string;
  /** Days between "now" and the outbound date. */
  daysToDeparture: number;
}

export interface CohortSelection {
  summary: CohortSummary;
  /** Observations after data-quality filtering and outlier removal. */
  observations: FareObservation[];
  /** Same-season observations of the level-2 route cohort (any window), for the seasonal median. */
  seasonal: FareObservation[];
}

export interface CohortEnvironment {
  now: string;
  airports: Record<string, Airport>;
  objective: TravelObjective;
  config: FareIntelligenceConfig;
}

/** Observation with the derived dimensions the cohort filters need. */
interface PreparedObservation {
  obs: FareObservation;
  tripDays: number;
  daysToDeparture: number;
  season: string;
  band: string;
  region: string;
  ageDays: number;
}

const isValidFare = (o: FareObservation): boolean => Number.isFinite(o.fareEur) && o.fareEur > 0;

/**
 * Data-quality gate: valid fare, same requested cabin, same cabin-quality tier
 * (a mixed-cabin fare is never compared with full business fares), route family
 * of the objective. Observations without a cabin-quality label cannot be placed
 * in a tier and are excluded.
 */
export function prepareObservations(history: FareObservation[], target: CohortTarget, env: CohortEnvironment): { prepared: PreparedObservation[]; excludedInvalid: number } {
  const prepared: PreparedObservation[] = [];
  let excludedInvalid = 0;
  const nowDay = env.now.slice(0, 10);
  for (const o of history) {
    if (!isValidFare(o) || o.cabin !== target.cabin) {
      excludedInvalid++;
      continue;
    }
    if (!o.cabinQuality || o.cabinQuality !== target.cabinQuality) {
      excludedInvalid++;
      continue;
    }
    if (routeFamilyFor(o.arrivalGateway, env.objective) === null) {
      excludedInvalid++;
      continue;
    }
    const tripDays = o.tripDays ?? daysBetween(o.outboundDate, o.inboundDate);
    const dtd = o.daysToDeparture ?? daysToDeparture(o.observedAt, o.outboundDate);
    prepared.push({
      obs: o,
      tripDays,
      daysToDeparture: dtd,
      season: seasonOf(o.outboundDate),
      band: advancePurchaseBand(dtd, env.config.advancePurchaseBandEdges),
      region: originRegionFor(o.originAirport, env.airports, env.objective),
      ageDays: daysBetween(o.observedAt.slice(0, 10), nowDay),
    });
  }
  return { prepared, excludedInvalid };
}

interface LevelDefinition {
  level: CohortLevel;
  description: (t: CohortTarget) => string;
  relaxations: string[];
  matches: (p: PreparedObservation, t: CohortTarget, targetRegion: string, targetSeason: string, targetBand: string, tripTol: number, seasonality: boolean) => boolean;
}

const LEVELS: LevelDefinition[] = [
  {
    level: 1,
    description: (t) => `${t.originAirport} → ${t.arrivalGateway}, same trip length, season and booking horizon`,
    relaxations: [],
    matches: (p, t, _r, season, band, tol, seasonality) =>
      p.obs.originAirport === t.originAirport && p.obs.arrivalGateway === t.arrivalGateway && Math.abs(p.tripDays - daysBetween(t.outboundDate, t.inboundDate)) <= tol && (!seasonality || p.season === season) && p.band === band,
  },
  {
    level: 2,
    description: (t) => `${t.originAirport} → ${t.arrivalGateway}, any trip length, season and booking horizon`,
    relaxations: ['trip length', 'season', 'booking horizon'],
    matches: (p, t) => p.obs.originAirport === t.originAirport && p.obs.arrivalGateway === t.arrivalGateway,
  },
  {
    level: 3,
    description: (t) => `any origin in the same region as ${t.originAirport} → ${t.arrivalGateway}`,
    relaxations: ['trip length', 'season', 'booking horizon', 'origin airport (same region)'],
    matches: (p, t, region) => p.region === region && p.obs.arrivalGateway === t.arrivalGateway,
  },
  {
    level: 4,
    description: () => 'any origin → any gateway of the Krabi region',
    relaxations: ['trip length', 'season', 'booking horizon', 'origin airport', 'gateway'],
    matches: () => true,
  },
];

/**
 * Selects the most specific cohort with enough samples, trying the preferred
 * observation window first and widening it before dropping to a less specific
 * level. Returns null when no level/window combination has enough observations.
 */
export function selectCohort(history: FareObservation[], target: CohortTarget, env: CohortEnvironment): CohortSelection | null {
  const cfg = env.config;
  const { prepared, excludedInvalid } = prepareObservations(history, target, env);
  if (prepared.length === 0) return null;

  const targetRegion = originRegionFor(target.originAirport, env.airports, env.objective);
  const targetSeason = seasonOf(target.outboundDate);
  const targetBand = advancePurchaseBand(target.daysToDeparture, cfg.advancePurchaseBandEdges);
  const targetTripDays = daysBetween(target.outboundDate, target.inboundDate);

  const windows = [...cfg.windowsDays].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  const startIdx = Math.max(0, windows.indexOf(cfg.preferredWindowDays));
  const candidateWindows = windows.slice(startIdx);
  if (candidateWindows.length === 0) candidateWindows.push(0);

  for (const def of LEVELS) {
    const inLevel = prepared.filter((p) => def.matches(p, target, targetRegion, targetSeason, targetBand, cfg.tripDurationToleranceDays, cfg.seasonalityEnabled));
    if (inLevel.length < cfg.minCohortSamples) continue;
    for (const window of candidateWindows) {
      const inWindow = window === 0 ? inLevel : inLevel.filter((p) => p.ageDays <= window);
      if (inWindow.length < cfg.minCohortSamples) continue;
      const { kept, excludedOutliers } = removeOutliers(inWindow, cfg);
      if (kept.length < cfg.minCohortSamples) continue;
      const days = new Set(kept.map((p) => p.obs.observedAt.slice(0, 10)));
      const times = kept.map((p) => p.obs.observedAt).sort();
      const routeLevel = prepared.filter((p) => LEVELS[1]!.matches(p, target, targetRegion, targetSeason, targetBand, cfg.tripDurationToleranceDays, cfg.seasonalityEnabled));
      const seasonal = routeLevel.filter((p) => p.season === targetSeason).map((p) => p.obs);
      return {
        summary: {
          level: def.level,
          description: def.description(target),
          windowDays: window,
          sampleCount: kept.length,
          distinctDays: days.size,
          from: times[0] ?? null,
          to: times[times.length - 1] ?? null,
          season: def.level === 1 && cfg.seasonalityEnabled ? targetSeason : null,
          advancePurchaseBand: def.level === 1 ? targetBand : null,
          tripDaysBand: def.level === 1 ? tripDaysBand(targetTripDays, cfg.tripDurationToleranceDays) : null,
          relaxations: def.relaxations,
          excludedInvalid,
          excludedOutliers,
        },
        observations: kept.map((p) => p.obs),
        seasonal,
      };
    }
  }
  return null;
}

/**
 * Removes data-quality outliers relative to the sample median and the
 * inter-quartile range (never relative to the maximum). A single €11,800 fare
 * among €3,000 fares is dropped; a tight distribution is never over-trimmed
 * because the fence is at least 15% of the median wide.
 */
export function outlierBounds(fares: number[], cfg: Pick<FareIntelligenceConfig, 'outlier'>): { lo: number; hi: number } | null {
  const sorted = [...fares].sort((a, b) => a - b);
  const med = median(sorted);
  if (med === null || med <= 0) return null;
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  const fence = Math.max(cfg.outlier.iqrMultiplier * (p75 - p25), med * 0.15);
  return { lo: Math.max(med * cfg.outlier.lowFactor, p25 - fence), hi: Math.min(med * cfg.outlier.highFactor, p75 + fence) };
}

/** Iterates (max 3 passes) so that several outliers cannot inflate the IQR enough to shelter each other. */
function removeOutliers(items: PreparedObservation[], cfg: FareIntelligenceConfig): { kept: PreparedObservation[]; excludedOutliers: number } {
  let kept = items;
  for (let pass = 0; pass < 3; pass++) {
    const bounds = outlierBounds(kept.map((p) => p.obs.fareEur), cfg);
    if (!bounds) break;
    const next = kept.filter((p) => p.obs.fareEur >= bounds.lo && p.obs.fareEur <= bounds.hi);
    if (next.length === kept.length || next.length < cfg.minCohortSamples) break;
    kept = next;
  }
  return { kept, excludedOutliers: items.length - kept.length };
}
