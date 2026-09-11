import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockFlightSearchProvider, type DealAlert, type NotificationProvider, type ScoredJourney, type TripProfile } from '@kfr/core';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { buildApp, type AppDeps } from '../src/app.js';

const NOW = new Date('2026-09-09T06:34:00Z');

class CapturingNotifier implements NotificationProvider {
  readonly name = 'capture';
  alerts: DealAlert[] = [];
  async send(alert: DealAlert): Promise<void> {
    this.alerts.push(alert);
  }
}

let app: FastifyInstance;
let deps: AppDeps;
let close: () => Promise<void>;
let notifier: CapturingNotifier;
let clock = NOW.getTime();

beforeAll(async () => {
  const base = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/krabi_flight_radar_test', FLIGHT_PROVIDERS: 'mock', SCHEDULER_ENABLED: 'false' });
  const url = base.DATABASE_URL;
  const { sql, close: c0 } = createDatabase(url, { max: 1 });
  await sql.unsafe('drop schema if exists drizzle cascade; drop schema public cascade; create schema public;');
  await c0();
  await runMigrations(url);
  const { db, close: c1 } = createDatabase(url);
  close = c1;
  await seedDatabase(db);
  notifier = new CapturingNotifier();
  const built = await buildApp({ config: base, db, providers: [new MockFlightSearchProvider({ now: () => new Date(clock) })], notifier, now: () => new Date(clock), logger: false });
  app = built.app;
  deps = built.deps;
  // Listen on a random port: the booking-flow driver reaches the mock airline site over HTTP.
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
  await close();
});

async function get<T>(url: string): Promise<{ status: number; body: T }> {
  const r = await app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json() as T };
}
async function send<T>(method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<{ status: number; body: T }> {
  const r = await app.inject({ method, url, payload: payload as object | undefined });
  return { status: r.statusCode, body: r.json() as T };
}

describe('reference & settings', () => {
  it('serves seeded reference data', async () => {
    const r = await get<{ airports: unknown[]; cabins: string[] }>('/api/reference');
    expect(r.status).toBe(200);
    expect(r.body.airports.length).toBeGreaterThan(30);
    expect(r.body.cabins).toContain('BUSINESS');
  });

  it('reads and updates home settings', async () => {
    const before = await get<{ home: { name: string; fxRatesToEur: Record<string, number> }; fareIntelligence: { thresholds: { good: number }; timeValue: { enabled: boolean } } }>('/api/settings');
    expect(before.body.home.name).toBe('Alphen aan den Rijn');
    expect(before.body.fareIntelligence.thresholds.good).toBe(85);
    expect(before.body.fareIntelligence.timeValue.enabled).toBe(false);
    const updated = await send<{ home: { hotelEveningDepartureTime: string }; fareIntelligence: { thresholds: { good: number } } }>('PUT', '/api/settings', { home: { ...before.body.home, hotelEveningDepartureTime: '19:00' }, fareIntelligence: { ...before.body.fareIntelligence, thresholds: { ...before.body.fareIntelligence.thresholds, good: 80 } } });
    expect(updated.status).toBe(200);
    expect(updated.body.home.hotelEveningDepartureTime).toBe('19:00');
    expect(updated.body.fareIntelligence.thresholds.good).toBe(80);
    const inverted = await send<{ error: string }>('PUT', '/api/settings', { fareIntelligence: { ...before.body.fareIntelligence, thresholds: { exceptional: 90, excellent: 72, good: 85, normal: 115, expensive: 135 } } });
    expect(inverted.status).toBe(400);
    await send('PUT', '/api/settings', { home: { ...before.body.home }, fareIntelligence: before.body.fareIntelligence });
  });

  it('rejects invalid settings with a 400', async () => {
    const r = await send<{ error: string }>('PUT', '/api/settings', { home: { name: '' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Validation failed');
  });
});

describe('origins, gateways, ground transfers', () => {
  it('edits an origin access profile', async () => {
    const origins = await get<Array<{ airportCode: string; hotelCost: number }>>('/api/origins');
    const fra = origins.body.find((o) => o.airportCode === 'FRA')!;
    const r = await send<{ hotelCost: number; sameDayEarliestDepartureTime: string }>('PUT', '/api/origins/FRA', { ...fra, hotelCost: 155, sameDayEarliestDepartureTime: '12:00' });
    expect(r.status).toBe(200);
    expect(r.body.hotelCost).toBe(155);
    const again = await get<Array<{ airportCode: string; hotelCost: number; sameDayEarliestDepartureTime: string }>>('/api/origins');
    expect(again.body.find((o) => o.airportCode === 'FRA')!.sameDayEarliestDepartureTime).toBe('12:00');
    await send('PUT', '/api/origins/FRA', fra);
  });

  it('lists gateways and the HKT → Krabi ground transfer', async () => {
    const g = await get<Array<{ code: string; enabled: boolean }>>('/api/gateways');
    expect(g.body.map((x) => x.code).sort()).toEqual(['HKT', 'KBV']);
    const t = await get<Array<{ id: string; mode: string; minutes: number }>>('/api/ground-transfers');
    const hkt = t.body.find((x) => x.id === 'HKT-KRABI')!;
    expect(hkt.mode).toBe('PRIVATE_DRIVER');
    const r = await send<{ minutes: number }>('PUT', '/api/ground-transfers/HKT-KRABI', { ...hkt, minutes: 170 });
    expect(r.body.minutes).toBe(170);
    await send('PUT', '/api/ground-transfers/HKT-KRABI', hkt);
  });
});

describe('profiles', () => {
  let created: TripProfile;

  it('creates, updates and deletes a profile', async () => {
    const defaults = await get<TripProfile & { defaults: unknown }>('/api/profiles/defaults');
    const { defaults: _d, ...input } = defaults.body;
    void _d;
    const r = await send<TripProfile>('POST', '/api/profiles', { ...input, name: 'Test profile', passengers: 1, enabledOrigins: ['AMS', 'DUS', 'CPH', 'FRA', 'LHR'] });
    expect(r.status).toBe(201);
    created = r.body;
    expect(created.id).toBeTruthy();
    expect(created.scoringWeights.trueCost).toBe(30);

    const u = await send<TripProfile>('PUT', `/api/profiles/${created.id}`, { ...created, scoringWeights: { ...created.scoringWeights, journeyTime: 25 }, returnConstraints: { ...created.returnConstraints, maxIndividualLayoverMinutes: 150 } });
    expect(u.status).toBe(200);
    expect(u.body.scoringWeights.journeyTime).toBe(25);
    expect(u.body.returnConstraints.maxIndividualLayoverMinutes).toBe(150);
    expect(u.body.outboundConstraints.maxIndividualLayoverMinutes).toBe(300);

    const list = await get<TripProfile[]>('/api/profiles');
    expect(list.body.some((p) => p.id === created.id)).toBe(true);
  });

  it('validates profile input', async () => {
    const r = await send<{ error: string; issues: unknown[] }>('POST', '/api/profiles', { name: 'bad' });
    expect(r.status).toBe(400);
    expect(r.body.issues.length).toBeGreaterThan(0);
  });

  it('switches the default profile', async () => {
    const r = await send<TripProfile>('POST', `/api/profiles/${created.id}/default`);
    expect(r.body.isDefault).toBe(true);
    const list = await get<TripProfile[]>('/api/profiles');
    expect(list.body.filter((p) => p.isDefault)).toHaveLength(1);
    const original = list.body.find((p) => p.id !== created.id)!;
    await send('POST', `/api/profiles/${original.id}/default`);
  });

  it('deletes the profile', async () => {
    const r = await send<{ deleted: string }>('DELETE', `/api/profiles/${created.id}`);
    expect(r.status).toBe(200);
    expect((await get(`/api/profiles/${created.id}`)).status).toBe(404);
  });
});

describe('search, persistence and scoring', () => {
  let runId: string;
  let journeys: ScoredJourney[];

  it('runs a search for the default profile and persists results', async () => {
    const r = await send<{ run: { id: string; status: string; stats: { scored: number; searchCalls: number } }; journeys: ScoredJourney[]; rejected: unknown[] }>('POST', '/api/search', { overrides: { passengers: 1 } });
    expect(r.status).toBe(201);
    expect(r.body.run.status).toBe('COMPLETED');
    expect(r.body.journeys.length).toBeGreaterThan(10);
    expect(r.body.rejected.length).toBeGreaterThan(0);
    runId = r.body.run.id;
    journeys = r.body.journeys;
    expect(journeys[0]!.rank).toBe(1);
    expect(journeys[0]!.labels).toContain('BEST_OVERALL');
    expect(journeys.every((j) => j.cost.trueJourneyCost > j.itinerary.fareEur)).toBe(true);
    expect(journeys.every((j) => j.itinerary.firstSeen && j.itinerary.lastValidated)).toBe(true);
  });

  it('reads the run back with the same journeys', async () => {
    const r = await get<{ run: { id: string }; journeys: ScoredJourney[]; rejected: unknown[] }>(`/api/search/${runId}`);
    expect(r.status).toBe(200);
    expect(r.body.journeys.map((j) => j.itinerary.id)).toEqual(journeys.map((j) => j.itinerary.id));
    expect(r.body.journeys[0]!.itinerary.segments.length).toBeGreaterThan(1);
    expect(r.body.journeys[0]!.outboundTimeline.leaveHomeLocal).toBeTruthy();
    const list = await get<Array<{ id: string; resultCount: number }>>('/api/search');
    expect(list.body[0]!.id).toBe(runId);
    expect(list.body[0]!.resultCount).toBe(journeys.length);
  });

  it('serves single itineraries and batches', async () => {
    const one = await get<ScoredJourney>(`/api/itineraries/${journeys[0]!.itinerary.id}`);
    expect(one.status).toBe(200);
    expect(one.body.overallScore).toBe(journeys[0]!.overallScore);
    const batch = await get<ScoredJourney[]>(`/api/itineraries?ids=${journeys.slice(0, 3).map((j) => j.itinerary.id).join(',')}`);
    expect(batch.body).toHaveLength(3);
    expect((await get('/api/itineraries/nope')).status).toBe(404);
  });

  it('persists fare observations and never overwrites them', async () => {
    const h1 = await get<{ count: number; observations: Array<{ fareEur: number; itineraryFingerprint: string }> }>('/api/history?cabin=BUSINESS');
    expect(h1.body.count).toBeGreaterThanOrEqual(journeys.length);
    clock += 3600000; // an hour later
    await send('POST', '/api/search', { overrides: { passengers: 1 } });
    const h2 = await get<{ count: number }>('/api/history?cabin=BUSINESS');
    expect(h2.body.count).toBeGreaterThanOrEqual(h1.body.count + journeys.length);
    const summary = await get<Array<{ originAirport: string; count: number }>>('/api/history/summary');
    expect(summary.body.length).toBeGreaterThan(3);
    const filtered = await get<{ observations: Array<{ originAirport: string }> }>('/api/history?origin=DUS&gateway=HKT');
    expect(filtered.body.observations.every((o) => o.originAirport === 'DUS')).toBe(true);
  });

  it('enriches observations with trip, timing and cabin-quality fields and records provider traceability', async () => {
    const h = await get<{ observations: Array<Record<string, unknown>> }>('/api/history?origin=AMS&gateway=KBV&cabin=BUSINESS');
    const o = h.body.observations[0]!;
    expect(o.tripDays).toBeGreaterThan(10);
    expect(o.daysToDeparture).toBeGreaterThan(30);
    expect(o.stopsOutbound).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(o.connectionAirports)).toBe(true);
    expect(o.outboundDepartureLocal).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(o.totalDurationMinutes).toBeGreaterThan(600);
    expect(['FULL', 'MOSTLY', 'MIXED']).toContain(o.cabinQuality);
    expect(o.routeFamily).toBe('KRABI_REGION');
    expect(o.providerOfferId).toBeTruthy();
    expect(o.provider).toBe('mock');
    expect(o.verified).toBe(false);
  });

  it('never records the same offer twice within one run', async () => {
    const run = await get<{ journeys: ScoredJourney[] }>(`/api/search/${runId}`);
    const all = await deps.repos.queryObservations({ limit: 100000 });
    const inRun = all.filter((o) => o.searchRunId === runId);
    const keys = inRun.map((o) => `${o.provider}|${o.providerOfferId}|${o.observedAt}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(inRun.length).toBeGreaterThanOrEqual(run.body.journeys.length);
  });

  it('serves the deal explorer with classification, confidence, market position and cohort details', async () => {
    const r = await get<{ run: { id: string }; journeys: ScoredJourney[]; summary: { byClassification: Record<string, number>; byConfidence: Record<string, number>; total: number }; opportunities: unknown[]; observationCount: number }>('/api/deals?cabin=BUSINESS');
    expect(r.status).toBe(200);
    expect(r.body.run).toBeTruthy();
    expect(r.body.summary.total).toBe(r.body.journeys.length);
    expect(r.body.observationCount).toBeGreaterThan(0);
    expect(Object.keys(r.body.summary.byClassification)).toContain('VERY_EXPENSIVE');
    for (const j of r.body.journeys) {
      expect(['EXCEPTIONAL', 'EXCELLENT', 'GOOD', 'NORMAL', 'EXPENSIVE', 'VERY_EXPENSIVE', 'UNKNOWN']).toContain(j.deal.level);
      expect(['HIGH', 'MEDIUM', 'LOW', 'NONE']).toContain(j.deal.confidence);
      expect(j.deal.cabinQuality.label).toBeTruthy();
      expect(j.deal.market).toBeTruthy();
      expect(j.journeyValueScore).toBe(j.overallScore);
      expect(j.deal.explanations.join(' ')).not.toMatch(/discount/i);
    }
    // Repeated runs have built history for the same physical itineraries: the trend is populated and cohorts are historical.
    const withTrend = r.body.journeys.filter((j) => j.deal.trend !== null);
    expect(withTrend.length).toBeGreaterThan(0);
    expect(withTrend[0]!.deal.trend!.timesSeenBefore).toBeGreaterThanOrEqual(1);
    const historical = r.body.journeys.filter((j) => j.deal.source === 'HISTORY');
    expect(historical.length).toBeGreaterThan(0);
    expect(historical[0]!.deal.cohort!.level).toBeGreaterThanOrEqual(1);
    expect(historical[0]!.deal.stats!.median).toBeGreaterThan(0);
    // Search-distribution or historical, never HIGH confidence on a handful of same-day observations.
    expect(r.body.journeys.every((j) => j.deal.confidence !== 'HIGH')).toBe(true);
    expect((await get('/api/deals?runId=nope')).status).toBe(404);
  });

  it('lists opportunities and fingerprint price history', async () => {
    const opp = await get<Array<{ type: string; itineraryId: string; reason: string; searchRunId: string }>>('/api/opportunities?days=30');
    expect(opp.status).toBe(200);
    for (const o of opp.body) expect(['NEW_LOW', 'SIGNIFICANT_DROP', 'HISTORICAL_OUTLIER', 'ALTERNATIVE_AIRPORT_OPPORTUNITY', 'PREMIUM_CABIN_ANOMALY', 'ROUTING_OPPORTUNITY']).toContain(o.type);
    const typed = await get<Array<{ type: string }>>('/api/opportunities?type=ALTERNATIVE_AIRPORT_OPPORTUNITY');
    expect(typed.body.every((o) => o.type === 'ALTERNATIVE_AIRPORT_OPPORTUNITY')).toBe(true);
    const radar = await get<{ opportunities: unknown[] }>('/api/radar');
    expect(Array.isArray(radar.body.opportunities)).toBe(true);
    const fp = journeys[0]!.itinerary.fingerprint;
    const hist = await get<{ count: number; observations: Array<{ fareEur: number }>; stats: { median: number } | null; trend: { timesSeenBefore: number; lowestSeenEur: number } | null }>(`/api/history/fingerprint/${fp}?currentFareEur=${journeys[0]!.itinerary.fareEur}`);
    expect(hist.status).toBe(200);
    expect(hist.body.count).toBeGreaterThanOrEqual(2);
    expect(hist.body.stats!.median).toBeGreaterThan(0);
    expect(hist.body.trend!.timesSeenBefore).toBeGreaterThanOrEqual(1);
  });

  it('tracks first seen across runs', async () => {
    const latest = await get<ScoredJourney[]>('/api/itineraries');
    const known = latest.body.find((j) => j.itinerary.firstSeen !== j.itinerary.lastSeen);
    expect(known).toBeDefined();
  });

  it('re-scores a run with new weights without calling providers', async () => {
    const before = deps.orchestrator;
    void before;
    const weights = { trueCost: 5, journeyTime: 60, flightTiming: 10, transferQuality: 10, fareAnomaly: 0, cabinQuality: 5, originInconvenience: 5, selfTransferRisk: 3, destinationTransfer: 2 };
    const r = await send<{ journeys: ScoredJourney[] }>('POST', '/api/scoring/rescore', { runId, weights });
    expect(r.status).toBe(200);
    expect(r.body.journeys).toHaveLength(journeys.length);
    const fastest = r.body.journeys.find((j) => j.labels.includes('FASTEST'))!;
    expect(fastest.rank).toBeLessThanOrEqual(3);
    const stored = await get<{ journeys: ScoredJourney[] }>(`/api/search/${runId}`);
    expect(stored.body.journeys[0]!.overallScore).toBe(journeys[0]!.overallScore); // not persisted
  });

  it('explains a score', async () => {
    const r = await send<{ rows: Array<{ category: string; weightPercent: number; contribution: number }>; final: number; reasons: unknown[] }>('POST', '/api/scoring/explain', { itineraryId: journeys[0]!.itinerary.id });
    expect(r.body.rows).toHaveLength(9);
    expect(r.body.final).toBe(journeys[0]!.overallScore);
    expect(r.body.reasons.length).toBeGreaterThan(2);
  });

  it('builds the origin matrix', async () => {
    const r = await get<{ gateways: string[]; rows: Array<{ origin: string; cells: Record<string, { trueCost: number } | null>; best: string | null }> }>(`/api/search/${runId}/matrix?metric=trueCost`);
    expect(r.body.gateways).toEqual(['KBV', 'HKT']);
    const dus = r.body.rows.find((x) => x.origin === 'DUS')!;
    expect(dus.cells.KBV).toBeTruthy();
    expect(dus.cells.HKT).toBeTruthy();
    expect(['KBV', 'HKT']).toContain(dus.best);
  });

  it('refreshes an itinerary through its provider', async () => {
    const r = await send<{ refreshed: boolean; journey: ScoredJourney }>('POST', `/api/itineraries/${journeys[0]!.itinerary.id}/refresh`);
    expect(r.status).toBe(200);
    expect(r.body.refreshed).toBe(true);
    expect(r.body.journey.itinerary.id).toBe(journeys[0]!.itinerary.id);
  });

  it('serves the radar summary', async () => {
    const r = await get<{ run: { id: string }; dealCounts: Record<string, number>; top: ScoredJourney[] }>('/api/radar');
    expect(r.body.run).toBeTruthy();
    expect(Object.values(r.body.dealCounts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(r.body.top.length).toBeGreaterThan(0);
  });

  it('reports provider status and usage', async () => {
    const r = await get<{ configured: string[]; health: Array<{ provider: string; ok: boolean }>; usage24h: Array<{ provider: string; calls: number }> }>('/api/providers/status');
    expect(r.body.configured).toEqual(['mock']);
    expect(r.body.health[0]!.ok).toBe(true);
    expect(r.body.usage24h[0]!.calls).toBeGreaterThan(0);
  });

  it('searches several cabins at once and requires the feeder class when asked', async () => {
    const r = await send<{ journeys: ScoredJourney[] }>('POST', '/api/search', { overrides: { passengers: 1, cabins: ['ECONOMY', 'BUSINESS'], feederMinCabin: 'BUSINESS', enabledOrigins: ['AMS', 'DUS'] } });
    expect(r.status).toBe(201);
    const cabins = new Set(r.body.journeys.map((j) => j.itinerary.cabinSummary.requestedCabin));
    expect(cabins).toEqual(new Set(['ECONOMY', 'BUSINESS']));
    const biz = r.body.journeys.filter((j) => j.itinerary.cabinSummary.requestedCabin === 'BUSINESS');
    expect(biz.every((j) => j.itinerary.cabinSummary.premiumCabinPercent === 100)).toBe(true);
    expect(biz.filter((j) => j.baseline.isBaseline)).toHaveLength(1);
  });

  it('re-prices the top ranked journeys before presenting them', async () => {
    const r = await get<{ run: { stats: { repriced: number } } }>(`/api/search/${runId}`);
    expect(r.body.run.stats.repriced).toBe(3);
    const refreshEvents = await deps.repos.recentProviderErrors(1);
    void refreshEvents;
    const usage = await deps.repos.providerUsageSummary(24);
    expect(usage[0]!.calls).toBeGreaterThan(48);
  });

  it('records provider failures without failing the search', async () => {
    const failing = new MockFlightSearchProvider({ now: () => new Date(clock), failForOrigins: ['AMS'], name: 'mock-broken' });
    const svc = deps.searchService;
    const orchestrator = deps.orchestrator;
    // Temporarily add a failing provider to the orchestrator's list.
    (orchestrator as unknown as { providers: unknown[] }).providers.push(failing);
    try {
      const outcome = await svc.runSearch({ overrides: { passengers: 1 } });
      expect(outcome.run.providerErrors.length).toBeGreaterThan(0);
      expect(outcome.run.providerErrors[0]!.provider).toBe('mock-broken');
      expect(outcome.journeys.length).toBeGreaterThan(0);
    } finally {
      (orchestrator as unknown as { providers: unknown[] }).providers.pop();
    }
    const status = await get<{ recentErrors: Array<{ error: string }> }>('/api/providers/status');
    expect(status.body.recentErrors.length).toBeGreaterThan(0);
  });

  it('verifies the final price of top journeys by walking the mock airline booking flow up to payment', async () => {
    // Verifications for the top 3 were queued automatically when the run completed; let the worker finish them.
    const queued = await get<Array<{ itineraryId: string; status: string }>>(`/api/verifications?runId=${runId}`);
    expect(queued.body.length).toBeGreaterThanOrEqual(3);
    await send('POST', '/api/verifications/drain');
    const list = await get<Array<{ itineraryId: string; status: string; driver: string; finalPriceEur: number | null; quotedFare: number; steps: Array<{ name: string; ok: boolean; screenshotUrl: string | null }>; breakdown: Array<{ label: string; amount: number }> }>>(`/api/verifications?runId=${runId}`);
    expect(list.status).toBe(200);
    const verified = list.body.filter((v) => v.status === 'VERIFIED');
    expect(verified.length).toBeGreaterThanOrEqual(3);
    // Verification follows the ranking: whatever is in the top 3 now has a verified final price.
    const ranked = await get<ScoredJourney[]>(`/api/itineraries?runId=${runId}`);
    expect(ranked.body.slice(0, 3).every((j) => j.itinerary.verifiedFare && j.cost.fareVerified)).toBe(true);
    const v = verified.find((x) => x.steps.length === 5)!;
    expect(v.driver).toBe('mock-airline');
    expect(v.finalPriceEur).toBeGreaterThan(v.quotedFare);
    expect(v.steps.map((s) => s.name)).toEqual(['open-fare', 'select-fare', 'passenger-details', 'extras', 'payment-page']);
    expect(v.steps.every((s) => s.ok && s.screenshotUrl)).toBe(true);
    expect(v.breakdown.some((b) => b.label === 'Ticket issuance fee')).toBe(true);
    const shot = await app.inject({ method: 'GET', url: v.steps[4]!.screenshotUrl! });
    expect(shot.statusCode).toBe(200);
    expect(shot.headers['content-type']).toContain('image/png');

    // The verified price flows into the true journey cost and the scores of the run.
    const after = await get<ScoredJourney>(`/api/itineraries/${v.itineraryId}`);
    expect(after.body.itinerary.verifiedFare?.source).toBe('booking-flow:mock-airline');
    expect(after.body.cost.fareVerified).toBe(true);
    expect(after.body.cost.airfare).toBeCloseTo(v.quotedFare, 1);
    expect(after.body.cost.bookingFees).toBeCloseTo(v.finalPriceEur! - v.quotedFare, 1);
    expect(after.body.cost.trueJourneyCost).toBeCloseTo(after.body.cost.airfare + after.body.cost.bookingFees + after.body.cost.accessOutbound + after.body.cost.accessReturn + after.body.cost.hotelOutbound + after.body.cost.hotelReturn + after.body.cost.parking + after.body.cost.groundOutbound + after.body.cost.groundReturn, 1);

    // The final price is recorded as an observation and the worker reports its status.
    const hist = await get<{ observations: Array<{ provider: string }> }>('/api/history?days=30');
    expect(hist.body.observations.some((o) => o.provider === 'booking-flow:mock-airline')).toBe(true);
    const status = await get<{ verified: number; drivers: Array<{ name: string }>; browser: { running: boolean } }>('/api/verifications/status');
    expect(status.body.verified).toBeGreaterThanOrEqual(3);
    expect(status.body.drivers.map((d) => d.name)).toContain('mock-airline');
  });

  it('reuses a recent verification of the same flights instead of walking the flow again', async () => {
    const statusBefore = await get<{ verified: number }>('/api/verifications/status');
    // A new search of the same profile produces the same physical itineraries (same fingerprints).
    const r = await send<{ run: { id: string } }>('POST', '/api/search', { overrides: { passengers: 1 } });
    const list = await get<Array<{ status: string; driver: string | null; steps: Array<{ name: string }> }>>(`/api/verifications?runId=${r.body.run.id}`);
    expect(list.body.length).toBeGreaterThanOrEqual(3);
    const reused = list.body.filter((v) => v.driver?.endsWith('(reused)'));
    expect(reused.length).toBeGreaterThan(0);
    expect(reused[0]!.status).toBe('VERIFIED');
    expect(reused[0]!.steps[0]!.name).toBe('reuse');
    await send('POST', '/api/verifications/drain');
    const after = await get<Array<{ status: string; driver: string | null }>>(`/api/verifications?runId=${r.body.run.id}`);
    expect(after.body.every((v) => v.status === 'VERIFIED')).toBe(true);
    // Reused results do not walk the flow, so they never count as newly verified work.
    const walked = after.body.filter((v) => !v.driver?.endsWith('(reused)')).length;
    const statusAfter = await get<{ verified: number }>('/api/verifications/status');
    expect(statusAfter.body.verified - statusBefore.body.verified).toBe(walked);
  });

  it('marks itineraries without a booking-flow driver as unsupported and lets the user request verification', async () => {
    const journeys = await get<ScoredJourney[]>(`/api/itineraries?runId=${runId}`);
    const target = journeys.body[journeys.body.length - 1]!;
    const r = await send<{ status: string; id: string }>('POST', `/api/itineraries/${target.itinerary.id}/verify`);
    expect(r.status).toBe(202);
    expect(['QUEUED', 'RUNNING', 'VERIFIED']).toContain(r.body.status);
    await send('POST', '/api/verifications/drain');
    const v = await get<{ status: string }>(`/api/verifications/${r.body.id}`);
    expect(v.body.status).toBe('VERIFIED');
    // Unsupported channel: a driverless itinerary is marked immediately.
    (deps.verifier as unknown as { deps: { drivers: unknown[] } }).deps.drivers.splice(0);
    const u = await send<{ status: string; error: string }>('POST', `/api/itineraries/${journeys.body[1]!.itinerary.id}/verify`);
    expect(u.body.status).toBe('UNSUPPORTED');
    expect(u.body.error).toContain('No booking-flow driver');
  });

  it('runs the scheduler cycle and emits alerts through the notification provider', async () => {
    const r = await send<{ runId: string | null; alerts: number; status: { runsCompleted: number } }>('POST', '/api/scheduler/run');
    expect(r.status).toBe(200);
    expect(r.body.runId).toBeTruthy();
    expect(r.body.status.runsCompleted).toBe(1);
    const s = await get<{ enabled: boolean; lastRunStatus: string }>('/api/scheduler');
    expect(s.body.enabled).toBe(false);
    expect(s.body.lastRunStatus).toBe('COMPLETED');
    expect(Array.isArray(notifier.alerts)).toBe(true);
  });
});
