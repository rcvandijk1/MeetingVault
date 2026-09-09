import { describe, expect, it } from 'vitest';
import { MockFlightSearchProvider } from '../src/providers/mock/MockFlightSearchProvider.js';
import { SearchOrchestrator } from '../src/providers/orchestrator.js';
import { runPipeline } from '../src/pipeline/index.js';
import { computeTrueCost, enrichJourney } from '../src/pipeline/enrich.js';
import { evaluateHardConstraints } from '../src/pipeline/constraints.js';
import { planFromProfile } from '../src/plan.js';
import { amsDohKbv, FX, NOW, itinerary, testContext, testProfile } from './helpers.js';

const fixedNow = () => new Date(NOW);
const singleDates = { outboundEarliestDate: '2027-01-20', outboundLatestDate: '2027-01-20', returnEarliestDate: '2027-02-08', returnLatestDate: '2027-02-08', minTripDays: 19, preferredTripDaysMin: 19, preferredTripDaysMax: 19, maxTripDays: 19 };

describe('cabin selection for all flights', () => {
  it('searches every selected cabin and scores each as its own requested cabin', async () => {
    const profile = testProfile({ ...singleDates, cabins: ['ECONOMY', 'BUSINESS'], enabledOrigins: ['AMS', 'DUS'] });
    const mock = new MockFlightSearchProvider({ now: fixedNow });
    const search = await new SearchOrchestrator([mock], { now: fixedNow }).run(planFromProfile(profile), { fxRatesToEur: FX, now: NOW });
    const cabins = new Set(search.itineraries.map((it) => it.cabinSummary.requestedCabin));
    expect(cabins).toEqual(new Set(['ECONOMY', 'BUSINESS']));
    const result = runPipeline(search.itineraries, testContext({}, profile));
    const eco = result.journeys.filter((j) => j.itinerary.cabinSummary.requestedCabin === 'ECONOMY');
    const biz = result.journeys.filter((j) => j.itinerary.cabinSummary.requestedCabin === 'BUSINESS');
    expect(eco.length).toBeGreaterThan(0);
    expect(biz.length).toBeGreaterThan(0);
    // Every economy journey is cheaper than its business twin on the same route.
    const bizAms = biz.find((j) => j.itinerary.id.includes('AMS-DOH-KBV-QR'))!;
    const ecoAms = eco.find((j) => j.itinerary.id.includes('AMS-DOH-KBV-QR'))!;
    expect(ecoAms.itinerary.fareEur).toBeLessThan(bizAms.itinerary.fareEur);
    expect(ecoAms.itinerary.segments.every((s) => s.cabin === 'ECONOMY')).toBe(true);
    // Pareto and baseline are computed within a cabin: business is not "dominated" by economy.
    expect(bizAms.paretoDominated).toBe(false);
    expect(biz.some((j) => j.baseline.isBaseline)).toBe(true);
    expect(eco.some((j) => j.baseline.isBaseline)).toBe(true);
    expect(biz.some((j) => j.labels.includes('CHEAPEST'))).toBe(true);
    expect(eco.some((j) => j.labels.includes('CHEAPEST'))).toBe(true);
  });

  it('raises feeder flights to the minimum feeder cabin', async () => {
    const mock = new MockFlightSearchProvider({ now: fixedNow });
    const base = { origin: 'AMS', destination: 'KBV', outboundDate: '2027-01-20', returnDate: '2027-02-08', passengers: 1, cabin: 'BUSINESS' as const, maxConnections: 2 };
    const eco = (await mock.search({ ...base, feederCabin: 'ECONOMY' }, { fxRatesToEur: FX, now: NOW })).find((it) => it.id.includes('SELF'))!;
    const biz = (await mock.search({ ...base, feederCabin: 'BUSINESS' }, { fxRatesToEur: FX, now: NOW })).find((it) => it.id.includes('SELF'))!;
    expect(eco.cabinSummary.lowestCabin).toBe('ECONOMY');
    expect(biz.cabinSummary.lowestCabin).toBe('BUSINESS');
    expect(biz.cabinSummary.premiumCabinPercent).toBe(100);
  });

  it('rejects feeder segments below the minimum feeder cabin as a hard constraint', () => {
    const it = itinerary({
      fare: 1250,
      out: [
        { from: 'AMS', to: 'BKK', dep: '2027-01-20T17:30', minutes: 665, carrier: 'KL' },
        { from: 'BKK', to: 'KBV', dep: '2027-01-21T14:30', minutes: 80, carrier: 'PG', cabin: 'ECONOMY' },
      ],
      ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }],
    });
    expect(evaluateHardConstraints(it, testContext({}, testProfile({ feederMinCabin: 'ECONOMY' })))).toEqual([]);
    const strict = evaluateHardConstraints(it, testContext({}, testProfile({ feederMinCabin: 'BUSINESS' })));
    expect(strict.some((r) => r.includes('below the minimum feeder cabin BUSINESS'))).toBe(true);
    // A premium-economy minimum with a business request still rejects an economy feeder.
    expect(evaluateHardConstraints(it, testContext({}, testProfile({ feederMinCabin: 'PREMIUM_ECONOMY' }))).some((r) => r.includes('minimum feeder cabin'))).toBe(true);
  });

  it('rejects itineraries whose requested cabin is not selected', () => {
    const reasons = evaluateHardConstraints(amsDohKbv(), testContext({}, testProfile({ cabins: ['ECONOMY'] })));
    expect(reasons).toContain('Cabin BUSINESS is not selected in the profile');
  });
});

describe('verified final price', () => {
  it('adds booking fees to the true journey cost once the final price is known', () => {
    const base = {
      access: { airportCode: 'AMS', mode: 'CAR' as const, travelMinutes: 45, costPerDirection: 10, parkingCost: 90, bufferMinutes: 150, inconveniencePenalty: 0 },
      hotelOutbound: { required: false, reason: '', cost: 0, restMinutes: 0 },
      hotelReturn: { required: false, reason: '', cost: 0, restMinutes: 0 },
      groundOutbound: { required: true, fromCode: 'KBV', toPlace: 'KRABI', mode: 'TAXI' as const, minutes: 35, costPerDirection: 20, inconveniencePenalty: 5 },
      groundReturn: { required: true, fromCode: 'KBV', toPlace: 'KRABI', mode: 'TAXI' as const, minutes: 35, costPerDirection: 20, inconveniencePenalty: 5 },
    };
    const unverified = computeTrueCost({ ...base, airfareEur: 1690 });
    expect(unverified.fareVerified).toBe(false);
    expect(unverified.bookingFees).toBe(0);
    const verified = computeTrueCost({ ...base, airfareEur: 1690, verifiedFareEur: 1742.5 });
    expect(verified.fareVerified).toBe(true);
    expect(verified.bookingFees).toBe(52.5);
    expect(verified.trueJourneyCost).toBe(unverified.trueJourneyCost + 52.5);
  });

  it('flows through enrichment from the itinerary', () => {
    const it = amsDohKbv({ fare: 1690 });
    const verified = { ...it, verifiedFare: { amount: 1740, currency: 'EUR', amountEur: 1740, verifiedAt: NOW, source: 'booking-flow:mock-airline', breakdown: [] } };
    const a = enrichJourney(it, testContext());
    const b = enrichJourney(verified, testContext());
    expect(b.cost.trueJourneyCost - a.cost.trueJourneyCost).toBe(50);
    expect(b.cost.airfare).toBe(1690);
  });
});
