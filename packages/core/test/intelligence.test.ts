import { describe, expect, it } from 'vitest';
import type { Cabin, CabinQualityLabel, FareObservation, NormalizedItinerary, OriginAccessProfile, PipelineContext, ScoredJourney } from '../src/types.js';
import { median, percentile, percentileRank, robustStats } from '../src/intelligence/stats.js';
import { advancePurchaseBand, cabinQualityLabel, originRegionFor, routeFamilyFor, seasonOf } from '../src/intelligence/objective.js';
import { outlierBounds, selectCohort } from '../src/intelligence/cohort.js';
import { assessFare, classifyFare, classifyPercentOfMedian, confidenceFor, dealScoreFor, marketPosition, tripCostView } from '../src/intelligence/assess.js';
import { fareTrend } from '../src/intelligence/trend.js';
import { DEFAULT_FARE_INTELLIGENCE, DEFAULT_ORIGIN_PROFILES, DEFAULT_GROUND_TRANSFERS, KRABI_REGION_OBJECTIVE } from '../src/defaults.js';
import { runPipeline } from '../src/pipeline/index.js';
import { AIRPORT_INDEX } from '../src/data/airports.js';
import { amsDohKbv, itinerary, NOW, testContext, testProfile } from './helpers.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const CFG = DEFAULT_FARE_INTELLIGENCE;
const T = CFG.thresholds;

interface ObsSpec {
  fare: number;
  origin?: string;
  gateway?: string;
  cabin?: Cabin;
  quality?: CabinQualityLabel | null;
  daysAgo?: number;
  outboundDate?: string;
  inboundDate?: string;
  fingerprint?: string;
  provider?: string;
}

/** Observation `daysAgo` days before NOW (spread over distinct days by default). */
function obs(spec: ObsSpec): FareObservation {
  const daysAgo = spec.daysAgo ?? 0;
  const observedAt = new Date(new Date(NOW).getTime() - daysAgo * 86400000).toISOString();
  return {
    observedAt,
    originAirport: spec.origin ?? 'AMS',
    arrivalGateway: spec.gateway ?? 'KBV',
    outboundDate: spec.outboundDate ?? '2027-01-20',
    inboundDate: spec.inboundDate ?? '2027-02-08',
    airline: 'QR',
    cabin: spec.cabin ?? 'BUSINESS',
    fare: spec.fare,
    currency: 'EUR',
    fareEur: spec.fare,
    provider: spec.provider ?? 'mock',
    itineraryFingerprint: spec.fingerprint ?? `fp-${spec.fare}`,
    cabinQuality: spec.quality === undefined ? 'FULL' : spec.quality,
  };
}

const history = (fares: number[], extra: Partial<ObsSpec> = {}): FareObservation[] => fares.map((fare, i) => obs({ fare, daysAgo: i % 10, ...extra }));

function assess(it: NormalizedItinerary, hist: FareObservation[], set: NormalizedItinerary[] = [it], overrides: Partial<PipelineContext> = {}) {
  const ctx = testContext({ history: hist, ...overrides });
  return assessFare(it, { set, history: ctx.history, config: ctx.fareIntelligence, airports: ctx.airports, objective: ctx.objective, now: NOW });
}

const env = (overrides: Partial<PipelineContext> = {}) => {
  const ctx = testContext(overrides);
  return { now: NOW, airports: ctx.airports, objective: ctx.objective, config: ctx.fareIntelligence };
};
const target = (over: Partial<Parameters<typeof selectCohort>[1]> = {}) => ({ originAirport: 'AMS', arrivalGateway: 'KBV', cabin: 'BUSINESS' as Cabin, cabinQuality: 'FULL' as CabinQualityLabel, outboundDate: '2027-01-20', inboundDate: '2027-02-08', daysToDeparture: 133, ...over });

// ---------------------------------------------------------------------------
// 1. statistics
// ---------------------------------------------------------------------------

describe('robust statistics', () => {
  it('computes interpolated percentiles, median, mean, stdev', () => {
    const s = robustStats([2900, 3000, 3050, 3100, 3200])!;
    expect(s.median).toBe(3050);
    expect(s.p25).toBe(3000);
    expect(s.p75).toBe(3100);
    expect(s.min).toBe(2900);
    expect(s.max).toBe(3200);
    expect(s.mean).toBe(3050);
    expect(s.stdev).toBe(100);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(median([])).toBeNull();
    expect(robustStats([])).toBeNull();
  });

  it('percentile rank is the fraction strictly below the value', () => {
    expect(percentileRank([1, 2, 3, 4], 1)).toBe(0);
    expect(percentileRank([1, 2, 3, 4], 2.5)).toBe(0.5);
    expect(percentileRank([1, 2, 3, 4], 10)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. objective, seasons, bands, cabin quality
// ---------------------------------------------------------------------------

describe('travel objective and dimensions', () => {
  it('maps gateways to the KRABI_REGION route family and origins to regions', () => {
    expect(routeFamilyFor('KBV', KRABI_REGION_OBJECTIVE)).toBe('KRABI_REGION');
    expect(routeFamilyFor('HKT', KRABI_REGION_OBJECTIVE)).toBe('KRABI_REGION');
    expect(routeFamilyFor('BKK', KRABI_REGION_OBJECTIVE)).toBe('KRABI_REGION');
    expect(routeFamilyFor('SIN', KRABI_REGION_OBJECTIVE)).toBeNull();
    expect(originRegionFor('AMS', AIRPORT_INDEX, KRABI_REGION_OBJECTIVE)).toBe('BENELUX_DE');
    expect(originRegionFor('DUS', AIRPORT_INDEX, KRABI_REGION_OBJECTIVE)).toBe('BENELUX_DE');
    expect(originRegionFor('BRU', AIRPORT_INDEX, KRABI_REGION_OBJECTIVE)).toBe('BENELUX_DE');
    expect(originRegionFor('CPH', AIRPORT_INDEX, KRABI_REGION_OBJECTIVE)).toBe('NORDICS');
    expect(originRegionFor('XXX', AIRPORT_INDEX, KRABI_REGION_OBJECTIVE)).toBe('AIRPORT:XXX');
  });

  it('derives seasons and advance-purchase bands', () => {
    expect(seasonOf('2027-01-20')).toBe('WINTER');
    expect(seasonOf('2026-12-24')).toBe('WINTER');
    expect(seasonOf('2027-04-01')).toBe('SPRING');
    expect(seasonOf('2027-07-15')).toBe('SUMMER');
    expect(seasonOf('2027-10-01')).toBe('AUTUMN');
    const edges = CFG.advancePurchaseBandEdges;
    expect(advancePurchaseBand(0, edges)).toBe('0-14');
    expect(advancePurchaseBand(14, edges)).toBe('0-14');
    expect(advancePurchaseBand(15, edges)).toBe('15-30');
    expect(advancePurchaseBand(45, edges)).toBe('31-60');
    expect(advancePurchaseBand(133, edges)).toBe('91-180');
    expect(advancePurchaseBand(400, edges)).toBe('365+');
    expect(advancePurchaseBand(20, [7, 60])).toBe('8-60');
  });

  it('weights cabin quality by segment duration (self-audit 8)', () => {
    // Option A: long-haul economy first, business second. Option B: the reverse. Neither is full business.
    const a = itinerary({ id: 'A', fare: 2000, out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T15:00', minutes: 390, cabin: 'ECONOMY' }, { from: 'DOH', to: 'HKT', dep: '2027-01-21T02:00', minutes: 405, cabin: 'BUSINESS' }], ret: [{ from: 'HKT', to: 'DOH', dep: '2027-02-08T20:00', minutes: 425, cabin: 'ECONOMY' }, { from: 'DOH', to: 'AMS', dep: '2027-02-09T02:00', minutes: 405, cabin: 'BUSINESS' }] });
    const b = itinerary({ id: 'B', fare: 2000, out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T15:00', minutes: 390, cabin: 'BUSINESS' }, { from: 'DOH', to: 'HKT', dep: '2027-01-21T02:00', minutes: 405, cabin: 'ECONOMY' }], ret: [{ from: 'HKT', to: 'DOH', dep: '2027-02-08T20:00', minutes: 425, cabin: 'BUSINESS' }, { from: 'DOH', to: 'AMS', dep: '2027-02-09T02:00', minutes: 405, cabin: 'ECONOMY' }] });
    expect(cabinQualityLabel(a.cabinSummary)).toBe('MIXED');
    expect(cabinQualityLabel(b.cabinSummary)).toBe('MIXED');
    expect(a.cabinSummary.premiumCabinPercent).not.toBe(b.cabinSummary.premiumCabinPercent);
    // Short economy feeder with all long-haul in business = MOSTLY; everything business = FULL.
    const mostly = itinerary({ id: 'M', fare: 2000, out: [{ from: 'AMS', to: 'FRA', dep: '2027-01-20T10:00', minutes: 70, cabin: 'ECONOMY' }, { from: 'FRA', to: 'BKK', dep: '2027-01-20T14:00', minutes: 660 }, { from: 'BKK', to: 'KBV', dep: '2027-01-21T08:30', minutes: 80, cabin: 'ECONOMY' }], ret: [{ from: 'KBV', to: 'BKK', dep: '2027-02-08T12:00', minutes: 80, cabin: 'ECONOMY' }, { from: 'BKK', to: 'FRA', dep: '2027-02-08T23:00', minutes: 720 }, { from: 'FRA', to: 'AMS', dep: '2027-02-09T08:00', minutes: 70, cabin: 'ECONOMY' }] });
    expect(cabinQualityLabel(mostly.cabinSummary)).toBe('MOSTLY');
    expect(cabinQualityLabel(amsDohKbv().cabinSummary)).toBe('FULL');
  });
});

// ---------------------------------------------------------------------------
// 3. cohorts
// ---------------------------------------------------------------------------

describe('cohort selection', () => {
  it('level 1: same route, trip length, season and booking horizon', () => {
    const c = selectCohort(history([3000, 3100, 3050, 2950, 3200]), target(), env())!;
    expect(c.summary.level).toBe(1);
    expect(c.summary.sampleCount).toBe(5);
    expect(c.summary.season).toBe('WINTER');
    expect(c.summary.advancePurchaseBand).toBe('91-180');
    expect(c.summary.windowDays).toBe(90);
    expect(c.summary.relaxations).toEqual([]);
  });

  it('level 2 when the trip length or season differs; the relaxation is recorded, never silent', () => {
    const c = selectCohort(history([3000, 3100, 3050, 2950, 3200], { outboundDate: '2027-07-01', inboundDate: '2027-07-10' }), target(), env())!;
    expect(c.summary.level).toBe(2);
    expect(c.summary.relaxations).toContain('season');
    expect(c.summary.description).toContain('AMS → KBV');
  });

  it('level 3 uses origins of the same region; level 4 any origin and any Krabi-region gateway', () => {
    const dus = selectCohort(history([3000, 3100, 3050, 2950, 3200], { origin: 'DUS' }), target(), env())!;
    expect(dus.summary.level).toBe(3);
    expect(dus.summary.relaxations).toContain('origin airport (same region)');
    const cph = selectCohort(history([3000, 3100, 3050, 2950, 3200], { origin: 'CPH', gateway: 'HKT' }), target(), env())!;
    expect(cph.summary.level).toBe(4);
    expect(selectCohort(history([3000, 3100, 3050, 2950, 3200], { gateway: 'SIN' }), target(), env())).toBeNull();
  });

  it('prefers the most specific level even when a wider level has more samples', () => {
    const hist = [...history([3000, 3100, 3050, 2950, 3200]), ...history(Array.from({ length: 40 }, (_, i) => 2000 + i * 10), { origin: 'DUS' })];
    const c = selectCohort(hist, target(), env())!;
    expect(c.summary.level).toBe(1);
    expect(c.summary.sampleCount).toBe(5);
  });

  it('widens the observation window before dropping a level', () => {
    // Far-out departure so that 100-day-old observations still fall in the same advance-purchase band (365+).
    const old = history([3000, 3100, 3050, 2950, 3200], { outboundDate: '2028-01-20', inboundDate: '2028-02-08' }).map((o, i) => ({ ...o, observedAt: new Date(new Date(NOW).getTime() - (100 + i) * 86400000).toISOString() }));
    const c = selectCohort(old, target({ outboundDate: '2028-01-20', inboundDate: '2028-02-08', daysToDeparture: 498 }), env())!;
    expect(c.summary.level).toBe(1);
    expect(c.summary.windowDays).toBe(180);
  });

  it('never compares a mixed-cabin fare with full business fares (or the reverse)', () => {
    const full = history([3000, 3100, 3050, 2950, 3200]);
    expect(selectCohort(full, target({ cabinQuality: 'MIXED' }), env())).toBeNull();
    const mixed = history([1800, 1900, 1850, 1750, 2000], { quality: 'MIXED' });
    expect(selectCohort([...full, ...mixed], target({ cabinQuality: 'FULL' }), env())!.summary.sampleCount).toBe(5);
    expect(selectCohort([...full, ...mixed], target({ cabinQuality: 'MIXED' }), env())!.observations.every((o) => o.cabinQuality === 'MIXED')).toBe(true);
  });

  it('excludes invalid observations (zero fare, other cabin, unknown quality) and reports the count', () => {
    const hist = [...history([3000, 3100, 3050, 2950, 3200]), obs({ fare: 0 }), obs({ fare: 1500, cabin: 'ECONOMY' }), obs({ fare: 3000, quality: null })];
    const c = selectCohort(hist, target(), env())!;
    expect(c.summary.sampleCount).toBe(5);
    expect(c.summary.excludedInvalid).toBe(3);
  });

  it('outlier fence: an €11,800 fare among €3,000 fares is excluded, a tight distribution is not over-trimmed', () => {
    const b = outlierBounds([2900, 3000, 3050, 3100, 3200, 11800], CFG)!;
    expect(b.hi).toBeLessThan(11800);
    expect(b.hi).toBeGreaterThan(3200);
    const tight = outlierBounds([3000, 3000, 3000, 3000, 3200], CFG)!;
    expect(tight.hi).toBeGreaterThanOrEqual(3200);
    const c = selectCohort(history([2900, 3000, 3050, 3100, 3200, 11800]), target(), env())!;
    expect(c.summary.sampleCount).toBe(5);
    expect(c.summary.excludedOutliers).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. classification, confidence, deal score
// ---------------------------------------------------------------------------

describe('classification', () => {
  it('uses the configurable bands with inclusive upper bounds', () => {
    expect(classifyPercentOfMedian(60, T)).toBe('EXCEPTIONAL');
    expect(classifyPercentOfMedian(60.1, T)).toBe('EXCELLENT');
    expect(classifyPercentOfMedian(72, T)).toBe('EXCELLENT');
    expect(classifyPercentOfMedian(85, T)).toBe('GOOD');
    expect(classifyPercentOfMedian(115, T)).toBe('NORMAL');
    expect(classifyPercentOfMedian(135, T)).toBe('EXPENSIVE');
    expect(classifyPercentOfMedian(135.1, T)).toBe('VERY_EXPENSIVE');
    const custom = { ...T, exceptional: 50, excellent: 65 };
    expect(classifyPercentOfMedian(60, custom)).toBe('EXCELLENT');
  });

  it('below-the-floor rule: far below the lowest comparable fare is exceptional; slightly below is not', () => {
    expect(classifyFare(2120, { median: 3075, min: 2900 }, T)).toEqual({ level: 'EXCEPTIONAL', belowFloor: true });
    expect(classifyFare(2600, { median: 3050, min: 2900 }, T)).toEqual({ level: 'NORMAL', belowFloor: false });
    expect(classifyFare(2000, { median: 0, min: 0 }, T).level).toBe('UNKNOWN');
  });
});

describe('confidence', () => {
  const cohort = (sampleCount: number, distinctDays: number, level: 1 | 2 | 3 | 4 = 1) => ({ level, description: '', windowDays: 90, sampleCount, distinctDays, from: null, to: null, season: null, advancePurchaseBand: null, tripDaysBand: null, relaxations: [], excludedInvalid: 0, excludedOutliers: 0 });

  it('responds to sample count AND time coverage (self-audit 11)', () => {
    expect(confidenceFor(cohort(3, 3), 'HISTORY', CFG).confidence).toBe('LOW');
    expect(confidenceFor(cohort(7, 7), 'HISTORY', CFG).confidence).toBe('LOW');
    expect(confidenceFor(cohort(15, 10), 'HISTORY', CFG).confidence).toBe('MEDIUM');
    expect(confidenceFor(cohort(50, 20), 'HISTORY', CFG).confidence).toBe('HIGH');
    expect(confidenceFor(cohort(200, 60), 'HISTORY', CFG).confidence).toBe('HIGH');
    // 50 fares all observed on one day is not high confidence.
    expect(confidenceFor(cohort(50, 1), 'HISTORY', CFG).confidence).toBe('LOW');
    expect(confidenceFor(cohort(50, 1), 'HISTORY', CFG).reasons.join(' ')).toMatch(/distinct day/);
  });

  it('cohort quality matters, not sample size alone: 100 broad observations rank below 35 exact ones', () => {
    expect(confidenceFor(cohort(35, 12, 1), 'HISTORY', CFG).confidence).toBe('HIGH');
    expect(confidenceFor(cohort(100, 30, 3), 'HISTORY', CFG).confidence).toBe('MEDIUM');
    expect(confidenceFor(cohort(100, 30, 4), 'HISTORY', CFG).confidence).toBe('LOW');
    expect(confidenceFor(cohort(100, 30, 4), 'HISTORY', CFG).reasons.join(' ')).toMatch(/any origin/);
  });

  it('search-distribution references are never more than LOW; no reference is NONE', () => {
    expect(confidenceFor(cohort(200, 1, 1), 'SEARCH_DISTRIBUTION', CFG).confidence).toBe('LOW');
    expect(confidenceFor(null, 'NONE', CFG).confidence).toBe('NONE');
  });
});

describe('deal score', () => {
  const base = { median: 3000, lowest: 2800, percentileRank: 0, cabinPenalty: 0 };

  it('is monotone in the fare for the same cohort (self-audit 4)', () => {
    const s = (fare: number) => dealScoreFor({ ...base, fareEur: fare, confidence: 'HIGH' })!;
    expect(s(2500)).toBeGreaterThan(s(3000));
    expect(s(2000)).toBeGreaterThan(s(2500));
    expect(s(3000)).toBeGreaterThan(s(3500));
    let prev = Infinity;
    for (let fare = 1500; fare <= 4500; fare += 100) {
      const v = dealScoreFor({ ...base, fareEur: fare, confidence: 'HIGH', percentileRank: Math.min(1, Math.max(0, (fare - 2800) / 800)) })!;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('is not a percentage discount and is pulled towards neutral by low confidence', () => {
    const high = dealScoreFor({ ...base, fareEur: 1800, confidence: 'HIGH' })!; // 40% below median
    const low = dealScoreFor({ ...base, fareEur: 1800, confidence: 'LOW' })!;
    expect(high).not.toBe(40);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(50);
    const atMedian = dealScoreFor({ ...base, fareEur: 3000, percentileRank: 0.5, confidence: 'HIGH' })!;
    expect(atMedian).toBeGreaterThanOrEqual(45);
    expect(atMedian).toBeLessThanOrEqual(60);
    expect(dealScoreFor({ ...base, fareEur: 1800, confidence: 'NONE' })).toBe(50);
  });

  it('removes points for non-full cabin quality and clamps to 0..100', () => {
    expect(dealScoreFor({ ...base, fareEur: 1800, confidence: 'HIGH', cabinPenalty: 15 })).toBe(dealScoreFor({ ...base, fareEur: 1800, confidence: 'HIGH' })! - 15);
    expect(dealScoreFor({ ...base, fareEur: 200, confidence: 'HIGH' })).toBe(100);
    expect(dealScoreFor({ ...base, fareEur: 9000, percentileRank: 1, confidence: 'HIGH' })).toBe(0);
    expect(dealScoreFor({ ...base, fareEur: 1800, median: 0, confidence: 'HIGH' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. assessment end to end
// ---------------------------------------------------------------------------

describe('fare assessment', () => {
  it('reports explicit-baseline savings, percentile rank and cohort details', () => {
    const it = amsDohKbv({ fare: 2500 });
    const a = assess(it, history([2900, 3000, 3050, 3100, 3200, 3300, 3400, 3150]));
    expect(a.source).toBe('HISTORY');
    expect(a.referenceFare).toBe(3125);
    expect(a.savingVsMedianEur).toBe(625);
    expect(a.savingVsP25Eur).toBeGreaterThan(0);
    expect(a.aboveLowestEur).toBe(0);
    expect(a.stats!.percentileRank).toBe(0);
    expect(a.cohort!.level).toBe(1);
    expect(a.cohort!.sampleCount).toBe(8);
    expect(a.confidence).toBe('MEDIUM');
    expect(a.stats!.recentMedian).not.toBeNull();
    expect(a.stats!.rollingMedian).not.toBeNull();
    expect(a.stats!.seasonalMedian).toBe(3125);
    expect(a.explanations.join(' ')).toMatch(/median of €3,125/);
    expect(a.explanations.join(' ')).toMatch(/Cohort level 1/);
  });

  it('explains a widened comparison instead of silently broadening (self-audit 3)', () => {
    const a = assess(amsDohKbv({ fare: 2500 }), history([2900, 3000, 3050, 3100, 3200], { origin: 'DUS' }));
    expect(a.cohort!.level).toBe(3);
    expect(a.explanations.join(' ')).toMatch(/widened to any origin in the same region/);
    expect(a.confidenceReasons.join(' ')).toMatch(/other airports in the same region|Only/);
  });

  it('cold start: no history → current search with LOW confidence; nothing comparable → UNKNOWN', () => {
    const it = amsDohKbv({ fare: 2000 });
    const alone = assess(it, []);
    expect(alone.level).toBe('UNKNOWN');
    expect(alone.confidence).toBe('NONE');
    expect(alone.dealScore).toBeNull();
    const set = [it, amsDohKbv({ id: 'b', fare: 2600, depTime: '15:55' }), amsDohKbv({ id: 'c', fare: 2700, depTime: '10:00' })];
    const withSet = assess(it, [], set);
    expect(withSet.source).toBe('SEARCH_DISTRIBUTION');
    expect(withSet.confidence).toBe('LOW');
    expect(withSet.cohort!.level).toBe(0);
    expect(withSet.explanations.join(' ')).toMatch(/current search only/);
  });

  it('current market position is independent of history (scenario F / self-audit 10)', () => {
    const it = amsDohKbv({ id: 'me', fare: 2350 });
    const set = [it, amsDohKbv({ id: 'a', fare: 2180, depTime: '15:55' }), amsDohKbv({ id: 'b', fare: 2220, depTime: '10:00' }), amsDohKbv({ id: 'c', fare: 2290, depTime: '11:00' }), amsDohKbv({ id: 'd', fare: 2420, depTime: '12:00' })];
    const a = assess(it, history([3150, 3100, 3200, 3150, 3050, 3250, 3150, 3100]), set);
    expect(a.referenceFare).toBe(3150);
    // Historically cheap (25% below a tight cluster: the below-the-floor rule makes it exceptional) …
    expect(['EXCEPTIONAL', 'EXCELLENT', 'GOOD']).toContain(a.level);
    expect(a.dealScore!).toBeGreaterThan(60);
    // … but only the 4th cheapest of five comparable options in today's search.
    expect(a.market.rank).toBe(4);
    expect(a.market.comparableCount).toBe(5);
    expect(a.market.cheapestEur).toBe(2180);
    expect(a.market.differenceToBestEur).toBe(170);
    expect(a.explanations.join(' ')).toMatch(/#4 of 5 comparable/);
    const m = marketPosition(it, set);
    expect(m.scope).toBe('ROUTE');
  });

  it('market position never mixes cabin-quality tiers', () => {
    const it = amsDohKbv({ id: 'me', fare: 2350 });
    const mixed = itinerary({ id: 'mx', fare: 1500, out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T15:00', minutes: 390, cabin: 'ECONOMY' }, { from: 'DOH', to: 'KBV', dep: '2027-01-21T02:00', minutes: 390 }], ret: [{ from: 'KBV', to: 'DOH', dep: '2027-02-08T20:00', minutes: 420 }, { from: 'DOH', to: 'AMS', dep: '2027-02-09T02:00', minutes: 405 }] });
    const m = marketPosition(it, [it, mixed, amsDohKbv({ id: 'a', fare: 2400, depTime: '15:55' }), amsDohKbv({ id: 'b', fare: 2500, depTime: '10:00' })]);
    expect(m.comparableCount).toBe(3);
    expect(m.rank).toBe(1);
  });

  it('is deterministic', () => {
    const it = amsDohKbv({ fare: 2500 });
    const h = history([2900, 3000, 3050, 3100, 3200]);
    expect(assess(it, h)).toEqual(assess(it, h));
  });

  it('wording never presents the deal score or percentile as a discount (scenario E)', () => {
    const a = assess(amsDohKbv({ fare: 2120 }), history([2950, 3100, 3050, 3250, 2900, 3180, 3020, 3110]));
    const text = a.explanations.join(' ');
    expect(text).not.toMatch(/discount|% saved|saved \d+%/i);
    expect(text).toMatch(/Deal score \d+\/100/);
    expect(text).toMatch(/percentile rank/);
  });
});

// ---------------------------------------------------------------------------
// 6. anti-manipulation and outliers
// ---------------------------------------------------------------------------

describe('reference-price integrity (self-audits 1 and 2)', () => {
  const clean = history([2900, 3000, 3050, 3100, 3200]);
  it('an €11,800 outlier cannot distort the reference, the classification, the deal score or the saving', () => {
    const it = amsDohKbv({ fare: 2600 });
    const a = assess(it, clean);
    const b = assess(it, [...clean, obs({ fare: 11800, daysAgo: 3 })]);
    expect(b.referenceFare).toBe(a.referenceFare);
    expect(b.level).toBe(a.level);
    expect(b.dealScore).toBe(a.dealScore);
    expect(b.savingVsMedianEur).toBe(a.savingVsMedianEur);
    expect(b.stats!.max).toBe(3200);
    expect(b.cohort!.excludedOutliers).toBe(1);
    expect(b.percentBelowReference).toBeLessThan(20);
    expect(b.explanations.join(' ')).not.toMatch(/78/);
    expect(b.explanations.join(' ')).toMatch(/1 implausible observation/);
  });

  it('a marketing reference price is never used: the reference is the observed median (scenario B)', () => {
    const a = assess(amsDohKbv({ fare: 2600 }), history([2900, 2950, 3000, 3050, 3100, 3150, 3200, 3100]));
    expect(a.referenceFare).toBe(3075);
    expect(a.percentBelowReference).toBeGreaterThanOrEqual(12);
    expect(a.percentBelowReference).toBeLessThanOrEqual(20);
    expect(a.savingVsMedianEur).toBe(475);
  });

  it('several abnormal fares still cannot move the median-based verdict', () => {
    const it = amsDohKbv({ fare: 2600 });
    const a = assess(it, clean);
    const b = assess(it, [...clean, obs({ fare: 9000, daysAgo: 1 }), obs({ fare: 12000, daysAgo: 2 }), obs({ fare: 400, daysAgo: 4 })]);
    expect(b.level).toBe(a.level);
    expect(Math.abs((b.referenceFare ?? 0) - (a.referenceFare ?? 0))).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// 7. trend and opportunities
// ---------------------------------------------------------------------------

describe('price-drop detection', () => {
  const fp = 'same-flights';
  const own = [obs({ fare: 3200, daysAgo: 40, fingerprint: fp }), obs({ fare: 3100, daysAgo: 20, fingerprint: fp }), obs({ fare: 3000, daysAgo: 5, fingerprint: fp }), obs({ fare: 2950, daysAgo: 1, fingerprint: fp })];

  it('tracks first/last/lowest/highest and 7/30-day medians of the same fingerprint only', () => {
    const t = fareTrend(fp, 2500, [...own, obs({ fare: 1000, daysAgo: 2, fingerprint: 'other' })], NOW, CFG)!;
    expect(t.timesSeenBefore).toBe(4);
    expect(t.firstSeenFareEur).toBe(3200);
    expect(t.previousFareEur).toBe(2950);
    expect(t.lowestSeenEur).toBe(2950);
    expect(t.highestSeenEur).toBe(3200);
    expect(t.median7dEur).toBe(2975);
    expect(t.median30dEur).toBe(3000);
    expect(t.changeVsPreviousPercent).toBe(-15.3);
    expect(t.isNewLow).toBe(true);
    expect(fareTrend('unknown', 2500, own, NOW, CFG)).toBeNull();
  });

  it('a different itinerary at a lower price is not a price drop (self-audit 9)', () => {
    const ctx = testContext({ history: own });
    const cheaper = amsDohKbv({ id: 'x', fare: 2100 });
    const r = runPipeline([cheaper], ctx);
    expect(r.journeys[0]!.deal.trend).toBeNull();
    expect(r.opportunities.some((o) => o.type === 'SIGNIFICANT_DROP' || o.type === 'NEW_LOW')).toBe(false);
  });

  it('raises NEW_LOW and SIGNIFICANT_DROP for the same fingerprint', () => {
    const it = amsDohKbv({ fare: 2500 });
    const hist = own.map((o) => ({ ...o, itineraryFingerprint: it.fingerprint }));
    const r = runPipeline([it], testContext({ history: hist }));
    const types = r.opportunities.map((o) => o.type);
    expect(types).toContain('NEW_LOW');
    expect(types).toContain('SIGNIFICANT_DROP');
    const drop = r.opportunities.find((o) => o.type === 'SIGNIFICANT_DROP')!;
    expect(drop.metrics.previousFareEur).toBe(2950);
    expect(drop.confidence).toBe('MEDIUM');
    expect(r.journeys[0]!.deal.opportunities.length).toBe(types.length);
    expect(r.journeys[0]!.reasons.some((x) => x.text.includes('Lowest price seen'))).toBe(true);
  });
});

describe('opportunity events', () => {
  it('HISTORICAL_OUTLIER and PREMIUM_CABIN_ANOMALY need usable confidence and a full premium cabin', () => {
    const it = amsDohKbv({ fare: 1800 });
    const big = Array.from({ length: 24 }, (_, i) => obs({ fare: 2900 + (i % 6) * 60, daysAgo: i % 8 }));
    const r = runPipeline([it], testContext({ history: big }));
    const types = r.opportunities.map((o) => o.type);
    expect(r.journeys[0]!.deal.confidence).toBe('HIGH');
    expect(types).toContain('HISTORICAL_OUTLIER');
    expect(types).toContain('PREMIUM_CABIN_ANOMALY');
    const few = runPipeline([it], testContext({ history: big.slice(0, 5) }));
    expect(few.journeys[0]!.deal.confidence).toBe('LOW');
    expect(few.opportunities.map((o) => o.type)).not.toContain('HISTORICAL_OUTLIER');
  });

  it('PREMIUM_CABIN_ANOMALY fires when business is priced close to the economy median of the route', () => {
    const it = amsDohKbv({ fare: 1500 });
    const econ = history([900, 950, 1000, 1050, 1100], { cabin: 'ECONOMY', quality: 'FULL' });
    const r = runPipeline([it], testContext({ history: econ }));
    const o = r.opportunities.find((x) => x.type === 'PREMIUM_CABIN_ANOMALY')!;
    expect(o).toBeDefined();
    expect(o.metrics.economyMedianEur).toBe(1000);
    expect(o.severity).toBe('NOTABLE');
  });

  it('ALTERNATIVE_AIRPORT_OPPORTUNITY and ROUTING_OPPORTUNITY come from the ranked set', () => {
    const ams = amsDohKbv({ fare: 2600 });
    const amsHkt = itinerary({ id: 'AMS-HKT', fare: 2200, out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T15:40', minutes: 370 }, { from: 'DOH', to: 'HKT', dep: '2027-01-21T01:50', minutes: 395 }], ret: [{ from: 'HKT', to: 'DOH', dep: '2027-02-08T20:05', minutes: 425 }, { from: 'DOH', to: 'AMS', dep: '2027-02-09T01:20', minutes: 395 }] });
    const dus = itinerary({ id: 'DUS', fare: 1900, out: [{ from: 'DUS', to: 'DOH', dep: '2027-01-20T15:40', minutes: 370 }, { from: 'DOH', to: 'KBV', dep: '2027-01-21T01:50', minutes: 395 }], ret: [{ from: 'KBV', to: 'DOH', dep: '2027-02-08T20:05', minutes: 425 }, { from: 'DOH', to: 'DUS', dep: '2027-02-09T01:20', minutes: 395 }] });
    // Baseline = best-ranked low-friction AMS journey (AMS→KBV at €2,600). DUS is €700 cheaper in airfare; AMS→HKT is the routing alternative to AMS→KBV.
    const r = runPipeline([ams, dus, amsHkt], testContext());
    const alt = r.opportunities.find((o) => o.type === 'ALTERNATIVE_AIRPORT_OPPORTUNITY')!;
    expect(alt.originAirport).toBe('DUS');
    // The baseline is the best-ranked low-friction AMS journey (weight dependent), so assert the shape, not a hard-coded amount.
    expect(alt.reason).toMatch(/airfare is €[\d,]+ cheaper than the best AMS option/);
    expect(alt.reason).toMatch(/cheaper after positioning, hotel and transfer costs/);
    expect(Number(alt.metrics.airfareSavingVsBaselineEur)).toBeGreaterThan(0);
    expect(alt.metrics.breakEvenFareEur).not.toBeNull();
    // A Pareto-dominated journey is never an opportunity: DUS beats AMS→HKT on cost, time and convenience here, so run the routing check without it.
    expect(r.opportunities.some((o) => o.type === 'ROUTING_OPPORTUNITY')).toBe(false);
    const r2 = runPipeline([ams, amsHkt], testContext());
    const routing = r2.opportunities.find((o) => o.type === 'ROUTING_OPPORTUNITY')!;
    expect(routing.arrivalGateway).toBe('HKT');
    expect(Number(routing.metrics.savingVsPrimaryGatewayEur)).toBeGreaterThanOrEqual(150);
  });
});

// ---------------------------------------------------------------------------
// 8. costs, value of time, break-even
// ---------------------------------------------------------------------------

describe('financial cost versus journey burden (self-audit 7)', () => {
  it('value of time is disabled by default and never merged into the true journey cost', () => {
    const r = runPipeline([amsDohKbv()], testContext());
    const j = r.journeys[0]!;
    expect(j.deal.costs!.valueOfTimeEur).toBeNull();
    expect(j.deal.costs!.trueTripCostIncludingTimeEur).toBeNull();
    expect(j.deal.costs!.financialTrueCostEur).toBe(j.cost.trueJourneyCost);
    expect(j.deal.costs!.journeyBurdenMinutes).toBe(j.totalActiveTravelBurdenMinutes);
    expect(j.baseline.breakEvenFareWithTimeEur).toBeNull();
  });

  it('when enabled it is reported as a separate figure and the financial cost is unchanged', () => {
    const ctx = testContext({ fareIntelligence: { ...CFG, timeValue: { enabled: true, eurPerActiveHour: 20, eurPerHotelNight: 0, eurPerTransfer: 0 } } });
    const r = runPipeline([amsDohKbv()], ctx);
    const j = r.journeys[0]!;
    const v = tripCostView(j, ctx.fareIntelligence);
    expect(v.valueOfTimeEur).toBeCloseTo((j.totalActiveTravelBurdenMinutes / 60) * 20, 0);
    expect(v.trueTripCostIncludingTimeEur).toBeCloseTo(j.cost.trueJourneyCost + v.valueOfTimeEur!, 0);
    expect(v.financialTrueCostEur).toBe(j.cost.trueJourneyCost);
    expect(j.cost.trueJourneyCost).toBe(runPipeline([amsDohKbv()], testContext()).journeys[0]!.cost.trueJourneyCost);
  });
});

// ---------------------------------------------------------------------------
// 9. acceptance scenarios
// ---------------------------------------------------------------------------


/** Pipeline context whose origin economics are exactly the ones of the scenario text. */
function scenarioContext(extra: Partial<PipelineContext> = {}, profileOverrides = {}): PipelineContext {
  const origins: OriginAccessProfile[] = DEFAULT_ORIGIN_PROFILES.map((p) => ({ ...p, hotelRequiredRule: 'NEVER', accessMonetaryCost: 0, trainCost: 0, fuelCost: 0, tollCost: 0, parkingCost: 0 }));
  const set = (code: string, patch: Partial<OriginAccessProfile>): void => {
    Object.assign(origins.find((o) => o.airportCode === code)!, patch);
  };
  set('AMS', { fuelCost: 12.5 });
  set('BRU', { accessMonetaryCost: 45, hotelRequiredRule: 'ALWAYS', hotelCost: 120 });
  set('FRA', { accessMonetaryCost: 80, hotelRequiredRule: 'ALWAYS', hotelCost: 120 });
  const ground = DEFAULT_GROUND_TRANSFERS.map((g) => (g.id === 'HKT-KRABI' ? { ...g, monetaryCost: 37.5 } : { ...g, monetaryCost: 0 }));
  const ctx = testContext({ originProfiles: Object.fromEntries(origins.map((o) => [o.airportCode, o])), groundTransfers: ground, ...extra }, testProfile({ enabledOrigins: ['AMS', 'BRU', 'FRA'], ...profileOverrides }));
  return ctx;
}

const bruHkt = (fare: number): NormalizedItinerary => itinerary({ id: 'BRU-HKT', fare, out: [{ from: 'BRU', to: 'DOH', dep: '2027-01-20T15:40', minutes: 380 }, { from: 'DOH', to: 'HKT', dep: '2027-01-21T02:00', minutes: 395 }], ret: [{ from: 'HKT', to: 'DOH', dep: '2027-02-08T20:05', minutes: 425 }, { from: 'DOH', to: 'BRU', dep: '2027-02-09T01:30', minutes: 400 }] });
const fraHkt = (fare: number): NormalizedItinerary => itinerary({ id: 'FRA-HKT', fare, out: [{ from: 'FRA', to: 'BKK', dep: '2027-01-20T14:00', minutes: 660, carrier: 'TG' }, { from: 'BKK', to: 'HKT', dep: '2027-01-21T09:30', minutes: 85, carrier: 'TG' }], ret: [{ from: 'HKT', to: 'BKK', dep: '2027-02-08T12:00', minutes: 85, carrier: 'TG' }, { from: 'BKK', to: 'FRA', dep: '2027-02-08T15:30', minutes: 735, carrier: 'TG' }] });

describe('acceptance scenarios', () => {
  it('A — €2,120 against eight comparable fares of €2,900–€3,250 is exceptional', () => {
    const a = assess(amsDohKbv({ fare: 2120 }), history([2950, 3100, 3050, 3250, 2900, 3180, 3020, 3110]));
    expect(a.level).toBe('EXCEPTIONAL');
    expect(a.referenceFare).toBe(3075);
    expect(a.dealScore).toBeGreaterThanOrEqual(75);
    expect(a.explanations.join(' ')).toMatch(/below the lowest comparable fare ever observed/);
  });

  it('B — a €11,800 marketing price never becomes the reference; €2,600 is ~15% below typical', () => {
    const a = assess(amsDohKbv({ fare: 2600 }), history([2900, 2950, 3000, 3100, 3150, 3200, 3050, 3180]));
    expect(a.referenceFare).toBeGreaterThan(3000);
    expect(a.referenceFare).toBeLessThan(3200);
    expect(a.percentBelowReference).toBeGreaterThanOrEqual(14);
    expect(a.percentBelowReference).toBeLessThanOrEqual(18);
    expect(a.explanations.join(' ')).not.toMatch(/78/);
  });

  it('C — financially equivalent journeys are decided by journey value, not ticket price', () => {
    const ctx = scenarioContext();
    const ams = amsDohKbv({ fare: 2260 });
    const bru = bruHkt(2000);
    const r = runPipeline([ams, bru], ctx);
    const jA = r.journeys.find((j) => j.itinerary.originAirport === 'AMS')!;
    const jB = r.journeys.find((j) => j.itinerary.originAirport === 'BRU')!;
    expect(jB.cost.airfare).toBe(2000);
    expect(jB.cost.accessOutbound + jB.cost.accessReturn).toBe(90);
    expect(jB.cost.hotelOutbound).toBe(120);
    expect(jB.cost.groundOutbound + jB.cost.groundReturn).toBe(75);
    expect(jB.cost.trueJourneyCost).toBe(2285);
    expect(jA.cost.trueJourneyCost).toBe(2285);
    expect(jA.categoryScores.trueCost).toBe(jB.categoryScores.trueCost);
    expect(jA.journeyValueScore).not.toBe(jB.journeyValueScore);
    // AMS → KBV: no hotel, no 3h driver, shorter door-to-door — a better journey at the same money.
    expect(jA.journeyValueScore).toBeGreaterThan(jB.journeyValueScore);
    expect(jA.totalActiveTravelBurdenMinutes).toBeLessThan(jB.totalActiveTravelBurdenMinutes);
  });

  it('D — FRA can be the superior fare deal while AMS is the superior journey value', () => {
    const hist = [...history([3000, 2950, 3050, 3100, 2900, 3000, 3150, 2980], { origin: 'FRA', gateway: 'HKT' }), ...history([3000, 2950, 3050, 3100, 2900, 3000, 3150, 2980])];
    const ctx = scenarioContext({ history: hist });
    const fra = fraHkt(1950);
    const ams = amsDohKbv({ fare: 2350 });
    const r = runPipeline([ams, fra], ctx);
    const jF = r.journeys.find((j) => j.itinerary.originAirport === 'FRA')!;
    const jA = r.journeys.find((j) => j.itinerary.originAirport === 'AMS')!;
    expect(['EXCELLENT', 'EXCEPTIONAL']).toContain(jF.deal.level);
    expect(jF.deal.referenceFare).toBe(3000);
    expect(jF.deal.dealScore!).toBeGreaterThan(jA.deal.dealScore!);
    expect(jF.hotelOutbound.required).toBe(true);
    expect(jF.groundTransfer.minutes).toBe(180);
    expect(jA.journeyValueScore).toBeGreaterThan(jF.journeyValueScore);
  });

  it('E — a deal score of 96 is presented as a score, never as a discount', () => {
    const it = amsDohKbv({ fare: 1500 });
    const big = Array.from({ length: 30 }, (_, i) => obs({ fare: 3000 + (i % 5) * 50, daysAgo: i % 9 }));
    const a = assess(it, big);
    expect(a.dealScore).toBeGreaterThanOrEqual(90);
    const text = a.explanations.join(' ');
    expect(text).toMatch(new RegExp(`Deal score ${a.dealScore}/100`));
    expect(text).not.toMatch(/discount|saved/i);
  });

  it('G — outlier resilience: €11,800 among €2,900–€3,200 produces no spectacular fake saving', () => {
    const a = assess(amsDohKbv({ fare: 2600 }), history([2900, 3000, 3050, 3100, 3200, 11800]));
    expect(a.referenceFare).toBe(3050);
    expect(a.percentBelowReference).toBeLessThan(16);
    expect(a.cohort!.excludedOutliers).toBe(1);
    expect(a.level).not.toBe('EXCEPTIONAL');
    expect(a.stats!.max).toBe(3200);
  });

  it('H — the FRA airfare advantage disappears once positioning and hotel are included', () => {
    const ctx = scenarioContext({}, {});
    // FRA: €160 positioning (80 per direction) + €120 hotel; AMS: €25 (12.5 fuel per direction). No ground cost at either gateway for this scenario.
    ctx.groundTransfers = ctx.groundTransfers.map((g) => ({ ...g, monetaryCost: 0 }));
    const r = runPipeline([amsDohKbv({ fare: 2200 }), fraHkt(1950)], ctx);
    const jA = r.journeys.find((j) => j.itinerary.originAirport === 'AMS')!;
    const jF = r.journeys.find((j) => j.itinerary.originAirport === 'FRA')!;
    expect(jA.cost.trueJourneyCost).toBe(2225);
    expect(jF.cost.trueJourneyCost).toBe(2230);
    expect(jA.baseline.isBaseline).toBe(true);
    expect(jF.baseline.airfareSavingVsBaseline).toBe(250);
    expect(jF.baseline.savingVsBaseline).toBe(-5);
    expect(jF.baseline.breakEvenFareEur).toBe(1945);
    expect(jF.baseline.dominant).toBe(false);
    expect(r.opportunities.some((o) => o.type === 'ALTERNATIVE_AIRPORT_OPPORTUNITY')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. self-audit 5: journey value vs fare deal separation
// ---------------------------------------------------------------------------

describe('journey value sanity (self-audit 5)', () => {
  it('prefers the local full-business journey while the fare deal score prefers the cheap mixed one', () => {
    const hist = [...history([3000, 2950, 3050, 3100, 2900, 3000, 3150, 2980], { origin: 'FRA', gateway: 'HKT', quality: 'MOSTLY' }), ...history([3000, 2950, 3050, 3100, 2900, 3000, 3150, 2980])];
    const ctx = scenarioContext({ history: hist });
    // A: 5h positioning to FRA + hotel, two stops with economy feeders, ~22h journey. B: local AMS, one stop, full business.
    const a = itinerary({ id: 'A', fare: 1900, out: [{ from: 'FRA', to: 'IST', dep: '2027-01-20T10:00', minutes: 185, cabin: 'ECONOMY', carrier: 'TK' }, { from: 'IST', to: 'BKK', dep: '2027-01-20T17:30', minutes: 540, carrier: 'TK' }, { from: 'BKK', to: 'HKT', dep: '2027-01-21T10:30', minutes: 85, cabin: 'ECONOMY', carrier: 'TK' }], ret: [{ from: 'HKT', to: 'BKK', dep: '2027-02-08T12:00', minutes: 85, cabin: 'ECONOMY', carrier: 'TK' }, { from: 'BKK', to: 'IST', dep: '2027-02-08T16:00', minutes: 620, carrier: 'TK' }, { from: 'IST', to: 'FRA', dep: '2027-02-08T23:30', minutes: 200, cabin: 'ECONOMY', carrier: 'TK' }] });
    const b = amsDohKbv({ id: 'B', fare: 2250 });
    const r = runPipeline([a, b], ctx);
    const jA = r.journeys.find((j) => j.itinerary.id.includes(':A'))!;
    const jB = r.journeys.find((j) => j.itinerary.id.includes(':B'))!;
    expect(jA.deal.cabinQuality.label).not.toBe('FULL');
    expect(jA.itinerary.cabinSummary.mixedCabin).toBe(true);
    expect(jB.deal.cabinQuality.label).toBe('FULL');
    expect(jA.deal.dealScore!).toBeGreaterThan(jB.deal.dealScore!);
    expect(jB.journeyValueScore).toBeGreaterThan(jA.journeyValueScore);
    // The fare-deal category is the only category fed by the deal score: no leakage of journey quality into it.
    expect(jA.categoryScores.fareAnomaly).toBe(jA.deal.dealScore);
  });
});

// ---------------------------------------------------------------------------
// 11. pipeline plumbing
// ---------------------------------------------------------------------------

describe('pipeline integration', () => {
  it('exposes deal counts for all seven classes, opportunities and the journey value alias', () => {
    const r = runPipeline([amsDohKbv()], testContext());
    expect(Object.keys(r.stats.dealCounts).sort()).toEqual(['EXCELLENT', 'EXCEPTIONAL', 'EXPENSIVE', 'GOOD', 'NORMAL', 'UNKNOWN', 'VERY_EXPENSIVE']);
    expect(r.opportunities).toEqual([]);
    const j: ScoredJourney = r.journeys[0]!;
    expect(j.journeyValueScore).toBe(j.overallScore);
    expect(j.deal.level).toBe('UNKNOWN');
    expect(j.categoryScores.fareAnomaly).toBe(50);
  });
});
