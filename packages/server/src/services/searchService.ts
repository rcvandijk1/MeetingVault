import {
  buildPipelineContext,
  planFromProfile,
  runPipeline,
  rescoreJourneys,
  type NormalizedItinerary,
  type PipelineResult,
  type ProviderFailure,
  type ScoreWeights,
  type ScoredJourney,
  type SearchOrchestrator,
  type TripProfile,
  type VerifiedFare,
} from '@kfr/core';
import type { Repositories, SearchRunDetail } from '../repositories/index.js';

export interface SearchOutcome {
  run: SearchRunDetail;
  journeys: ScoredJourney[];
  result: PipelineResult;
}

export interface SearchServiceDeps {
  repos: Repositories;
  orchestrator: SearchOrchestrator;
  now?: () => Date;
  log?: { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };
  /** Number of top-ranked journeys to re-price with their provider before presenting them (0 disables). */
  repriceTopN?: number;
  /** Called after a run has been persisted (used to queue booking-flow price verification). */
  onSearchCompleted?: (outcome: SearchOutcome) => Promise<void>;
}

/** Days of observation history used as the deal-intelligence reference. */
export const HISTORY_WINDOW_DAYS = 120;

export class SearchService {
  private readonly now: () => Date;
  /** Assignable after construction so the verification worker can be wired without a circular dependency. */
  public onSearchCompleted: SearchServiceDeps['onSearchCompleted'];
  constructor(private readonly deps: SearchServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.onSearchCompleted = deps.onSearchCompleted;
  }

  async resolveProfile(profileId?: string, overrides?: Partial<TripProfile>): Promise<TripProfile> {
    const base = profileId ? await this.deps.repos.getProfile(profileId) : await this.deps.repos.getDefaultProfile();
    if (!base) throw new Error(profileId ? `Profile ${profileId} not found` : 'No trip profile exists');
    return { ...base, ...overrides, id: base.id };
  }

  async buildContext(profile: TripProfile) {
    const repos = this.deps.repos;
    const [settings, airports, originProfiles, gateways, groundTransfers, history] = await Promise.all([
      repos.getSettings(),
      repos.listAirports(),
      repos.listOrigins(),
      repos.listGateways(),
      repos.listGroundTransfers(),
      repos.queryObservations({ sinceDays: HISTORY_WINDOW_DAYS }).then((obs) => obs.filter((o) => profile.cabins.includes(o.cabin))),
    ]);
    return buildPipelineContext({ profile, home: settings.home, airports, originProfiles, gateways, groundTransfers, history, dealThresholds: settings.dealThresholds, now: this.now().toISOString() });
  }

  /** Runs the complete flow: providers → pipeline → persistence. */
  async runSearch(args: { profileId?: string; overrides?: Partial<TripProfile>; trigger?: string }): Promise<SearchOutcome> {
    const profile = await this.resolveProfile(args.profileId, args.overrides);
    const ctx = await this.buildContext(profile);
    const plan = planFromProfile(profile);
    const startedAt = this.now();
    const runId = await this.deps.repos.createRun({ profile, request: plan, trigger: args.trigger ?? 'MANUAL', startedAt });
    try {
      const normalize = { fxRatesToEur: ctx.home.fxRatesToEur, now: startedAt.toISOString() };
      const search = await this.deps.orchestrator.run(plan, normalize);
      await this.deps.repos.addProviderEvents(search.usage, runId);
      let result = runPipeline(search.itineraries, ctx);

      // Stage B refinement: re-price the top-ranked journeys where the provider supports it,
      // so that the fares presented as best are freshly validated.
      const repriced = await this.repriceTop(result, search.itineraries, normalize, runId, search.failures);
      if (repriced.changed) result = runPipeline(repriced.itineraries, ctx);

      const finishedAt = this.now();
      await this.deps.repos.saveRunResults(runId, result, finishedAt);
      await this.deps.repos.saveScoreWeights(runId, profile.scoringWeights);
      await this.deps.repos.finishRun(runId, {
        status: 'COMPLETED',
        finishedAt,
        providerErrors: search.failures,
        rejected: result.rejected,
        stats: { ...result.stats, ...search.stats, repriced: repriced.count, durationMs: finishedAt.getTime() - startedAt.getTime() },
      });
      if (search.failures.length > 0) this.deps.log?.warn({ runId, failures: search.failures.length }, 'search completed with provider failures');
      const run = (await this.deps.repos.getRun(runId))!;
      const journeys = await this.deps.repos.getRunJourneys(runId);
      const outcome = { run, journeys, result };
      if (this.onSearchCompleted) {
        try {
          await this.onSearchCompleted(outcome);
        } catch (e) {
          this.deps.log?.warn({ runId, err: e instanceof Error ? e.message : String(e) }, 'post-search hook failed');
        }
      }
      return outcome;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.repos.finishRun(runId, { status: 'FAILED', finishedAt: this.now(), error: message });
      this.deps.log?.error({ runId, err: message }, 'search failed');
      throw err;
    }
  }

  private async repriceTop(
    result: PipelineResult,
    itineraries: NormalizedItinerary[],
    normalize: { fxRatesToEur: Record<string, number>; now: string },
    runId: string,
    failures: ProviderFailure[],
  ): Promise<{ itineraries: NormalizedItinerary[]; changed: boolean; count: number }> {
    const n = this.deps.repriceTopN ?? 0;
    if (n <= 0 || result.journeys.length === 0) return { itineraries, changed: false, count: 0 };
    const byId = new Map(itineraries.map((it) => [it.id, it]));
    let changed = false;
    let count = 0;
    for (const j of result.journeys.slice(0, n)) {
      const original = byId.get(j.itinerary.id);
      if (!original) continue;
      const { itinerary: fresh, failure } = await this.deps.orchestrator.refresh(original, normalize);
      const usage = this.deps.orchestrator.drainUsage();
      await this.deps.repos.addProviderEvents(usage, runId);
      if (failure) failures.push(failure);
      if (!fresh) continue;
      count++;
      if (fresh.fareEur !== original.fareEur || fresh.fingerprint !== original.fingerprint) changed = true;
      byId.set(original.id, { ...fresh, id: original.id, alternatives: original.alternatives, firstSeen: original.firstSeen, lastValidated: normalize.now });
    }
    return { itineraries: [...byId.values()], changed, count };
  }

  /** Re-scores a stored run with different weights (no provider calls). */
  async rescoreRun(runId: string, weights: ScoreWeights, persist = false): Promise<ScoredJourney[]> {
    const run = await this.deps.repos.getRun(runId);
    if (!run) throw new Error(`Search run ${runId} not found`);
    const journeys = await this.deps.repos.getRunJourneys(runId);
    const rescored = rescoreJourneys(journeys, weights, run.profileSnapshot.baselineOrigin);
    if (persist) {
      await this.deps.repos.updateRunScores(runId, rescored, this.now());
      await this.deps.repos.saveScoreWeights(runId, weights);
    }
    return rescored;
  }

  /**
   * Re-runs the pipeline of the run an itinerary belongs to, with that itinerary
   * replaced by `patch(stored)`. Database ids stay stable. Used after re-pricing
   * and after booking-flow verification so scores follow the real price.
   */
  async rerunForItinerary(itineraryId: string, patch: (stored: NormalizedItinerary) => NormalizedItinerary): Promise<ScoredJourney | null> {
    const runId = await this.deps.repos.getItineraryRunId(itineraryId);
    const run = runId ? await this.deps.repos.getRun(runId) : null;
    if (!run || !runId) return null;
    const journeys = await this.deps.repos.getRunJourneys(runId);
    const normalized = journeys.map((j) => (j.itinerary.id === itineraryId ? patch(j.itinerary) : j.itinerary));
    const ctx = await this.buildContext(run.profileSnapshot);
    const result = runPipeline(normalized, ctx);
    await this.deps.repos.updateRunScores(runId, result.journeys, this.now());
    return this.deps.repos.getJourney(itineraryId);
  }

  /** Records the verified final price on the itinerary and re-scores its run. */
  async applyVerifiedFare(itineraryId: string, verifiedFare: VerifiedFare): Promise<ScoredJourney | null> {
    return this.rerunForItinerary(itineraryId, (it) => ({ ...it, verifiedFare }));
  }

  /** Re-prices one itinerary with its provider, records the observation and re-runs the run's pipeline. */
  async refreshItinerary(itineraryId: string): Promise<{ journey: ScoredJourney; refreshed: boolean; error: string | null }> {
    const stored = await this.deps.repos.getJourney(itineraryId);
    if (!stored) throw new Error(`Itinerary ${itineraryId} not found`);
    const settings = await this.deps.repos.getSettings();
    const nowIso = this.now().toISOString();
    const { itinerary: fresh, failure } = await this.deps.orchestrator.refresh(stored.itinerary, { fxRatesToEur: settings.home.fxRatesToEur, now: nowIso });
    if (!fresh) return { journey: stored, refreshed: false, error: failure?.error ?? 'Provider does not support refreshing this offer' };

    const runId = await this.deps.repos.getItineraryRunId(itineraryId);
    if (!runId) return { journey: stored, refreshed: false, error: 'Search run for itinerary not found' };
    await this.deps.repos.addObservation({
      observedAt: nowIso,
      originAirport: fresh.originAirport,
      arrivalGateway: fresh.arrivalGateway,
      outboundDate: fresh.outbound.departureLocal.slice(0, 10),
      inboundDate: fresh.inbound.departureLocal.slice(0, 10),
      airline: fresh.primaryAirline,
      cabin: fresh.cabinSummary.requestedCabin,
      fare: fresh.fare,
      currency: fresh.currency,
      fareEur: fresh.fareEur,
      provider: fresh.provider,
      itineraryFingerprint: fresh.fingerprint,
      searchRunId: runId,
    });
    const journey =
      (await this.rerunForItinerary(itineraryId, (it) => ({ ...fresh, id: itineraryId, firstSeen: it.firstSeen, lastSeen: nowIso, lastValidated: nowIso, alternatives: it.alternatives, verifiedFare: it.verifiedFare ?? null }))) ?? stored;
    return { journey, refreshed: true, error: null };
  }
}
