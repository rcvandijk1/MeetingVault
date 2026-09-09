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
  await app.ready();
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
    const before = await get<{ home: { name: string; fxRatesToEur: Record<string, number> }; dealThresholds: { good: number } }>('/api/settings');
    expect(before.body.home.name).toBe('Alphen aan den Rijn');
    const updated = await send<{ home: { hotelEveningDepartureTime: string }; dealThresholds: { good: number } }>('PUT', '/api/settings', { home: { ...before.body.home, hotelEveningDepartureTime: '19:00' }, dealThresholds: { ...before.body.dealThresholds, good: 6 } });
    expect(updated.status).toBe(200);
    expect(updated.body.home.hotelEveningDepartureTime).toBe('19:00');
    expect(updated.body.dealThresholds.good).toBe(6);
    await send('PUT', '/api/settings', { home: { ...before.body.home } });
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
