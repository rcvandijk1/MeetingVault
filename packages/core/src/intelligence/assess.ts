import type {
  Airport,
  CabinQualityAssessment,
  CohortSummary,
  DealAssessment,
  DealLevel,
  EnrichedJourney,
  FareClassificationThresholds,
  FareConfidence,
  FareIntelligenceConfig,
  FareObservation,
  FareStatistics,
  FareTrend,
  MarketPosition,
  NormalizedItinerary,
  RobustStats,
  TravelObjective,
  TripCostView,
} from '../types.js';
import { DEAL_LEVEL_LABELS } from '../types.js';
import { daysBetween } from '../time.js';
import { selectCohort, type CohortEnvironment, type CohortSelection } from './cohort.js';
import { assessCabinQuality, cabinQualityLabel, CABIN_QUALITY_TEXT } from './objective.js';
import { clamp, median, percentileRank, robustStats } from './stats.js';
import { fareTrend } from './trend.js';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const eur = (n: number): string => `€${Math.round(n).toLocaleString('en-GB')}`;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classification: the median band, plus the "below the floor" rule — a fare
 * at least `exceptionalBelowLowestPercent` below the lowest comparable fare
 * ever observed lies outside the whole distribution and is EXCEPTIONAL.
 */
export function classifyFare(fareEur: number, stats: Pick<RobustStats, 'median' | 'min'>, t: FareClassificationThresholds): { level: DealLevel; belowFloor: boolean } {
  if (!(stats.median > 0)) return { level: 'UNKNOWN', belowFloor: false };
  const percent = (fareEur / stats.median) * 100;
  const belowFloor = stats.min > 0 && fareEur <= stats.min * (1 - t.exceptionalBelowLowestPercent / 100);
  const level = classifyPercentOfMedian(percent, t);
  return { level: belowFloor ? 'EXCEPTIONAL' : level, belowFloor };
}

/** Maps fare-as-percent-of-median to the six classification bands. */
export function classifyPercentOfMedian(percentOfMedian: number | null, t: FareClassificationThresholds): DealLevel {
  if (percentOfMedian === null || !Number.isFinite(percentOfMedian)) return 'UNKNOWN';
  if (percentOfMedian <= t.exceptional) return 'EXCEPTIONAL';
  if (percentOfMedian <= t.excellent) return 'EXCELLENT';
  if (percentOfMedian <= t.good) return 'GOOD';
  if (percentOfMedian <= t.normal) return 'NORMAL';
  if (percentOfMedian <= t.expensive) return 'EXPENSIVE';
  return 'VERY_EXPENSIVE';
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export function confidenceFor(cohort: CohortSummary | null, source: DealAssessment['source'], cfg: FareIntelligenceConfig): { confidence: FareConfidence; reasons: string[] } {
  if (source === 'NONE' || !cohort) return { confidence: 'NONE', reasons: ['No comparable fares observed yet'] };
  const reasons: string[] = [];
  if (source === 'SEARCH_DISTRIBUTION') return { confidence: 'LOW', reasons: ['Reference is the current search only, no historical observations for this comparison'] };
  const c = cfg.confidence;
  let level: FareConfidence = 'LOW';
  if (cohort.sampleCount >= c.highMinSamples && cohort.distinctDays >= c.highMinDistinctDays) level = 'HIGH';
  else if (cohort.sampleCount >= c.mediumMinSamples && cohort.distinctDays >= c.mediumMinDistinctDays) level = 'MEDIUM';
  if (level !== 'HIGH') {
    if (cohort.sampleCount < c.highMinSamples) reasons.push(`Only ${cohort.sampleCount} comparable observations (${c.highMinSamples} needed for high confidence)`);
    if (cohort.distinctDays < c.highMinDistinctDays) reasons.push(`Observed on only ${cohort.distinctDays} distinct day${cohort.distinctDays === 1 ? '' : 's'}`);
  }
  if (cohort.level === 3 && level === 'HIGH') {
    level = 'MEDIUM';
    reasons.push('Comparison widened to other airports in the same region');
  }
  if (cohort.level === 4 && level !== 'LOW') {
    level = 'LOW';
    reasons.push('Comparison widened to any origin and any Krabi-region gateway');
  }
  if (cohort.relaxations.length > 0 && cohort.level <= 2) reasons.push(`Not matched on ${cohort.relaxations.join(', ')}`);
  return { confidence: level, reasons };
}

const CONFIDENCE_MULTIPLIER: Record<FareConfidence, number> = { HIGH: 1, MEDIUM: 0.85, LOW: 0.6, NONE: 0 };

// ---------------------------------------------------------------------------
// Deal score
// ---------------------------------------------------------------------------

export interface DealScoreInputs {
  fareEur: number;
  median: number;
  lowest: number;
  percentileRank: number;
  confidence: FareConfidence;
  cabinPenalty: number;
}

/**
 * 0..100 deal score. Neutral is 50 (fare at the median with average confidence).
 * Three fare components (position versus median, percentile rank in the cohort,
 * distance to the cohort low) are combined, pulled towards neutral in
 * proportion to the confidence, and reduced for non-full cabin quality.
 * It is deliberately not a percentage discount.
 */
export function dealScoreFor(i: DealScoreInputs): number | null {
  if (!(i.median > 0) || !Number.isFinite(i.fareEur)) return null;
  const ratio = i.fareEur / i.median;
  const position = clamp(50 + (1 - ratio) * 133, 0, 100);
  const rank = clamp((1 - i.percentileRank) * 100, 0, 100);
  const lowRatio = i.lowest > 0 ? i.fareEur / i.lowest : 1;
  const vsLow = lowRatio <= 1 ? 100 : clamp(100 - (lowRatio - 1) * 250, 0, 100);
  const raw = position * 0.6 + rank * 0.2 + vsLow * 0.2;
  const dampened = 50 + (raw - 50) * CONFIDENCE_MULTIPLIER[i.confidence];
  return Math.round(clamp(dampened - i.cabinPenalty, 0, 100));
}

// ---------------------------------------------------------------------------
// Current market (this search only)
// ---------------------------------------------------------------------------

/** Where the fare sits among comparable options of the current search: same cabin and cabin-quality tier. */
export function marketPosition(it: NormalizedItinerary, set: NormalizedItinerary[]): MarketPosition {
  const quality = cabinQualityLabel(it.cabinSummary);
  const comparable = set.filter((x) => x.cabinSummary.requestedCabin === it.cabinSummary.requestedCabin && cabinQualityLabel(x.cabinSummary) === quality);
  const tiers: Array<[MarketPosition['scope'], NormalizedItinerary[]]> = [
    ['ROUTE', comparable.filter((x) => x.originAirport === it.originAirport && x.arrivalGateway === it.arrivalGateway)],
    ['GATEWAY', comparable.filter((x) => x.arrivalGateway === it.arrivalGateway)],
    ['CABIN', comparable],
  ];
  const tier = tiers.find(([, list]) => list.length >= 3) ?? tiers[2]!;
  const [scope, list] = tier;
  if (list.length <= 1) return { scope: 'NONE', comparableCount: list.length, cheapestEur: null, medianEur: null, rank: null, differenceToBestEur: null, percentAboveBest: null };
  const fares = list.map((x) => x.fareEur).sort((a, b) => a - b);
  const cheapest = fares[0]!;
  const med = median(fares)!;
  const rank = fares.filter((f) => f < it.fareEur).length + 1;
  return {
    scope,
    comparableCount: list.length,
    cheapestEur: cheapest,
    medianEur: Math.round(med),
    rank,
    differenceToBestEur: Math.round((it.fareEur - cheapest) * 100) / 100,
    percentAboveBest: cheapest > 0 ? round1(((it.fareEur - cheapest) / cheapest) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Costs (financial vs time, never merged silently)
// ---------------------------------------------------------------------------

export function tripCostView(j: EnrichedJourney, cfg: FareIntelligenceConfig): TripCostView {
  const burden = j.totalActiveTravelBurdenMinutes;
  if (!cfg.timeValue.enabled) return { financialTrueCostEur: j.cost.trueJourneyCost, journeyBurdenMinutes: burden, valueOfTimeEur: null, trueTripCostIncludingTimeEur: null };
  const nights = (j.hotelOutbound.required ? 1 : 0) + (j.hotelReturn.required ? 1 : 0);
  const transfers = j.itinerary.outbound.transfers + j.itinerary.inbound.transfers;
  const vot = Math.round(((burden / 60) * cfg.timeValue.eurPerActiveHour + nights * cfg.timeValue.eurPerHotelNight + transfers * cfg.timeValue.eurPerTransfer) * 100) / 100;
  return { financialTrueCostEur: j.cost.trueJourneyCost, journeyBurdenMinutes: burden, valueOfTimeEur: vot, trueTripCostIncludingTimeEur: Math.round((j.cost.trueJourneyCost + vot) * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export interface AssessFareArgs {
  /** All accepted itineraries of the current search (for the market position and the search-distribution fallback). */
  set: NormalizedItinerary[];
  history: FareObservation[];
  config: FareIntelligenceConfig;
  airports: Record<string, Airport>;
  objective: TravelObjective;
  now: string;
  /** Enriched journey (for the cost view); optional so the assessment can run on bare itineraries. */
  journey?: EnrichedJourney;
}

function statisticsFor(cohort: CohortSelection, fareEur: number, now: string, cfg: FareIntelligenceConfig): FareStatistics {
  const fares = cohort.observations.map((o) => o.fareEur);
  const base = robustStats(fares)!;
  const nowMs = new Date(now).getTime();
  const within = (days: number): number[] => cohort.observations.filter((o) => nowMs - new Date(o.observedAt).getTime() <= days * 86400000).map((o) => o.fareEur);
  return {
    ...base,
    recentMedian: median(within(cfg.recentDays)),
    rollingMedian: median(within(cfg.rollingDays)),
    seasonalMedian: cfg.seasonalityEnabled ? median(cohort.seasonal.map((o) => o.fareEur)) : null,
    percentileRank: Math.round(percentileRank([...fares].sort((a, b) => a - b), fareEur) * 1000) / 1000,
  };
}

/** Search-distribution fallback: same cabin and quality tier, route → gateway → all, at least 3 fares. */
function searchDistribution(it: NormalizedItinerary, set: NormalizedItinerary[]): { fares: number[]; description: string } | null {
  const quality = cabinQualityLabel(it.cabinSummary);
  const comparable = set.filter((x) => x.cabinSummary.requestedCabin === it.cabinSummary.requestedCabin && cabinQualityLabel(x.cabinSummary) === quality);
  const tiers: Array<[string, NormalizedItinerary[]]> = [
    [`${it.originAirport} → ${it.arrivalGateway} fares in this search`, comparable.filter((x) => x.originAirport === it.originAirport && x.arrivalGateway === it.arrivalGateway)],
    [`fares to ${it.arrivalGateway} in this search`, comparable.filter((x) => x.arrivalGateway === it.arrivalGateway)],
    [`all ${it.cabinSummary.requestedCabin.toLowerCase().replace('_', ' ')} fares in this search`, comparable],
  ];
  const tier = tiers.find(([, list]) => list.length >= 3);
  return tier ? { fares: tier[1].map((x) => x.fareEur), description: tier[0] } : null;
}

const empty = (it: NormalizedItinerary, cfg: FareIntelligenceConfig, market: MarketPosition, trend: FareTrend | null, costs: TripCostView | null): DealAssessment => ({
  level: 'UNKNOWN',
  dealScore: null,
  confidence: 'NONE',
  confidenceReasons: ['No comparable fares observed yet'],
  source: 'NONE',
  referenceFare: null,
  referenceLow: null,
  referenceHigh: null,
  percentOfMedian: null,
  percentBelowReference: null,
  savingVsMedianEur: null,
  savingVsP25Eur: null,
  aboveLowestEur: null,
  comparableObservations: 0,
  lowestObservedComparable: null,
  cohort: null,
  stats: null,
  market,
  trend,
  cabinQuality: assessCabinQuality(it.cabinSummary, cfg),
  costs,
  explanations: ['No historical or current comparison available for this fare yet. Run more searches to build a baseline.'],
  opportunities: [],
});

/**
 * Historical fare intelligence for one itinerary. Reference prices come only
 * from the application's own observations (medians, never maxima or marketing
 * "was" prices); when no historical cohort exists the current search
 * distribution is used and clearly labelled with LOW confidence.
 */
export function assessFare(it: NormalizedItinerary, args: AssessFareArgs): DealAssessment {
  const cfg = args.config;
  const cabinQuality = assessCabinQuality(it.cabinSummary, cfg);
  const market = marketPosition(it, args.set);
  const trend = fareTrend(it.fingerprint, it.fareEur, args.history, args.now, cfg);
  const costs = args.journey ? tripCostView(args.journey, cfg) : null;
  const outboundDate = it.outbound.departureLocal.slice(0, 10);
  const target = {
    originAirport: it.originAirport,
    arrivalGateway: it.arrivalGateway,
    cabin: it.cabinSummary.requestedCabin,
    cabinQuality: cabinQuality.label,
    outboundDate,
    inboundDate: it.inbound.departureLocal.slice(0, 10),
    daysToDeparture: daysBetween(args.now.slice(0, 10), outboundDate),
  };
  const env: CohortEnvironment = { now: args.now, airports: args.airports, objective: args.objective, config: cfg };
  const cohort = selectCohort(args.history, target, env);

  let source: DealAssessment['source'] = 'NONE';
  let stats: FareStatistics | null = null;
  let summary: CohortSummary | null = null;
  if (cohort) {
    source = 'HISTORY';
    summary = cohort.summary;
    stats = statisticsFor(cohort, it.fareEur, args.now, cfg);
  } else {
    const dist = searchDistribution(it, args.set);
    if (dist) {
      source = 'SEARCH_DISTRIBUTION';
      const base = robustStats(dist.fares)!;
      stats = { ...base, recentMedian: null, rollingMedian: null, seasonalMedian: null, percentileRank: Math.round(percentileRank([...dist.fares].sort((a, b) => a - b), it.fareEur) * 1000) / 1000 };
      summary = { level: 0, description: dist.description, windowDays: 0, sampleCount: dist.fares.length, distinctDays: 1, from: args.now, to: args.now, season: null, advancePurchaseBand: null, tripDaysBand: null, relaxations: ['history (none available)'], excludedInvalid: 0, excludedOutliers: 0 };
    }
  }
  if (!stats || !summary || stats.median <= 0) return empty(it, cfg, market, trend, costs);

  const { confidence, reasons } = confidenceFor(summary, source, cfg);
  const percentOfMedian = round1((it.fareEur / stats.median) * 100);
  const { level, belowFloor } = classifyFare(it.fareEur, stats, cfg.thresholds);
  const dealScore = dealScoreFor({ fareEur: it.fareEur, median: stats.median, lowest: stats.min, percentileRank: stats.percentileRank, confidence, cabinPenalty: cabinQuality.penalty });
  const assessment: DealAssessment = {
    level,
    dealScore,
    confidence,
    confidenceReasons: reasons,
    source,
    referenceFare: Math.round(stats.median),
    referenceLow: Math.round(stats.p25),
    referenceHigh: Math.round(stats.p75),
    percentOfMedian,
    percentBelowReference: round1(100 - percentOfMedian),
    savingVsMedianEur: Math.round((stats.median - it.fareEur) * 100) / 100,
    savingVsP25Eur: Math.round((stats.p25 - it.fareEur) * 100) / 100,
    aboveLowestEur: Math.max(0, Math.round((it.fareEur - stats.min) * 100) / 100),
    comparableObservations: summary.sampleCount,
    lowestObservedComparable: Math.round(stats.min),
    cohort: summary,
    stats,
    market,
    trend,
    cabinQuality,
    costs,
    explanations: [],
    opportunities: [],
  };
  assessment.explanations = explainDeal(it, assessment, belowFloor);
  return assessment;
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

export function explainDeal(it: NormalizedItinerary, a: DealAssessment, belowFloor = false): string[] {
  const out: string[] = [];
  if (!a.stats || !a.cohort || a.referenceFare === null || a.percentOfMedian === null) return ['No reference available.'];
  const cabin = it.cabinSummary.requestedCabin.toLowerCase().replace('_', ' ');
  const window = a.cohort.windowDays === 0 ? 'all history' : `the last ${a.cohort.windowDays} days`;
  const where = a.source === 'HISTORY' ? `${a.cohort.sampleCount} comparable ${cabin} fares (${a.cohort.description}) observed over ${window} on ${a.cohort.distinctDays} day${a.cohort.distinctDays === 1 ? '' : 's'}` : `${a.cohort.sampleCount} ${a.cohort.description}`;
  const rel = a.percentOfMedian < 99.5 ? `${round1(100 - a.percentOfMedian)}% below` : a.percentOfMedian > 100.5 ? `${round1(a.percentOfMedian - 100)}% above` : 'at';
  out.push(`${DEAL_LEVEL_LABELS[a.level]}: ${eur(it.fareEur)} is ${rel} the median of ${eur(a.stats.median)} across ${where}.`);
  if (belowFloor) out.push(`Classified exceptional because it is ${round1(((a.stats.min - it.fareEur) / a.stats.min) * 100)}% below the lowest comparable fare ever observed (${eur(a.stats.min)}), i.e. outside the whole observed distribution.`);
  out.push(`Typical range ${eur(a.stats.p25)} – ${eur(a.stats.p75)} (p25–p75); lowest comparable ${eur(a.stats.min)}${a.aboveLowestEur !== null && a.aboveLowestEur > 0 ? `, this fare is ${eur(a.aboveLowestEur)} above it` : ', this fare matches or beats it'}.`);
  if (a.savingVsMedianEur !== null) out.push(`${a.savingVsMedianEur >= 0 ? 'Saving' : 'Premium'} versus the median baseline: ${eur(Math.abs(a.savingVsMedianEur))}.`);
  if (a.stats.recentMedian !== null && a.stats.rollingMedian !== null) out.push(`Recent median ${eur(a.stats.recentMedian)} (7 days), rolling median ${eur(a.stats.rollingMedian)} (30 days)${a.stats.seasonalMedian !== null ? `, same-season median ${eur(a.stats.seasonalMedian)}` : ''}.`);
  if (a.cohort.level === 1) out.push(`Cohort level 1: same route, trip length ${a.cohort.tripDaysBand}, ${a.cohort.season?.toLowerCase()} departures, booked ${a.cohort.advancePurchaseBand} days ahead.`);
  else if (a.cohort.level > 0) out.push(`Cohort level ${a.cohort.level}: widened to ${a.cohort.description} because more specific comparisons lacked samples.`);
  else out.push('No historical cohort yet: compared with the current search only.');
  if (a.dealScore !== null) out.push(`Deal score ${a.dealScore}/100 combines percentile rank (${Math.round((1 - a.stats.percentileRank) * 100)}% of comparable fares are more expensive), distance below the median, distance to the low and ${a.confidence.toLowerCase()} confidence.`);
  out.push(`Confidence ${a.confidence.toLowerCase()}${a.confidenceReasons.length ? `: ${a.confidenceReasons.join('; ')}` : ''}.`);
  if (a.cabinQuality.label !== 'FULL') out.push(`${CABIN_QUALITY_TEXT[a.cabinQuality.label]} ${cabin}: ${Math.round(a.cabinQuality.premiumCabinPercent)}% of air time in ${cabin} (${Math.round(a.cabinQuality.longHaulPremiumPercent)}% of long-haul); compared only with other ${a.cabinQuality.label.toLowerCase()}-${cabin} fares and ${a.cabinQuality.penalty} points removed from the deal score.`);
  if (a.trend) {
    if (a.trend.isNewLow) out.push(`New low for this itinerary: previously ${eur(a.trend.lowestSeenEur ?? 0)} at best over ${a.trend.timesSeenBefore} observation${a.trend.timesSeenBefore === 1 ? '' : 's'}.`);
    else if (a.trend.changeVsPreviousPercent !== null && Math.abs(a.trend.changeVsPreviousPercent) >= 1) out.push(`${a.trend.changeVsPreviousPercent < 0 ? 'Down' : 'Up'} ${Math.abs(a.trend.changeVsPreviousPercent)}% versus the previous observation (${eur(a.trend.previousFareEur ?? 0)}).`);
  }
  if (a.market.rank !== null) out.push(`In this search: #${a.market.rank} of ${a.market.comparableCount} comparable ${a.market.scope.toLowerCase()} options, ${a.market.differenceToBestEur === 0 ? 'the cheapest' : `${eur(a.market.differenceToBestEur ?? 0)} above the cheapest`}.`);
  if (a.cohort.excludedOutliers > 0) out.push(`${a.cohort.excludedOutliers} implausible observation${a.cohort.excludedOutliers === 1 ? '' : 's'} excluded from the reference.`);
  return out;
}

export { cabinQualityLabel, assessCabinQuality };
export type { CabinQualityAssessment };
