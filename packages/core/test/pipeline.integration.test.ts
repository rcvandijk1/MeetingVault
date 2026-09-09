import { describe, expect, it } from 'vitest';
import { MockFlightSearchProvider } from '../src/providers/mock/MockFlightSearchProvider.js';
import { SearchOrchestrator } from '../src/providers/orchestrator.js';
import { runPipeline, rescoreJourneys } from '../src/pipeline/index.js';
import { planFromProfile } from '../src/plan.js';
import { DEFAULT_ORIGIN_PROFILES, DEFAULT_WEIGHTS } from '../src/defaults.js';
import { FX, NOW, testContext, testProfile } from './helpers.js';
import type { ScoredJourney } from '../src/types.js';

const fixedNow = () => new Date(NOW);

async function runSearch(profileOverrides = {}, ctxOverrides = {}) {
  const profile = testProfile(profileOverrides);
  const ctx = testContext(ctxOverrides, profile);
  const mock = new MockFlightSearchProvider({ now: fixedNow });
  const orchestrator = new SearchOrchestrator([mock], { now: fixedNow });
  const search = await orchestrator.run(planFromProfile(profile), { fxRatesToEur: FX, now: NOW });
  const result = runPipeline(search.itineraries, ctx);
  return { profile, ctx, search, result, mock };
}

const route = (j: ScoredJourney): string => `${j.itinerary.originAirport}-${j.itinerary.outbound.connections.map((c) => c.airport).join('-')}-${j.itinerary.arrivalGateway}`;

describe('search → normalize → filter → enrich → score → rank (mock provider)', () => {
  it('spans multiple origins and both gateways', async () => {
    const { result, search } = await runSearch();
    expect(search.failures).toEqual([]);
    expect(search.stats.searchCalls).toBeLessThanOrEqual(48);
    const origins = new Set(result.journeys.map((j) => j.itinerary.originAirport));
    const gateways = new Set(result.journeys.map((j) => j.itinerary.arrivalGateway));
    expect(origins.size).toBeGreaterThan(4);
    expect(gateways).toEqual(new Set(['KBV', 'HKT']));
  });

  it('is deterministic', async () => {
    const a = await runSearch();
    const b = await runSearch();
    expect(a.result.journeys.map((j) => [j.itinerary.id, j.overallScore])).toEqual(b.result.journeys.map((j) => [j.itinerary.id, j.overallScore]));
  });

  it('rejects the 7h Istanbul transfer before scoring and reports why', async () => {
    const { result } = await runSearch();
    const bad = result.rejected.filter((r) => r.itineraryId.includes('AMS-IST-KBV-TK-BAD'));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.reasons.some((r) => r.includes('7h05 layover at IST'))).toBe(true);
    expect(result.journeys.some((j) => j.itinerary.id.includes('AMS-IST-KBV-TK-BAD'))).toBe(false);
  });

  it('marks the Emirates itinerary as Pareto-dominated by the Qatar one', async () => {
    const { result } = await runSearch();
    const ek = result.journeys.filter((j) => j.itinerary.id.includes('DOMINATED'));
    expect(ek.length).toBeGreaterThan(0);
    expect(ek.every((j) => j.paretoDominated)).toBe(true);
    expect(result.journeys.some((j) => !j.paretoDominated)).toBe(true);
  });

  it('identifies the self-transfer, hotel and ground-transfer fixtures', async () => {
    const { result } = await runSearch();
    const self = result.journeys.find((j) => j.itinerary.id.includes('SELF'))!;
    expect(self.itinerary.selfTransfers).toBe(2);
    expect(self.categoryScores.selfTransferRisk).toBeLessThan(50);
    expect(self.itinerary.cabinSummary.mixedCabin).toBe(true);

    const fra = result.journeys.find((j) => j.itinerary.id.includes('FRA-BKK-KBV'))!;
    expect(fra.hotelOutbound.required).toBe(true);
    expect(fra.cost.hotelOutbound).toBe(DEFAULT_ORIGIN_PROFILES.find((p) => p.airportCode === 'FRA')!.hotelCost);

    const cph = result.journeys.find((j) => j.itinerary.id.includes('CPH-BKK-KBV'))!;
    expect(cph.hotelOutbound.required).toBe(true);
    expect(cph.originAccess.mode).toBe('POSITIONING_FLIGHT');

    const hkt = result.journeys.find((j) => j.itinerary.id.includes('DUS-DOH-HKT'))!;
    expect(hkt.groundTransfer.mode).toBe('PRIVATE_DRIVER');
    expect(hkt.cost.groundOutbound).toBeGreaterThan(0);
  });

  it('never shows only the airfare: true journey cost always exceeds it', async () => {
    const { result } = await runSearch();
    for (const j of result.journeys) expect(j.cost.trueJourneyCost).toBeGreaterThan(j.itinerary.fareEur);
  });

  it('sorts by overall journey score and applies labels', async () => {
    const { result } = await runSearch();
    const scores = result.journeys.map((j) => j.overallScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(result.journeys[0]!.labels).toContain('BEST_OVERALL');
    const all = result.journeys.flatMap((j) => j.labels);
    for (const l of ['CHEAPEST', 'FASTEST', 'BEST_TIMING', 'BEST_BASELINE_ORIGIN', 'BEST_ALTERNATIVE_ORIGIN']) expect(all).toContain(l);
  });

  // Same dates for every route so that the comparison isolates origin economics.
  const singleDates = { outboundEarliestDate: '2027-01-20', outboundLatestDate: '2027-01-20', returnEarliestDate: '2027-02-08', returnLatestDate: '2027-02-08', minTripDays: 19, preferredTripDaysMin: 19, preferredTripDaysMax: 19, maxTripDays: 19 };

  it('prefers the €1,420 DUS→HKT journey over the €1,190 CPH→KBV journey with default settings', async () => {
    const { result } = await runSearch(singleDates);
    const dus = result.journeys.find((j) => j.itinerary.id.includes('DUS-DOH-HKT'))!;
    const cph = result.journeys.find((j) => j.itinerary.id.includes('CPH-BKK-KBV'))!;
    expect(cph.itinerary.fareEur).toBeLessThan(dus.itinerary.fareEur);
    expect(cph.cost.hotelOutbound).toBeGreaterThan(0);
    expect(dus.totalActiveTravelBurdenMinutes).toBeLessThan(cph.totalActiveTravelBurdenMinutes);
    expect(dus.categoryScores.originInconvenience).toBeGreaterThan(cph.categoryScores.originInconvenience);
    expect(dus.overallScore).toBeGreaterThan(cph.overallScore);
  });

  it('can decide Copenhagen is worth it when the saving is large enough', async () => {
    const mock = new MockFlightSearchProvider({ now: fixedNow, templates: (await import('../src/providers/mock/templates.js')).ROUTE_TEMPLATES.map((t) => (t.id === 'CPH-BKK-KBV-TG' ? { ...t, baseFareBusiness: 700 } : t)) });
    const profile = testProfile(singleDates);
    const ctx = testContext({}, profile);
    const search = await new SearchOrchestrator([mock], { now: fixedNow }).run(planFromProfile(profile), { fxRatesToEur: FX, now: NOW });
    const result = runPipeline(search.itineraries, ctx);
    const dus = result.journeys.find((j) => j.itinerary.id.includes('DUS-DOH-HKT'))!;
    const cph = result.journeys.find((j) => j.itinerary.id.includes('CPH-BKK-KBV'))!;
    expect(cph.overallScore).toBeGreaterThan(dus.overallScore);
    expect(cph.baseline.savingPerExtraHour).not.toBeNull();
  });

  it('lets the user flip the decision by changing weights alone', async () => {
    const { result } = await runSearch(singleDates);
    const convenienceHeavy = { ...DEFAULT_WEIGHTS, trueCost: 10, fareAnomaly: 0, originInconvenience: 30, journeyTime: 30 };
    const costHeavy = { ...DEFAULT_WEIGHTS, trueCost: 80, journeyTime: 5, originInconvenience: 0, fareAnomaly: 0 };
    const find = (list: ScoredJourney[], key: string): ScoredJourney => list.find((j) => j.itinerary.id.includes(key))!;
    const a = rescoreJourneys(result.journeys, convenienceHeavy, 'AMS');
    expect(find(a, 'DUS-DOH-HKT').overallScore).toBeGreaterThan(find(a, 'CPH-BKK-KBV').overallScore);
    const b = rescoreJourneys(result.journeys, costHeavy, 'AMS');
    expect(find(b, 'CPH-BKK-KBV').overallScore).toBeGreaterThan(find(b, 'DUS-DOH-HKT').overallScore);
  });

  it('re-scores instantly with new weights without a new search', async () => {
    const { result, mock } = await runSearch();
    const callsBefore = mock.calls;
    const timeHeavy = { ...DEFAULT_WEIGHTS, trueCost: 5, journeyTime: 60 };
    const rescored = rescoreJourneys(result.journeys, timeHeavy, 'AMS');
    expect(mock.calls).toBe(callsBefore);
    expect(rescored[0]!.labels).toContain('BEST_OVERALL');
    const fastest = rescored.find((j) => j.labels.includes('FASTEST'))!;
    expect(fastest.rank).toBeLessThanOrEqual(3);
    const byId = new Map(result.journeys.map((j) => [j.itinerary.id, j]));
    for (const j of rescored) expect(j.categoryScores).toEqual(byId.get(j.itinerary.id)!.categoryScores);
  });

  it('respects the maximum-transfers constraint end to end', async () => {
    const { result } = await runSearch({ outboundConstraints: { ...testProfile().outboundConstraints, maxAirTransfers: 0 } });
    expect(result.journeys).toHaveLength(0);
    expect(result.rejected.every((r) => r.reasons.some((x) => x.includes('exceeds maximum of 0')))).toBe(true);
  });

  it('keeps results from healthy providers when another provider fails', async () => {
    const good = new MockFlightSearchProvider({ now: fixedNow });
    const broken = new MockFlightSearchProvider({ now: fixedNow, failForOrigins: ['AMS', 'DUS', 'FRA', 'CPH', 'RTM', 'BRU', 'CDG', 'MUC', 'ZRH', 'LHR'] });
    const profile = testProfile();
    const search = await new SearchOrchestrator([good, broken], { now: fixedNow }).run(planFromProfile(profile), { fxRatesToEur: FX, now: NOW });
    expect(search.failures.length).toBeGreaterThan(0);
    expect(search.itineraries.length).toBeGreaterThan(0);
    expect(search.failures[0]!.provider).toBe('mock');
    expect(search.failures[0]!.request).toBeDefined();
  });

  it('uses the cache on repeated searches', async () => {
    const mock = new MockFlightSearchProvider({ now: fixedNow });
    const orchestrator = new SearchOrchestrator([mock], { now: fixedNow });
    const plan = planFromProfile(testProfile());
    const first = await orchestrator.run(plan, { fxRatesToEur: FX, now: NOW });
    const second = await orchestrator.run(plan, { fxRatesToEur: FX, now: NOW });
    expect(first.stats.cacheHits).toBe(0);
    expect(second.stats.cacheHits).toBe(second.candidates.length);
    expect(second.stats.searchCalls).toBe(0);
  });

  it('exposes the route string for every fixture through the pipeline', async () => {
    const { result } = await runSearch();
    const routes = new Set(result.journeys.map(route));
    expect(routes.has('AMS-DOH-KBV')).toBe(true);
    expect(routes.has('DUS-DOH-HKT')).toBe(true);
    expect(routes.has('AMS-SIN-KBV')).toBe(true);
    expect(routes.has('LHR-KUL-KBV')).toBe(true);
  });
});
