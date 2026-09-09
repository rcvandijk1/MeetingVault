import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type {
  Airport,
  AlertThresholds,
  DealThresholds,
  DestinationGateway,
  EnrichedJourney,
  FareObservation,
  GroundTransferProfile,
  HomeSettings,
  NormalizedItinerary,
  OriginAccessProfile,
  PipelineResult,
  ScoredJourney,
  TripProfile,
} from '@kfr/core';
import type { ProviderFailure, ProviderUsageEvent } from '@kfr/core';
import type { Database } from '../db/client.js';
import {
  airports,
  appSettings,
  destinationGateways,
  fareObservations,
  flightSegments,
  groundTransferProfiles,
  itineraries,
  knownItineraries,
  originAccessProfiles,
  priceVerifications,
  providerEvents,
  providerOfferReferences,
  scoreResults,
  searchRuns,
  tripProfiles,
  type SearchRunStats,
} from '../db/schema.js';

const uuid = (): string => crypto.randomUUID();

export interface Settings {
  home: HomeSettings;
  dealThresholds: DealThresholds;
  alertThresholds: AlertThresholds;
}

export interface SearchRunSummary {
  id: string;
  profileId: string | null;
  profileName: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  stats: SearchRunStats | null;
  providerErrors: ProviderFailure[];
  error: string | null;
  resultCount: number;
}

export interface SearchRunDetail extends SearchRunSummary {
  request: unknown;
  profileSnapshot: TripProfile;
  rejected: PipelineResult['rejected'];
}

export class Repositories {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------- settings
  async getSettings(): Promise<Settings> {
    const row = (await this.db.select().from(appSettings).where(eq(appSettings.id, 1)))[0];
    if (!row) throw new Error('Application settings are not seeded');
    return {
      home: {
        name: row.homeName,
        countryCode: row.homeCountryCode,
        timezone: row.homeTimezone,
        hotelEveningDepartureTime: row.hotelEveningDepartureTime,
        minHotelRestMinutes: row.minHotelRestMinutes,
        airportExitMinutes: row.airportExitMinutes,
        currency: 'EUR',
        fxRatesToEur: row.fxRatesToEur,
      },
      dealThresholds: row.dealThresholds,
      alertThresholds: row.alertThresholds,
    };
  }

  async updateSettings(input: Partial<Settings>): Promise<Settings> {
    const patch: Partial<typeof appSettings.$inferInsert> = { updatedAt: new Date() };
    if (input.home) {
      patch.homeName = input.home.name;
      patch.homeCountryCode = input.home.countryCode;
      patch.homeTimezone = input.home.timezone;
      patch.hotelEveningDepartureTime = input.home.hotelEveningDepartureTime;
      patch.minHotelRestMinutes = input.home.minHotelRestMinutes;
      patch.airportExitMinutes = input.home.airportExitMinutes;
      patch.fxRatesToEur = input.home.fxRatesToEur;
    }
    if (input.dealThresholds) patch.dealThresholds = input.dealThresholds;
    if (input.alertThresholds) patch.alertThresholds = input.alertThresholds;
    await this.db.update(appSettings).set(patch).where(eq(appSettings.id, 1));
    return this.getSettings();
  }

  // ---------------------------------------------------------------- airports
  async listAirports(): Promise<Airport[]> {
    const rows = await this.db.select().from(airports).orderBy(airports.code);
    return rows.map((r) => ({ ...r, region: r.region as Airport['region'] }));
  }

  async upsertAirport(a: Airport): Promise<Airport> {
    await this.db.insert(airports).values(a).onConflictDoUpdate({ target: airports.code, set: { name: a.name, city: a.city, country: a.country, timezone: a.timezone, region: a.region } });
    return a;
  }

  // ------------------------------------------------------------------ origins
  async listOrigins(): Promise<OriginAccessProfile[]> {
    const rows = await this.db.select().from(originAccessProfiles).orderBy(originAccessProfiles.airportCode);
    return rows.map(toOriginProfile);
  }

  async upsertOrigin(p: OriginAccessProfile): Promise<OriginAccessProfile> {
    const { airportCode, ...rest } = p;
    await this.db
      .insert(originAccessProfiles)
      .values({ ...p, updatedAt: new Date() })
      .onConflictDoUpdate({ target: originAccessProfiles.airportCode, set: { ...rest, updatedAt: new Date() } });
    void airportCode;
    return p;
  }

  async deleteOrigin(code: string): Promise<boolean> {
    const r = await this.db.delete(originAccessProfiles).where(eq(originAccessProfiles.airportCode, code)).returning({ code: originAccessProfiles.airportCode });
    return r.length > 0;
  }

  // ----------------------------------------------------------------- gateways
  async listGateways(): Promise<DestinationGateway[]> {
    return this.db.select().from(destinationGateways).orderBy(destinationGateways.code);
  }

  async upsertGateway(g: DestinationGateway): Promise<DestinationGateway> {
    const { code, ...rest } = g;
    await this.db.insert(destinationGateways).values(g).onConflictDoUpdate({ target: destinationGateways.code, set: rest });
    void code;
    return g;
  }

  // ---------------------------------------------------------- ground transfer
  async listGroundTransfers(): Promise<GroundTransferProfile[]> {
    const rows = await this.db.select().from(groundTransferProfiles).orderBy(groundTransferProfiles.id);
    return rows.map((r) => ({ ...r, mode: r.mode as GroundTransferProfile['mode'] }));
  }

  async upsertGroundTransfer(g: GroundTransferProfile): Promise<GroundTransferProfile> {
    const { id, ...rest } = g;
    await this.db.insert(groundTransferProfiles).values(g).onConflictDoUpdate({ target: groundTransferProfiles.id, set: rest });
    void id;
    return g;
  }

  async deleteGroundTransfer(id: string): Promise<boolean> {
    const r = await this.db.delete(groundTransferProfiles).where(eq(groundTransferProfiles.id, id)).returning({ id: groundTransferProfiles.id });
    return r.length > 0;
  }

  // ----------------------------------------------------------------- profiles
  async listProfiles(): Promise<TripProfile[]> {
    const rows = await this.db.select().from(tripProfiles).orderBy(desc(tripProfiles.isDefault), tripProfiles.name);
    return rows.map(toTripProfile);
  }

  async getProfile(id: string): Promise<TripProfile | null> {
    const row = (await this.db.select().from(tripProfiles).where(eq(tripProfiles.id, id)))[0];
    return row ? toTripProfile(row) : null;
  }

  async getDefaultProfile(): Promise<TripProfile | null> {
    const row = (await this.db.select().from(tripProfiles).where(eq(tripProfiles.isDefault, true)))[0] ?? (await this.db.select().from(tripProfiles).orderBy(tripProfiles.createdAt))[0];
    return row ? toTripProfile(row) : null;
  }

  async createProfile(input: Omit<TripProfile, 'id'> & { id?: string }): Promise<TripProfile> {
    const id = input.id ?? uuid();
    if (input.isDefault) await this.db.update(tripProfiles).set({ isDefault: false });
    await this.db.insert(tripProfiles).values({ ...input, id });
    return (await this.getProfile(id))!;
  }

  async updateProfile(id: string, input: Omit<TripProfile, 'id'>): Promise<TripProfile | null> {
    if (input.isDefault) await this.db.update(tripProfiles).set({ isDefault: false });
    const r = await this.db
      .update(tripProfiles)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tripProfiles.id, id))
      .returning({ id: tripProfiles.id });
    return r.length ? this.getProfile(id) : null;
  }

  async setDefaultProfile(id: string): Promise<TripProfile | null> {
    await this.db.update(tripProfiles).set({ isDefault: false });
    await this.db.update(tripProfiles).set({ isDefault: true }).where(eq(tripProfiles.id, id));
    return this.getProfile(id);
  }

  async deleteProfile(id: string): Promise<boolean> {
    const r = await this.db.delete(tripProfiles).where(eq(tripProfiles.id, id)).returning({ id: tripProfiles.id });
    return r.length > 0;
  }

  // -------------------------------------------------------------- search runs
  async createRun(args: { id?: string; profile: TripProfile; request: unknown; trigger: string; startedAt: Date }): Promise<string> {
    const id = args.id ?? uuid();
    await this.db.insert(searchRuns).values({ id, profileId: args.profile.id, trigger: args.trigger, status: 'RUNNING', startedAt: args.startedAt, request: args.request, profileSnapshot: args.profile });
    return id;
  }

  async finishRun(id: string, args: { status: 'COMPLETED' | 'FAILED'; stats?: SearchRunStats; providerErrors?: ProviderFailure[]; rejected?: PipelineResult['rejected']; error?: string; finishedAt: Date }): Promise<void> {
    await this.db.update(searchRuns).set({ status: args.status, stats: args.stats, providerErrors: args.providerErrors ?? [], rejected: args.rejected ?? [], error: args.error ?? null, finishedAt: args.finishedAt }).where(eq(searchRuns.id, id));
  }

  async listRuns(limit = 25, profileId?: string): Promise<SearchRunSummary[]> {
    const rows = await this.db
      .select({ run: searchRuns, profileName: tripProfiles.name, resultCount: sql<number>`(select count(*) from ${itineraries} where ${itineraries.searchRunId} = ${searchRuns.id})` })
      .from(searchRuns)
      .leftJoin(tripProfiles, eq(tripProfiles.id, searchRuns.profileId))
      .where(profileId ? eq(searchRuns.profileId, profileId) : undefined)
      .orderBy(desc(searchRuns.startedAt))
      .limit(limit);
    return rows.map((r) => toRunSummary(r.run, r.profileName, Number(r.resultCount)));
  }

  async getRun(id: string): Promise<SearchRunDetail | null> {
    const row = (
      await this.db
        .select({ run: searchRuns, profileName: tripProfiles.name, resultCount: sql<number>`(select count(*) from ${itineraries} where ${itineraries.searchRunId} = ${searchRuns.id})` })
        .from(searchRuns)
        .leftJoin(tripProfiles, eq(tripProfiles.id, searchRuns.profileId))
        .where(eq(searchRuns.id, id))
    )[0];
    if (!row) return null;
    return { ...toRunSummary(row.run, row.profileName, Number(row.resultCount)), request: row.run.request, profileSnapshot: row.run.profileSnapshot as TripProfile, rejected: row.run.rejected };
  }

  async latestCompletedRun(profileId?: string): Promise<SearchRunSummary | null> {
    const rows = await this.db
      .select({ run: searchRuns, profileName: tripProfiles.name, resultCount: sql<number>`(select count(*) from ${itineraries} where ${itineraries.searchRunId} = ${searchRuns.id})` })
      .from(searchRuns)
      .leftJoin(tripProfiles, eq(tripProfiles.id, searchRuns.profileId))
      .where(profileId ? and(eq(searchRuns.status, 'COMPLETED'), eq(searchRuns.profileId, profileId)) : eq(searchRuns.status, 'COMPLETED'))
      .orderBy(desc(searchRuns.startedAt))
      .limit(1);
    const r = rows[0];
    return r ? toRunSummary(r.run, r.profileName, Number(r.resultCount)) : null;
  }

  /** Persists the full result of a run: itineraries, segments, scores, offer references, observations, known itineraries. */
  async saveRunResults(runId: string, result: PipelineResult, now: Date): Promise<void> {
    if (result.journeys.length === 0) return;
    const known = await this.db.select().from(knownItineraries).where(inArray(knownItineraries.fingerprint, result.journeys.map((j) => j.itinerary.fingerprint)));
    const knownMap = new Map(known.map((k) => [k.fingerprint, k]));

    await this.db.transaction(async (tx) => {
      const itineraryRows: Array<typeof itineraries.$inferInsert> = [];
      const segmentRows: Array<typeof flightSegments.$inferInsert> = [];
      const scoreRows: Array<typeof scoreResults.$inferInsert> = [];
      const refRows: Array<typeof providerOfferReferences.$inferInsert> = [];
      const obsRows: Array<typeof fareObservations.$inferInsert> = [];

      for (const j of result.journeys) {
        const it = j.itinerary;
        const itineraryId = uuid();
        const k = knownMap.get(it.fingerprint);
        const firstSeen = k?.firstSeen ?? now;
        // Persist the itinerary with a stable database id; keep the provider id in the normalized payload.
        const normalized: NormalizedItinerary = { ...it, id: itineraryId, firstSeen: firstSeen.toISOString(), lastSeen: now.toISOString(), lastValidated: now.toISOString() };
        const { itinerary: _omit, ...enriched } = j;
        void _omit;
        itineraryRows.push({
          id: itineraryId,
          searchRunId: runId,
          fingerprint: it.fingerprint,
          provider: it.provider,
          providerOfferId: it.providerOfferId,
          fare: it.fare,
          currency: it.currency,
          fareEur: it.fareEur,
          originAirport: it.originAirport,
          arrivalGateway: it.arrivalGateway,
          outboundDate: it.outbound.departureLocal.slice(0, 10),
          inboundDate: it.inbound.departureLocal.slice(0, 10),
          airline: it.primaryAirline,
          cabin: it.cabinSummary.requestedCabin,
          normalized,
          enriched: stripScore(enriched),
          providerExpiresAt: it.providerExpiresAt ? new Date(it.providerExpiresAt) : null,
          firstSeen,
          lastSeen: now,
          lastValidated: now,
        });
        it.outbound.segments.forEach((s, i) => segmentRows.push(segmentRow(itineraryId, 'OUTBOUND', i, s)));
        it.inbound.segments.forEach((s, i) => segmentRows.push(segmentRow(itineraryId, 'RETURN', i, s)));
        scoreRows.push({
          id: uuid(),
          itineraryId,
          searchRunId: runId,
          overallScore: j.overallScore,
          rank: j.rank,
          categoryScores: j.categoryScores,
          reasons: j.reasons,
          labels: j.labels,
          dealLevel: j.deal.level,
          deal: j.deal,
          paretoDominated: j.paretoDominated,
          dominatedBy: j.dominatedBy,
          convenienceScore: j.convenienceScore,
          sleepOpportunityScore: j.sleepOpportunityScore,
          baseline: j.baseline,
          weights: (result as PipelineResult & { weights?: never }).weights ?? ({} as never),
        });
        refRows.push({ id: uuid(), itineraryId, provider: it.provider, providerOfferId: it.providerOfferId, fare: it.fare, currency: it.currency, fareEur: it.fareEur, expiresAt: it.providerExpiresAt ? new Date(it.providerExpiresAt) : null, raw: it.rawProviderReference ?? null });
        for (const alt of it.alternatives) refRows.push({ id: uuid(), itineraryId, provider: alt.provider, providerOfferId: alt.providerOfferId, fare: alt.fare, currency: alt.currency, fareEur: alt.fareEur, expiresAt: alt.providerExpiresAt ? new Date(alt.providerExpiresAt) : null, raw: null });
        obsRows.push(observationRow(it, now, runId));
        for (const alt of it.alternatives) obsRows.push({ ...observationRow(it, now, runId), id: uuid(), provider: alt.provider, fare: alt.fare, currency: alt.currency, fareEur: alt.fareEur });
      }

      // Scores were computed with the profile snapshot's weights; store them with the score row.
      const weights = result.journeys[0] ? (result as unknown as { weights?: unknown }).weights : undefined;
      void weights;

      await tx.insert(itineraries).values(itineraryRows);
      for (const chunk of chunks(segmentRows, 500)) await tx.insert(flightSegments).values(chunk);
      await tx.insert(scoreResults).values(scoreRows);
      for (const chunk of chunks(refRows, 500)) await tx.insert(providerOfferReferences).values(chunk);
      for (const chunk of chunks(obsRows, 500)) await tx.insert(fareObservations).values(chunk);

      for (const j of result.journeys) {
        const it = j.itinerary;
        const k = knownMap.get(it.fingerprint);
        await tx
          .insert(knownItineraries)
          .values({ fingerprint: it.fingerprint, firstSeen: now, lastSeen: now, lastValidated: now, lowestFareEur: it.fareEur, latestFareEur: it.fareEur, timesSeen: 1 })
          .onConflictDoUpdate({
            target: knownItineraries.fingerprint,
            set: { lastSeen: now, lastValidated: now, latestFareEur: it.fareEur, lowestFareEur: Math.min(k?.lowestFareEur ?? it.fareEur, it.fareEur), timesSeen: sql`${knownItineraries.timesSeen} + 1` },
          });
      }
    });
  }

  async saveScoreWeights(runId: string, weights: TripProfile['scoringWeights']): Promise<void> {
    await this.db.update(scoreResults).set({ weights }).where(eq(scoreResults.searchRunId, runId));
  }

  async getRunJourneys(runId: string): Promise<ScoredJourney[]> {
    const rows = await this.db
      .select({ it: itineraries, score: scoreResults })
      .from(itineraries)
      .innerJoin(scoreResults, eq(scoreResults.itineraryId, itineraries.id))
      .where(eq(itineraries.searchRunId, runId))
      .orderBy(scoreResults.rank);
    return rows.map((r) => toScoredJourney(r.it, r.score));
  }

  async getJourney(id: string): Promise<ScoredJourney | null> {
    const row = (await this.db.select({ it: itineraries, score: scoreResults }).from(itineraries).innerJoin(scoreResults, eq(scoreResults.itineraryId, itineraries.id)).where(eq(itineraries.id, id)))[0];
    return row ? toScoredJourney(row.it, row.score) : null;
  }

  async getJourneys(ids: string[]): Promise<ScoredJourney[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select({ it: itineraries, score: scoreResults }).from(itineraries).innerJoin(scoreResults, eq(scoreResults.itineraryId, itineraries.id)).where(inArray(itineraries.id, ids));
    return rows.map((r) => toScoredJourney(r.it, r.score));
  }

  async getKnownItinerary(fingerprint: string) {
    return (await this.db.select().from(knownItineraries).where(eq(knownItineraries.fingerprint, fingerprint)))[0] ?? null;
  }

  async updateRunScores(runId: string, journeys: ScoredJourney[], now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const j of journeys) {
        const { itinerary: it, ...enriched } = j;
        await tx
          .update(itineraries)
          .set({ fare: it.fare, currency: it.currency, fareEur: it.fareEur, normalized: it, enriched: stripScore(enriched), lastValidated: it.lastValidated ? new Date(it.lastValidated) : now, lastSeen: now })
          .where(eq(itineraries.id, it.id));
        await tx
          .update(scoreResults)
          .set({ overallScore: j.overallScore, rank: j.rank, categoryScores: j.categoryScores, reasons: j.reasons, labels: j.labels, dealLevel: j.deal.level, deal: j.deal, paretoDominated: j.paretoDominated, dominatedBy: j.dominatedBy, convenienceScore: j.convenienceScore, sleepOpportunityScore: j.sleepOpportunityScore, baseline: j.baseline })
          .where(eq(scoreResults.itineraryId, it.id));
      }
    });
  }

  // ------------------------------------------------------------ observations
  async addObservation(o: FareObservation): Promise<void> {
    await this.db.insert(fareObservations).values({ id: uuid(), ...o, observedAt: new Date(o.observedAt), searchRunId: o.searchRunId ?? null });
  }

  async queryObservations(f: { origin?: string; gateway?: string; cabin?: string; sinceDays?: number; limit?: number }): Promise<FareObservation[]> {
    const conds = [];
    if (f.origin) conds.push(eq(fareObservations.originAirport, f.origin));
    if (f.gateway) conds.push(eq(fareObservations.arrivalGateway, f.gateway));
    if (f.cabin) conds.push(eq(fareObservations.cabin, f.cabin));
    if (f.sinceDays) conds.push(gte(fareObservations.observedAt, new Date(Date.now() - f.sinceDays * 86400000)));
    const rows = await this.db
      .select()
      .from(fareObservations)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(fareObservations.observedAt))
      .limit(f.limit ?? 5000);
    return rows.map((r) => ({ ...r, cabin: r.cabin as FareObservation['cabin'], observedAt: r.observedAt.toISOString(), searchRunId: r.searchRunId }));
  }

  async observationSummary(): Promise<Array<{ originAirport: string; arrivalGateway: string; cabin: string; count: number; minFareEur: number; medianFareEur: number; lastObservedAt: string }>> {
    const rows = await this.db
      .select({
        originAirport: fareObservations.originAirport,
        arrivalGateway: fareObservations.arrivalGateway,
        cabin: fareObservations.cabin,
        count: sql<number>`count(*)`,
        minFareEur: sql<number>`min(${fareObservations.fareEur})`,
        medianFareEur: sql<number>`percentile_cont(0.5) within group (order by ${fareObservations.fareEur})`,
        lastObservedAt: sql<string>`max(${fareObservations.observedAt})`,
      })
      .from(fareObservations)
      .groupBy(fareObservations.originAirport, fareObservations.arrivalGateway, fareObservations.cabin)
      .orderBy(fareObservations.originAirport, fareObservations.arrivalGateway);
    return rows.map((r) => ({ ...r, count: Number(r.count), minFareEur: Number(r.minFareEur), medianFareEur: Number(r.medianFareEur), lastObservedAt: new Date(r.lastObservedAt).toISOString() }));
  }

  // ------------------------------------------------------------ verification
  async createVerification(row: typeof priceVerifications.$inferInsert): Promise<void> {
    await this.db.insert(priceVerifications).values(row);
  }

  async updateVerification(id: string, patch: Partial<typeof priceVerifications.$inferInsert>): Promise<void> {
    await this.db.update(priceVerifications).set(patch).where(eq(priceVerifications.id, id));
  }

  /** Atomically claims the next queued verification (highest priority, oldest first). */
  async claimNextVerification(now: Date): Promise<{ id: string; itineraryId: string; attempts: number } | null> {
    const rows = await this.db.execute(sql`
      update ${priceVerifications} set status = 'RUNNING', started_at = ${now.toISOString()}::timestamptz, attempts = attempts + 1
      where id = (
        select id from ${priceVerifications} where status = 'QUEUED'
        order by priority desc, requested_at asc
        for update skip locked limit 1
      )
      returning id, itinerary_id, attempts`);
    const r = (rows as unknown as Array<{ id: string; itinerary_id: string; attempts: number }>)[0];
    return r ? { id: r.id, itineraryId: r.itinerary_id, attempts: Number(r.attempts) } : null;
  }

  async getVerification(id: string) {
    return (await this.db.select().from(priceVerifications).where(eq(priceVerifications.id, id)))[0] ?? null;
  }

  async latestVerification(itineraryId: string) {
    return (await this.db.select().from(priceVerifications).where(eq(priceVerifications.itineraryId, itineraryId)).orderBy(desc(priceVerifications.requestedAt)).limit(1))[0] ?? null;
  }

  async listVerifications(f: { runId?: string; itineraryIds?: string[]; limit?: number }) {
    const conds = [];
    if (f.runId) conds.push(eq(priceVerifications.searchRunId, f.runId));
    if (f.itineraryIds && f.itineraryIds.length) conds.push(inArray(priceVerifications.itineraryId, f.itineraryIds));
    return this.db
      .select()
      .from(priceVerifications)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(priceVerifications.requestedAt))
      .limit(f.limit ?? 500);
  }

  /** Most recent successful verification of the same physical itinerary (any run) since `since`. */
  async latestVerifiedByFingerprint(fingerprint: string, since: Date) {
    const rows = await this.db
      .select({ v: priceVerifications })
      .from(priceVerifications)
      .innerJoin(itineraries, eq(itineraries.id, priceVerifications.itineraryId))
      .where(and(eq(itineraries.fingerprint, fingerprint), eq(priceVerifications.status, 'VERIFIED'), gte(priceVerifications.finishedAt, since)))
      .orderBy(desc(priceVerifications.finishedAt))
      .limit(1);
    return rows[0]?.v ?? null;
  }

  async resetRunningVerifications(): Promise<number> {
    const r = await this.db.update(priceVerifications).set({ status: 'QUEUED', startedAt: null }).where(eq(priceVerifications.status, 'RUNNING')).returning({ id: priceVerifications.id });
    return r.length;
  }

  async countVerifications(status: string): Promise<number> {
    const r = await this.db.select({ n: sql<number>`count(*)` }).from(priceVerifications).where(eq(priceVerifications.status, status));
    return Number(r[0]?.n ?? 0);
  }

  async getItineraryRunId(itineraryId: string): Promise<string | null> {
    const r = (await this.db.select({ runId: itineraries.searchRunId }).from(itineraries).where(eq(itineraries.id, itineraryId)))[0];
    return r?.runId ?? null;
  }

  // ---------------------------------------------------------- provider events
  async addProviderEvents(events: ProviderUsageEvent[], runId: string | null): Promise<void> {
    if (events.length === 0) return;
    const rows = events.map((e) => ({ id: uuid(), provider: e.provider, kind: e.kind, searchRunId: runId, startedAt: new Date(e.startedAt), durationMs: e.durationMs, ok: e.ok, cached: e.cached, resultCount: e.resultCount, error: e.error, request: e.request }));
    for (const chunk of chunks(rows, 500)) await this.db.insert(providerEvents).values(chunk);
  }

  async providerUsageSummary(sinceHours = 24): Promise<Array<{ provider: string; calls: number; liveCalls: number; errors: number; avgDurationMs: number; lastError: string | null; lastErrorAt: string | null }>> {
    const since = new Date(Date.now() - sinceHours * 3600000);
    const rows = await this.db
      .select({
        provider: providerEvents.provider,
        calls: sql<number>`count(*)`,
        liveCalls: sql<number>`count(*) filter (where not ${providerEvents.cached})`,
        errors: sql<number>`count(*) filter (where not ${providerEvents.ok})`,
        avgDurationMs: sql<number>`coalesce(avg(${providerEvents.durationMs}) filter (where not ${providerEvents.cached}), 0)`,
      })
      .from(providerEvents)
      .where(gte(providerEvents.startedAt, since))
      .groupBy(providerEvents.provider);
    const out = [];
    for (const r of rows) {
      const lastErr = (await this.db.select().from(providerEvents).where(and(eq(providerEvents.provider, r.provider), eq(providerEvents.ok, false))).orderBy(desc(providerEvents.startedAt)).limit(1))[0];
      out.push({ provider: r.provider, calls: Number(r.calls), liveCalls: Number(r.liveCalls), errors: Number(r.errors), avgDurationMs: Math.round(Number(r.avgDurationMs)), lastError: lastErr?.error ?? null, lastErrorAt: lastErr?.startedAt.toISOString() ?? null });
    }
    return out;
  }

  async recentProviderErrors(limit = 20) {
    const rows = await this.db.select().from(providerEvents).where(eq(providerEvents.ok, false)).orderBy(desc(providerEvents.startedAt)).limit(limit);
    return rows.map((r) => ({ provider: r.provider, error: r.error, time: r.startedAt.toISOString(), request: r.request, kind: r.kind }));
  }
}

// ---------------------------------------------------------------------------
// mappers
// ---------------------------------------------------------------------------

function toOriginProfile(r: typeof originAccessProfiles.$inferSelect): OriginAccessProfile {
  return {
    airportCode: r.airportCode,
    enabled: r.enabled,
    preferredAccessMode: r.preferredAccessMode as OriginAccessProfile['preferredAccessMode'],
    accessTravelMinutes: r.accessTravelMinutes,
    accessMonetaryCost: r.accessMonetaryCost,
    airportBufferMinutes: r.airportBufferMinutes,
    sameDayEarliestDepartureTime: r.sameDayEarliestDepartureTime,
    hotelCost: r.hotelCost,
    hotelRequiredRule: r.hotelRequiredRule as OriginAccessProfile['hotelRequiredRule'],
    returnHotelLatestArrivalTime: r.returnHotelLatestArrivalTime,
    parkingCost: r.parkingCost,
    trainCost: r.trainCost,
    fuelCost: r.fuelCost,
    tollCost: r.tollCost,
    inconveniencePenalty: r.inconveniencePenalty,
    notes: r.notes,
  };
}

function toTripProfile(r: typeof tripProfiles.$inferSelect): TripProfile {
  return {
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    passengers: r.passengers,
    outboundEarliestDate: r.outboundEarliestDate,
    outboundLatestDate: r.outboundLatestDate,
    returnEarliestDate: r.returnEarliestDate,
    returnLatestDate: r.returnLatestDate,
    minTripDays: r.minTripDays,
    preferredTripDaysMin: r.preferredTripDaysMin,
    preferredTripDaysMax: r.preferredTripDaysMax,
    maxTripDays: r.maxTripDays,
    cabins: r.cabins,
    feederMinCabin: r.feederMinCabin as TripProfile['feederMinCabin'],
    mixedCabinAllowed: r.mixedCabinAllowed,
    outboundConstraints: r.outboundConstraints,
    returnConstraints: r.returnConstraints,
    timePreferences: r.timePreferences,
    scoringWeights: r.scoringWeights,
    scoringParams: r.scoringParams,
    selfTransferPolicy: r.selfTransferPolicy,
    enabledOrigins: r.enabledOrigins,
    enabledArrivalGateways: r.enabledArrivalGateways,
    baselineOrigin: r.baselineOrigin,
    maxValidationCandidates: r.maxValidationCandidates,
  };
}

function toRunSummary(r: typeof searchRuns.$inferSelect, profileName: string | null, resultCount: number): SearchRunSummary {
  return {
    id: r.id,
    profileId: r.profileId,
    profileName,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    stats: r.stats,
    providerErrors: r.providerErrors,
    error: r.error,
    resultCount,
  };
}

type EnrichedWithoutItinerary = Omit<EnrichedJourney, 'itinerary'>;

function stripScore(j: Omit<ScoredJourney, 'itinerary'>): EnrichedWithoutItinerary {
  return {
    originAccess: j.originAccess,
    hotelOutbound: j.hotelOutbound,
    hotelReturn: j.hotelReturn,
    groundTransfer: j.groundTransfer,
    cost: j.cost,
    outboundTimeline: j.outboundTimeline,
    returnTimeline: j.returnTimeline,
    doorToKrabiMinutes: j.doorToKrabiMinutes,
    krabiToDoorMinutes: j.krabiToDoorMinutes,
    totalDoorToDoorMinutes: j.totalDoorToDoorMinutes,
    totalElapsedJourneyMinutes: j.totalElapsedJourneyMinutes,
    totalActiveTravelBurdenMinutes: j.totalActiveTravelBurdenMinutes,
    tripDays: j.tripDays,
  };
}

function toScoredJourney(it: typeof itineraries.$inferSelect, s: typeof scoreResults.$inferSelect): ScoredJourney {
  return {
    itinerary: { ...it.normalized, id: it.id, firstSeen: it.firstSeen.toISOString(), lastSeen: it.lastSeen.toISOString(), lastValidated: it.lastValidated.toISOString() },
    ...it.enriched,
    categoryScores: s.categoryScores,
    overallScore: s.overallScore,
    reasons: s.reasons,
    labels: s.labels,
    baseline: s.baseline,
    deal: s.deal,
    paretoDominated: s.paretoDominated,
    dominatedBy: s.dominatedBy,
    convenienceScore: s.convenienceScore,
    rank: s.rank,
    sleepOpportunityScore: s.sleepOpportunityScore,
  };
}

function segmentRow(itineraryId: string, direction: 'OUTBOUND' | 'RETURN', seq: number, s: NormalizedItinerary['segments'][number]): typeof flightSegments.$inferInsert {
  return {
    id: uuid(),
    itineraryId,
    direction,
    seq,
    origin: s.origin,
    destination: s.destination,
    departureUtc: new Date(s.departureUtc),
    departureLocal: s.departureLocal,
    arrivalUtc: new Date(s.arrivalUtc),
    arrivalLocal: s.arrivalLocal,
    marketingCarrier: s.marketingCarrier,
    operatingCarrier: s.operatingCarrier,
    flightNumber: s.flightNumber,
    aircraft: s.aircraft,
    cabin: s.cabin,
    fareClass: s.fareClass ?? null,
    seatProduct: s.seatProduct ?? null,
    durationMinutes: s.durationMinutes,
    ticketGroup: s.ticketGroup,
  };
}

function observationRow(it: NormalizedItinerary, now: Date, runId: string): typeof fareObservations.$inferInsert {
  return {
    id: uuid(),
    observedAt: now,
    originAirport: it.originAirport,
    arrivalGateway: it.arrivalGateway,
    outboundDate: it.outbound.departureLocal.slice(0, 10),
    inboundDate: it.inbound.departureLocal.slice(0, 10),
    airline: it.primaryAirline,
    cabin: it.cabinSummary.requestedCabin,
    fare: it.fare,
    currency: it.currency,
    fareEur: it.fareEur,
    provider: it.provider,
    itineraryFingerprint: it.fingerprint,
    searchRunId: runId,
  };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
