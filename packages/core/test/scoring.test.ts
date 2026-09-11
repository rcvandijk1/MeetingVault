import { describe, expect, it } from 'vitest';
import { bandScoreAt, flightTimingBreakdown, normalizeBandScore, sleepOpportunityScore, timeOfDayScore } from '../src/pipeline/timing.js';
import { computeOverall, explainScore, rankJourneys } from '../src/pipeline/rank.js';
import { dominates, paretoAnalysis } from '../src/pipeline/pareto.js';
import { assessDeal } from '../src/pipeline/deal.js';
import { classifyPercentOfMedian } from '../src/intelligence/assess.js';
import { legTransferScore, selfTransferRiskScore } from '../src/pipeline/scoring.js';
import { DEFAULT_FARE_INTELLIGENCE, DEFAULT_SCORING_PARAMS, DEFAULT_SELF_TRANSFER_POLICY, DEFAULT_TIME_PREFERENCES, DEFAULT_WEIGHTS } from '../src/defaults.js';
import type { FareObservation, ScoreWeights, ScoredJourney } from '../src/types.js';
import { runPipeline } from '../src/pipeline/index.js';
import { amsDohKbv, itinerary, testContext } from './helpers.js';

const bands = DEFAULT_TIME_PREFERENCES.outboundDeparture;

describe('time preference scoring', () => {
  it('returns the band score for a time inside a band', () => {
    expect(bandScoreAt(bands, 20 * 60)).toBe(20);
    expect(bandScoreAt(bands, 8 * 60)).toBe(-10);
  });

  it('handles bands crossing midnight', () => {
    expect(bandScoreAt(bands, 23 * 60 + 30)).toBe(-30);
    expect(bandScoreAt(bands, 2 * 60)).toBe(-30);
    expect(bandScoreAt(bands, 6 * 60 + 59)).toBe(-30);
    expect(bandScoreAt(bands, 7 * 60)).toBe(-10);
  });

  it('normalises to 0..100 relative to the best and worst band', () => {
    expect(normalizeBandScore(bands, 20)).toBe(100);
    expect(normalizeBandScore(bands, -30)).toBe(0);
    expect(normalizeBandScore(bands, -10)).toBe(40);
    expect(timeOfDayScore(bands, '2027-01-20T20:30')).toBe(100);
  });

  it('uses separate curves for the four legs', () => {
    const it = amsDohKbv();
    const b = flightTimingBreakdown(it, DEFAULT_TIME_PREFERENCES, DEFAULT_SCORING_PARAMS);
    expect(b.outboundDeparture).toBe(100); // 20:30
    expect(b.returnDeparture).toBe(100); // 20:35
    expect(b.returnArrival).toBe(40); // 06:25
    expect(b.weighted).toBeGreaterThan(0);
    const flipped = flightTimingBreakdown(it, { ...DEFAULT_TIME_PREFERENCES, outboundDeparture: [{ start: '19:00', end: '23:00', score: -50 }, { start: '23:00', end: '19:00', score: 50 }] }, DEFAULT_SCORING_PARAMS);
    expect(flipped.outboundDeparture).toBe(0);
  });

  it('rewards a well-timed overnight long-haul as a sleep opportunity', () => {
    const night = amsDohKbv();
    const day = itinerary({
      fare: 1500,
      out: [{ from: 'AMS', to: 'BKK', dep: '2027-01-20T09:00', minutes: 665 }, { from: 'BKK', to: 'KBV', dep: '2027-01-21T09:20', minutes: 80 }],
      ret: [{ from: 'KBV', to: 'BKK', dep: '2027-02-08T09:00', minutes: 80 }, { from: 'BKK', to: 'AMS', dep: '2027-02-08T12:30', minutes: 770 }],
    });
    expect(sleepOpportunityScore(night, DEFAULT_SCORING_PARAMS)).toBeGreaterThan(sleepOpportunityScore(day, DEFAULT_SCORING_PARAMS));
  });
});

describe('transfer scoring', () => {
  it('prefers connections within the ideal window over both very short and very long ones', () => {
    const ideal = amsDohKbv().outbound; // 2h05
    const short = itinerary({ fare: 1, out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T20:30', minutes: 375 }, { from: 'DOH', to: 'KBV', dep: '2027-01-21T05:30', minutes: 390 }], ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }] }).outbound; // 45m
    const long = itinerary({ fare: 1, out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T20:30', minutes: 375 }, { from: 'DOH', to: 'KBV', dep: '2027-01-21T09:30', minutes: 390 }], ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }] }).outbound; // 4h45
    const s = (l: typeof ideal): number => legTransferScore(l, DEFAULT_SCORING_PARAMS);
    expect(s(ideal)).toBeGreaterThan(s(short));
    expect(s(ideal)).toBeGreaterThan(s(long));
    expect(s(itinerary({ fare: 1, out: [{ from: 'AMS', to: 'KBV', dep: '2027-01-20T20:30', minutes: 700 }], ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }] }).outbound)).toBe(100);
  });

  it('never scores a self-transfer like a protected connection', () => {
    const protectedIt = amsDohKbv();
    const selfIt = itinerary({
      fare: 1250,
      out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T20:30', minutes: 375, ticket: 'T1' }, { from: 'DOH', to: 'KBV', dep: '2027-01-21T06:50', minutes: 390, ticket: 'T2' }],
      ret: [{ from: 'KBV', to: 'DOH', dep: '2027-02-08T20:35', minutes: 420, ticket: 'T2' }, { from: 'DOH', to: 'AMS', dep: '2027-02-09T01:40', minutes: 405, ticket: 'T1' }],
    });
    expect(selfTransferRiskScore([protectedIt.outbound, protectedIt.inbound], DEFAULT_SCORING_PARAMS, DEFAULT_SELF_TRANSFER_POLICY)).toBe(100);
    expect(selfTransferRiskScore([selfIt.outbound, selfIt.inbound], DEFAULT_SCORING_PARAMS, DEFAULT_SELF_TRANSFER_POLICY)).toBeLessThan(40);
    expect(legTransferScore(selfIt.outbound, DEFAULT_SCORING_PARAMS)).toBeLessThan(legTransferScore(protectedIt.outbound, DEFAULT_SCORING_PARAMS));
  });
});

describe('weighted scoring', () => {
  const scores = { trueCost: 91, journeyTime: 82, flightTiming: 96, transferQuality: 88, fareAnomaly: 95, cabinQuality: 90, originInconvenience: 85, selfTransferRisk: 100, destinationTransfer: 90 };

  // 91×.30 + 82×.20 + 96×.15 + 88×.10 + 95×.10 + 90×.05 + 85×.05 + 100×.03 + 90×.02 = 89.95
  it('computes the weighted overall score (spec example rows → 89.95, rounded 90)', () => {
    expect(computeOverall(scores, DEFAULT_WEIGHTS)).toBe(90);
  });

  it('normalises weights that do not sum to 100', () => {
    const doubled = Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, v * 2])) as ScoreWeights;
    expect(computeOverall(scores, doubled)).toBe(90);
    expect(computeOverall(scores, { ...DEFAULT_WEIGHTS, trueCost: 0, journeyTime: 0, flightTiming: 0, transferQuality: 0, fareAnomaly: 0, cabinQuality: 0, originInconvenience: 0, selfTransferRisk: 0, destinationTransfer: 100 })).toBe(90);
    expect(computeOverall(scores, { ...DEFAULT_WEIGHTS, journeyTime: 0, flightTiming: 0, transferQuality: 0, fareAnomaly: 0, cabinQuality: 0, originInconvenience: 0, selfTransferRisk: 0, destinationTransfer: 0 })).toBe(91);
  });

  it('explains the score row by row', () => {
    const e = explainScore(scores, DEFAULT_WEIGHTS);
    expect(e.rows).toHaveLength(9);
    expect(e.rows[0]!.category).toBe('trueCost');
    expect(e.rows[0]!.weightPercent).toBe(30);
    expect(e.rows[0]!.contribution).toBe(27.3);
    expect(e.rows.reduce((s, r) => s + r.contribution, 0)).toBeCloseTo(89.95, 1);
    expect(e.final).toBe(90);
  });
});

describe('Pareto dominance', () => {
  it('marks an option that is more expensive, slower and less convenient as dominated', () => {
    const a = { id: 'a', cost: 1700, minutes: 1000, convenience: 90 };
    const b = { id: 'b', cost: 1900, minutes: 1100, convenience: 80 };
    const c = { id: 'c', cost: 1500, minutes: 1300, convenience: 60 }; // cheaper but slower: not dominated
    expect(dominates(a, b)).toBe(true);
    expect(dominates(a, c)).toBe(false);
    const res = paretoAnalysis([a, b, c]);
    expect(res.get('b')).toBe('a');
    expect(res.get('a')).toBeNull();
    expect(res.get('c')).toBeNull();
  });

  it('does not let identical options dominate each other', () => {
    const a = { id: 'a', cost: 1, minutes: 1, convenience: 1 };
    const b = { id: 'b', cost: 1, minutes: 1, convenience: 1 };
    expect(dominates(a, b)).toBe(false);
  });
});

describe('deal intelligence', () => {
  const t = DEFAULT_FARE_INTELLIGENCE.thresholds;
  it('maps fare as a percent of the cohort median to the six classification bands', () => {
    expect(classifyPercentOfMedian(null, t)).toBe('UNKNOWN');
    expect(classifyPercentOfMedian(55, t)).toBe('EXCEPTIONAL');
    expect(classifyPercentOfMedian(70, t)).toBe('EXCELLENT');
    expect(classifyPercentOfMedian(80, t)).toBe('GOOD');
    expect(classifyPercentOfMedian(100, t)).toBe('NORMAL');
    expect(classifyPercentOfMedian(120, t)).toBe('EXPENSIVE');
    expect(classifyPercentOfMedian(150, t)).toBe('VERY_EXPENSIVE');
  });

  it('uses the application history as reference when enough observations exist', () => {
    const it = amsDohKbv({ fare: 1690 });
    const history: FareObservation[] = [2400, 2500, 2600, 2700, 2800].map((fare, i) => ({ observedAt: `2026-09-0${i + 1}T00:00:00Z`, originAirport: 'AMS', arrivalGateway: 'KBV', outboundDate: '2027-01-20', inboundDate: '2027-02-08', airline: 'QR', cabin: 'BUSINESS', fare, currency: 'EUR', fareEur: fare, provider: 'mock', itineraryFingerprint: 'x', cabinQuality: 'FULL' }));
    const deal = assessDeal(it, [it], testContext({ history }));
    expect(deal.source).toBe('HISTORY');
    expect(deal.referenceFare).toBe(2600);
    expect(deal.referenceLow).toBe(2500);
    expect(deal.referenceHigh).toBe(2700);
    expect(deal.percentBelowReference).toBe(35);
    expect(deal.percentOfMedian).toBe(65);
    // 65% of the median would be EXCELLENT; 30% below the lowest comparable fare ever seen triggers the below-the-floor rule.
    expect(deal.level).toBe('EXCEPTIONAL');
    expect(deal.confidence).toBe('LOW');
    expect(deal.cohort?.level).toBe(1);
  });

  it('falls back to the search distribution without history, with low confidence', () => {
    const cheap = amsDohKbv({ id: 'cheap', fare: 1200 });
    const set = [cheap, amsDohKbv({ id: 'b', fare: 2000, depTime: '15:55' }), amsDohKbv({ id: 'c', fare: 2100, depTime: '10:00' }), amsDohKbv({ id: 'd', fare: 2200, depTime: '11:00' })];
    const deal = assessDeal(cheap, set, testContext({ history: [] }));
    expect(deal.source).toBe('SEARCH_DISTRIBUTION');
    expect(deal.percentBelowReference).toBeGreaterThan(40);
    expect(deal.level).toBe('EXCEPTIONAL');
    expect(deal.confidence).toBe('LOW');
    expect(deal.cohort?.level).toBe(0);
    expect(deal.market.rank).toBe(1);
  });
});

describe('saving per extra hour', () => {
  it('computes saving vs the AMS baseline and identifies dominant alternatives', () => {
    const ctx = testContext();
    const ams = amsDohKbv({ fare: 1690 });
    const dus = itinerary({
      id: 'DUS',
      fare: 1420,
      out: [{ from: 'DUS', to: 'DOH', dep: '2027-01-20T15:40', minutes: 370 }, { from: 'DOH', to: 'HKT', dep: '2027-01-21T01:50', minutes: 395 }],
      ret: [{ from: 'HKT', to: 'DOH', dep: '2027-02-08T20:05', minutes: 425 }, { from: 'DOH', to: 'DUS', dep: '2027-02-09T01:20', minutes: 395 }],
    });
    const res = runPipeline([ams, dus], ctx);
    const amsJ = res.journeys.find((j) => j.itinerary.originAirport === 'AMS')!;
    const dusJ = res.journeys.find((j) => j.itinerary.originAirport === 'DUS')!;
    expect(amsJ.baseline.isBaseline).toBe(true);
    expect(amsJ.baseline.baselineStrategy).toBe('BASELINE_ORIGIN');
    expect(dusJ.baseline.savingVsBaseline).toBeCloseTo(amsJ.cost.trueJourneyCost - dusJ.cost.trueJourneyCost, 2);
    expect(dusJ.baseline.extraMinutesVsBaseline).toBe(dusJ.totalActiveTravelBurdenMinutes - amsJ.totalActiveTravelBurdenMinutes);
    expect(dusJ.baseline.savingPerExtraHour).toBeCloseTo(dusJ.baseline.savingVsBaseline! / (dusJ.baseline.extraMinutesVsBaseline! / 60), 1);
    expect(dusJ.baseline.dominant).toBe(false);
  });

  it('uses €54.55/hour for €300 over 5.5 hours', () => {
    const base = { totalActiveTravelBurdenMinutes: 0, cost: { trueJourneyCost: 2000 } };
    const alt = { totalActiveTravelBurdenMinutes: 330, cost: { trueJourneyCost: 1700 } };
    const mk = (id: string, origin: string, x: typeof base): ScoredJourney =>
      ({ ...({} as ScoredJourney), itinerary: { ...amsDohKbv({ id }), originAirport: origin }, totalActiveTravelBurdenMinutes: x.totalActiveTravelBurdenMinutes, totalDoorToDoorMinutes: x.totalActiveTravelBurdenMinutes, cost: x.cost as ScoredJourney['cost'], hotelOutbound: { required: false, reason: '', cost: 0, restMinutes: 0 }, categoryScores: { trueCost: 50, journeyTime: 50, flightTiming: 50, transferQuality: 50, fareAnomaly: 50, cabinQuality: 50, originInconvenience: 50, selfTransferRisk: 50, destinationTransfer: 50 }, labels: [] }) as ScoredJourney;
    const ranked = rankJourneys([mk('a', 'AMS', base), mk('b', 'CPH', alt)], { weights: DEFAULT_WEIGHTS, baselineOrigin: 'AMS' });
    const cph = ranked.find((j) => j.itinerary.originAirport === 'CPH')!;
    expect(cph.baseline.savingVsBaseline).toBe(300);
    expect(cph.baseline.extraMinutesVsBaseline).toBe(330);
    expect(cph.baseline.savingPerExtraHour).toBe(54.55);
  });

  it('marks an alternative that is both cheaper and faster as dominant', () => {
    const mk = (id: string, origin: string, cost: number, minutes: number): ScoredJourney =>
      ({ ...({} as ScoredJourney), itinerary: { ...amsDohKbv({ id }), originAirport: origin }, totalActiveTravelBurdenMinutes: minutes, totalDoorToDoorMinutes: minutes, cost: { trueJourneyCost: cost } as ScoredJourney['cost'], hotelOutbound: { required: false, reason: '', cost: 0, restMinutes: 0 }, categoryScores: { trueCost: 50, journeyTime: 50, flightTiming: 50, transferQuality: 50, fareAnomaly: 50, cabinQuality: 50, originInconvenience: 50, selfTransferRisk: 50, destinationTransfer: 50 }, labels: [] }) as ScoredJourney;
    const ranked = rankJourneys([mk('a', 'AMS', 2000, 1000), mk('b', 'DUS', 1800, 900)], { weights: DEFAULT_WEIGHTS, baselineOrigin: 'AMS' });
    const dus = ranked.find((j) => j.itinerary.originAirport === 'DUS')!;
    expect(dus.baseline.dominant).toBe(true);
    expect(dus.labels).toContain('DOMINANT');
    expect(dus.baseline.savingPerExtraHour).toBeNull();
  });
});
