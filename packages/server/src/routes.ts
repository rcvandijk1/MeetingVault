import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AIRLINE_NAMES,
  CABINS,
  ACCESS_MODES,
  GROUND_MODES,
  DEAL_LEVELS,
  DEAL_LEVEL_LABELS,
  FARE_CONFIDENCES,
  CABIN_QUALITY_LABELS,
  FARE_OPPORTUNITY_TYPES,
  KRABI_REGION_OBJECTIVE,
  DEFAULT_FARE_INTELLIGENCE,
  fareTrend,
  robustStats,
  SCORE_CATEGORIES,
  SCORE_CATEGORY_LABELS,
  DEFAULT_WEIGHTS,
  DEFAULT_SCORING_PARAMS,
  DEFAULT_TIME_PREFERENCES,
  DEFAULT_OUTBOUND_CONSTRAINTS,
  DEFAULT_RETURN_CONSTRAINTS,
  DEFAULT_SELF_TRANSFER_POLICY,
  buildDefaultProfile,
  buildOriginMatrix,
  explainScore,
  emptyDealCounts,
  alertChannelFor,
  airportSchema,
  originAccessProfileSchema,
  destinationGatewaySchema,
  groundTransferSchema,
  homeSettingsSchema,
  fareIntelligenceConfigSchema,
  alertThresholdsSchema,
  tripProfileInputSchema,
  tripProfileBaseSchema,
  scoreWeightsSchema,
  type MatrixMetric,
} from '@kfr/core';
import type { AppDeps } from './app.js';

const idParam = z.object({ id: z.string().min(1) });
const codeParam = z.object({ code: z.string().length(3) });

export function registerRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { repos, searchService, scheduler, orchestrator, config } = deps;

  app.get('/api/health', async () => ({ ok: true, name: 'Krabi Flight Radar', time: new Date().toISOString() }));

  // ------------------------------------------------------------ reference
  app.get('/api/reference', async () => ({
    airports: await repos.listAirports(),
    airlines: AIRLINE_NAMES,
    cabins: CABINS,
    accessModes: ACCESS_MODES,
    groundModes: GROUND_MODES,
    dealLevels: DEAL_LEVELS,
    dealLevelLabels: DEAL_LEVEL_LABELS,
    confidences: FARE_CONFIDENCES,
    cabinQualities: CABIN_QUALITY_LABELS,
    opportunityTypes: FARE_OPPORTUNITY_TYPES,
    objective: KRABI_REGION_OBJECTIVE,
    scoreCategories: SCORE_CATEGORIES.map((c) => ({ key: c, label: SCORE_CATEGORY_LABELS[c] })),
  }));

  app.put('/api/airports/:code', async (req) => {
    const { code } = codeParam.parse(req.params);
    const body = airportSchema.parse({ ...(req.body as object), code });
    return repos.upsertAirport(body);
  });

  // ------------------------------------------------------------- settings
  app.get('/api/settings', async () => repos.getSettings());
  app.put('/api/settings', async (req) => {
    const body = z.object({ home: homeSettingsSchema.optional(), fareIntelligence: fareIntelligenceConfigSchema.optional(), alertThresholds: alertThresholdsSchema.optional() }).parse(req.body);
    return repos.updateSettings(body);
  });
  app.get('/api/settings/fare-intelligence/defaults', async () => DEFAULT_FARE_INTELLIGENCE);

  // -------------------------------------------------------------- origins
  app.get('/api/origins', async () => repos.listOrigins());
  app.put('/api/origins/:code', async (req) => {
    const { code } = codeParam.parse(req.params);
    const body = originAccessProfileSchema.parse({ ...(req.body as object), airportCode: code });
    return repos.upsertOrigin(body);
  });
  app.delete('/api/origins/:code', async (req, reply) => {
    const { code } = codeParam.parse(req.params);
    const ok = await repos.deleteOrigin(code);
    return ok ? { deleted: code } : reply.code(404).send({ error: 'Not found' });
  });

  // ------------------------------------------------------------- gateways
  app.get('/api/gateways', async () => repos.listGateways());
  app.put('/api/gateways/:code', async (req) => {
    const { code } = codeParam.parse(req.params);
    return repos.upsertGateway(destinationGatewaySchema.parse({ ...(req.body as object), code }));
  });

  // ----------------------------------------------------- ground transfers
  app.get('/api/ground-transfers', async () => repos.listGroundTransfers());
  app.put('/api/ground-transfers/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return repos.upsertGroundTransfer(groundTransferSchema.parse({ ...(req.body as object), id }));
  });
  app.delete('/api/ground-transfers/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const ok = await repos.deleteGroundTransfer(id);
    return ok ? { deleted: id } : reply.code(404).send({ error: 'Not found' });
  });

  // ------------------------------------------------------------- profiles
  app.get('/api/profiles', async () => repos.listProfiles());
  app.get('/api/profiles/defaults', async () => {
    const { id: _id, ...rest } = buildDefaultProfile();
    void _id;
    return {
      ...rest,
      name: 'New profile',
      isDefault: false,
      defaults: {
        weights: DEFAULT_WEIGHTS,
        scoringParams: DEFAULT_SCORING_PARAMS,
        timePreferences: DEFAULT_TIME_PREFERENCES,
        outboundConstraints: DEFAULT_OUTBOUND_CONSTRAINTS,
        returnConstraints: DEFAULT_RETURN_CONSTRAINTS,
        selfTransferPolicy: DEFAULT_SELF_TRANSFER_POLICY,
      },
    };
  });
  app.post('/api/profiles', async (req, reply) => {
    const body = tripProfileInputSchema.parse(req.body);
    const created = await repos.createProfile(body);
    return reply.code(201).send(created);
  });
  app.get('/api/profiles/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await repos.getProfile(id);
    return p ?? reply.code(404).send({ error: 'Profile not found' });
  });
  app.put('/api/profiles/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = tripProfileInputSchema.parse(req.body);
    const p = await repos.updateProfile(id, body);
    return p ?? reply.code(404).send({ error: 'Profile not found' });
  });
  app.post('/api/profiles/:id/default', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await repos.setDefaultProfile(id);
    return p ?? reply.code(404).send({ error: 'Profile not found' });
  });
  app.delete('/api/profiles/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const ok = await repos.deleteProfile(id);
    return ok ? { deleted: id } : reply.code(404).send({ error: 'Profile not found' });
  });

  // ------------------------------------------------------- time prefs etc.
  app.get('/api/time-preferences/defaults', async () => DEFAULT_TIME_PREFERENCES);
  app.get('/api/scoring/defaults', async () => ({ weights: DEFAULT_WEIGHTS, params: DEFAULT_SCORING_PARAMS, categories: SCORE_CATEGORIES.map((c) => ({ key: c, label: SCORE_CATEGORY_LABELS[c] })) }));

  app.post('/api/scoring/rescore', async (req) => {
    const body = z.object({ runId: z.string().min(1), weights: scoreWeightsSchema, persist: z.boolean().default(false) }).parse(req.body);
    const journeys = await searchService.rescoreRun(body.runId, body.weights, body.persist);
    return { runId: body.runId, weights: body.weights, journeys };
  });

  app.post('/api/scoring/explain', async (req) => {
    const body = z.object({ itineraryId: z.string().min(1), weights: scoreWeightsSchema.optional() }).parse(req.body);
    const j = await repos.getJourney(body.itineraryId);
    if (!j) throw Object.assign(new Error('Itinerary not found'), { statusCode: 404 });
    const weights = body.weights ?? (await repos.getDefaultProfile())?.scoringWeights ?? DEFAULT_WEIGHTS;
    return { itineraryId: j.itinerary.id, ...explainScore(j.categoryScores, weights), reasons: j.reasons };
  });

  // --------------------------------------------------------------- search
  app.post('/api/search', async (req, reply) => {
    const body = z
      .object({
        profileId: z.string().optional(),
        overrides: tripProfileBaseSchema.partial().optional(),
        trigger: z.string().max(16).optional(),
      })
      .parse(req.body ?? {});
    const outcome = await searchService.runSearch({ profileId: body.profileId, overrides: body.overrides, trigger: body.trigger ?? 'MANUAL' });
    return reply.code(201).send({ run: outcome.run, journeys: outcome.journeys, stats: outcome.result.stats, rejected: outcome.result.rejected });
  });

  app.get('/api/search', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(25), profileId: z.string().optional() }).parse(req.query);
    return repos.listRuns(q.limit, q.profileId);
  });

  app.get('/api/search/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const run = await repos.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Search run not found' });
    const journeys = await repos.getRunJourneys(id);
    return { run, journeys, rejected: run.rejected };
  });

  app.get('/api/search/:id/matrix', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const q = z.object({ metric: z.enum(['airfare', 'trueCost', 'score', 'doorToDoor']).default('trueCost') }).parse(req.query);
    const run = await repos.getRun(id);
    if (!run) return reply.code(404).send({ error: 'Search run not found' });
    const journeys = await repos.getRunJourneys(id);
    return buildOriginMatrix(journeys, q.metric as MatrixMetric, run.profileSnapshot.enabledArrivalGateways);
  });

  // ---------------------------------------------------------- itineraries
  app.get('/api/itineraries', async (req) => {
    const q = z.object({ runId: z.string().optional(), ids: z.string().optional() }).parse(req.query);
    if (q.ids) return repos.getJourneys(q.ids.split(',').filter(Boolean));
    if (q.runId) return repos.getRunJourneys(q.runId);
    const latest = await repos.latestCompletedRun();
    return latest ? repos.getRunJourneys(latest.id) : [];
  });
  app.get('/api/itineraries/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const j = await repos.getJourney(id);
    return j ?? reply.code(404).send({ error: 'Itinerary not found' });
  });
  app.post('/api/itineraries/:id/refresh', async (req) => {
    const { id } = idParam.parse(req.params);
    return searchService.refreshItinerary(id);
  });

  // ---------------------------------------------------------------- radar
  app.get('/api/radar', async (req) => {
    const q = z.object({ profileId: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(12) }).parse(req.query);
    const profile = q.profileId ? await repos.getProfile(q.profileId) : await repos.getDefaultProfile();
    const run = await repos.latestCompletedRun(profile?.id);
    const settings = await repos.getSettings();
    if (!run) return { profile, run: null, dealCounts: emptyDealCounts(), alertCounts: {}, top: [], journeys: [], opportunities: [] };
    const journeys = await repos.getRunJourneys(run.id);
    const dealCounts = emptyDealCounts() as Record<string, number>;
    const alertCounts: Record<string, number> = {};
    for (const j of journeys) {
      dealCounts[j.deal.level] = (dealCounts[j.deal.level] ?? 0) + 1;
      const ch = alertChannelFor(j.overallScore, settings.alertThresholds);
      alertCounts[ch] = (alertCounts[ch] ?? 0) + 1;
    }
    const opportunities = await repos.listOpportunities({ runId: run.id, limit: 50 });
    return { profile, run, dealCounts, alertCounts, top: journeys.slice(0, q.limit), journeys, opportunities };
  });

  // ---------------------------------------------------------------- deals
  /**
   * Deal explorer: the journeys of a run (latest completed by default) with
   * classification / confidence summaries. Filtering and sorting are cheap on
   * the client, so the endpoint returns the full set plus the run's opportunities.
   */
  app.get('/api/deals', async (req, reply) => {
    const q = z.object({ runId: z.string().optional(), profileId: z.string().optional(), cabin: z.string().optional() }).parse(req.query);
    const run = q.runId ? await repos.getRun(q.runId) : await repos.latestCompletedRun(q.profileId);
    if (q.runId && !run) return reply.code(404).send({ error: 'Search run not found' });
    if (!run) return { run: null, journeys: [], summary: { byClassification: emptyDealCounts(), byConfidence: {}, byCabinQuality: {}, total: 0 }, opportunities: [], observationCount: await repos.countObservations() };
    const all = await repos.getRunJourneys(run.id);
    const journeys = q.cabin ? all.filter((j) => j.itinerary.cabinSummary.requestedCabin === q.cabin) : all;
    const byClassification = emptyDealCounts() as Record<string, number>;
    const byConfidence: Record<string, number> = {};
    const byCabinQuality: Record<string, number> = {};
    for (const j of journeys) {
      byClassification[j.deal.level] = (byClassification[j.deal.level] ?? 0) + 1;
      byConfidence[j.deal.confidence] = (byConfidence[j.deal.confidence] ?? 0) + 1;
      byCabinQuality[j.deal.cabinQuality.label] = (byCabinQuality[j.deal.cabinQuality.label] ?? 0) + 1;
    }
    const opportunities = await repos.listOpportunities({ runId: run.id, cabin: q.cabin, limit: 500 });
    return { run, journeys, summary: { byClassification, byConfidence, byCabinQuality, total: journeys.length }, opportunities, observationCount: await repos.countObservations() };
  });

  app.get('/api/opportunities', async (req) => {
    const q = z.object({ runId: z.string().optional(), days: z.coerce.number().int().min(1).max(3650).optional(), type: z.enum(FARE_OPPORTUNITY_TYPES as [string, ...string[]]).optional(), cabin: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }).parse(req.query);
    return repos.listOpportunities({ runId: q.runId, sinceDays: q.runId ? undefined : (q.days ?? 30), type: q.type, cabin: q.cabin, limit: q.limit });
  });

  // -------------------------------------------------------------- history
  app.get('/api/history', async (req) => {
    const q = z.object({ origin: z.string().length(3).optional(), gateway: z.string().length(3).optional(), cabin: z.string().optional(), days: z.coerce.number().int().min(1).max(3650).default(365), limit: z.coerce.number().int().min(1).max(20000).default(5000) }).parse(req.query);
    const observations = await repos.queryObservations({ origin: q.origin, gateway: q.gateway, cabin: q.cabin, sinceDays: q.days, limit: q.limit });
    return { observations, count: observations.length };
  });
  app.get('/api/history/summary', async () => repos.observationSummary());
  /** Every observation of one physical itinerary plus its price trend (first/last/lowest/highest, change, 7/30-day medians). */
  app.get('/api/history/fingerprint/:fingerprint', async (req) => {
    const { fingerprint } = z.object({ fingerprint: z.string().min(1).max(32) }).parse(req.params);
    const q = z.object({ currentFareEur: z.coerce.number().optional() }).parse(req.query);
    const observations = (await repos.queryObservations({ fingerprint, limit: 5000 })).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const settings = await repos.getSettings();
    const latest = observations[observations.length - 1];
    const current = q.currentFareEur ?? latest?.fareEur ?? 0;
    const now = new Date(new Date().getTime() + 1000).toISOString();
    return { fingerprint, observations, count: observations.length, stats: robustStats(observations.map((o) => o.fareEur)), trend: latest ? fareTrend(fingerprint, current, observations, now, settings.fareIntelligence) : null };
  });

  // ------------------------------------------------------------ providers
  app.get('/api/providers/status', async () => {
    const health = await orchestrator.health();
    const usage = await repos.providerUsageSummary(24);
    const errors = await repos.recentProviderErrors(20);
    return { configured: config.providers, health, usage24h: usage, recentErrors: errors, limits: { maxConcurrency: config.PROVIDER_MAX_CONCURRENCY, minIntervalMs: config.PROVIDER_MIN_INTERVAL_MS, cacheTtlMinutes: config.PROVIDER_CACHE_TTL_MINUTES } };
  });

  // ---------------------------------------------------------- verification
  const verificationView = (v: NonNullable<Awaited<ReturnType<typeof repos.getVerification>>>) => ({
    id: v.id,
    itineraryId: v.itineraryId,
    searchRunId: v.searchRunId,
    status: v.status,
    driver: v.driver,
    attempts: v.attempts,
    requestedAt: v.requestedAt.toISOString(),
    startedAt: v.startedAt?.toISOString() ?? null,
    finishedAt: v.finishedAt?.toISOString() ?? null,
    quotedFare: v.quotedFare,
    quotedCurrency: v.quotedCurrency,
    finalPrice: v.finalPrice,
    finalCurrency: v.finalCurrency,
    finalPriceEur: v.finalPriceEur,
    breakdown: v.breakdown,
    steps: v.steps.map((s) => ({ ...s, screenshotUrl: s.screenshot ? `/api/verifications/${v.id}/screenshots/${s.screenshot}` : null })),
    error: v.error,
  });

  app.get('/api/verifications', async (req) => {
    const q = z.object({ runId: z.string().optional(), ids: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(500) }).parse(req.query);
    const rows = await repos.listVerifications({ runId: q.runId, itineraryIds: q.ids?.split(',').filter(Boolean), limit: q.limit });
    return rows.map(verificationView);
  });
  app.get('/api/verifications/status', async () => deps.verifier.status());
  app.get('/api/verifications/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const v = await repos.getVerification(id);
    return v ? verificationView(v) : reply.code(404).send({ error: 'Verification not found' });
  });
  app.get('/api/verifications/:id/screenshots/:file', async (req, reply) => {
    const { id, file } = z.object({ id: z.string().min(1), file: z.string().regex(/^[\w.-]+\.png$/) }).parse(req.params);
    const dataDir = config.VERIFY_DATA_DIR ?? (deps.verifier as unknown as { deps: { dataDir: string } }).deps.dataDir;
    const full = path.join(dataDir, id, file);
    if (!full.startsWith(path.resolve(dataDir)) || !fs.existsSync(full)) return reply.code(404).send({ error: 'Not found' });
    return reply.type('image/png').send(fs.createReadStream(full));
  });
  app.post('/api/itineraries/:id/verify', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const runId = await repos.getItineraryRunId(id);
    const verificationId = await deps.verifier.enqueue(id, runId, 10);
    const v = await repos.getVerification(verificationId);
    return reply.code(202).send(v ? verificationView(v) : { id: verificationId });
  });
  app.post('/api/verifications/drain', async () => {
    await deps.verifier.drain();
    return deps.verifier.status();
  });

  // ------------------------------------------------------------ scheduler
  app.get('/api/scheduler', async () => scheduler.getStatus());
  app.post('/api/scheduler/run', async () => {
    const r = await scheduler.tick();
    return { ...r, status: scheduler.getStatus() };
  });
}
