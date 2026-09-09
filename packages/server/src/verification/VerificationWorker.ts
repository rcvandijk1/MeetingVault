import fs from 'node:fs';
import path from 'node:path';
import { convertToEur, type ScoredJourney, type VerifiedFare } from '@kfr/core';
import type { Repositories } from '../repositories/index.js';
import type { SearchService } from '../services/searchService.js';
import type { BrowserManager } from './browser.js';
import { VerificationError, type BookingFlowDriver } from './types.js';
import type { VerificationStep } from '../db/schema.js';

export interface VerificationWorkerStatus {
  enabled: boolean;
  running: number;
  queued: number;
  concurrency: number;
  drivers: Array<{ name: string; kind: 'BROWSER' | 'API' }>;
  browser: { running: boolean; executablePath: string | null; lastError: string | null };
  processed: number;
  verified: number;
  failed: number;
  lastError: string | null;
}

export interface VerificationWorkerDeps {
  repos: Repositories;
  searchService: SearchService;
  browser: BrowserManager;
  drivers: BookingFlowDriver[];
  dataDir: string;
  selfBaseUrl: () => string;
  enabled: boolean;
  concurrency: number;
  topN: number;
  /** A fingerprint verified within this many minutes is reused instead of walking the flow again. */
  cacheMinutes?: number;
  maxAttempts?: number;
  now?: () => Date;
  log: { info: (o: unknown, msg?: string) => void; warn: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };
}

/**
 * Background queue that verifies the final price of itineraries by walking the
 * booking flow of their selling channel up to the payment step. Runs
 * asynchronously after every search; results feed back into the true journey
 * cost and the scores of the run.
 */
export class VerificationWorker {
  private active = 0;
  private stats = { processed: 0, verified: 0, failed: 0, lastError: null as string | null };
  private stopped = false;
  private readonly now: () => Date;
  private pumping: Promise<void> | null = null;

  constructor(private readonly deps: VerificationWorkerDeps) {
    this.now = deps.now ?? (() => new Date());
    fs.mkdirSync(deps.dataDir, { recursive: true });
  }

  driverFor(itinerary: ScoredJourney['itinerary']): BookingFlowDriver | null {
    return this.deps.drivers.find((d) => d.supports(itinerary)) ?? null;
  }

  /**
   * Enqueues the top-N journeys of a completed search run. Newer runs get a
   * higher priority than any backlog so what the user is looking at is
   * verified first.
   */
  async enqueueForRun(runId: string, journeys: ScoredJourney[]): Promise<number> {
    if (!this.deps.enabled || this.deps.topN <= 0) return 0;
    const top = journeys.slice(0, this.deps.topN);
    const priority = Math.floor(this.now().getTime() / 1000);
    let n = 0;
    for (const j of top) {
      await this.enqueue(j.itinerary.id, runId, priority);
      n++;
    }
    return n;
  }

  /**
   * Verification follows the ranking: a verified final price re-scores the run,
   * which can promote a journey that has not been checked yet into the top N.
   * Queue whatever currently sits in the top N and has no verification.
   */
  async ensureTopVerified(runId: string | null): Promise<number> {
    if (!runId || !this.deps.enabled || this.deps.topN <= 0) return 0;
    const journeys = await this.deps.repos.getRunJourneys(runId);
    const existing = await this.deps.repos.listVerifications({ runId });
    const covered = new Set(existing.map((v) => v.itineraryId));
    const priority = Math.floor(this.now().getTime() / 1000);
    let n = 0;
    for (const j of journeys.slice(0, this.deps.topN)) {
      if (covered.has(j.itinerary.id) || j.itinerary.verifiedFare) continue;
      await this.enqueue(j.itinerary.id, runId, priority);
      n++;
    }
    return n;
  }

  /** Enqueues one itinerary (idempotent while a verification is still pending). Manual requests jump the queue. */
  async enqueue(itineraryId: string, runId: string | null, priority = 2_000_000_000): Promise<string> {
    const journey = await this.deps.repos.getJourney(itineraryId);
    if (!journey) throw new Error(`Itinerary ${itineraryId} not found`);
    const existing = await this.deps.repos.latestVerification(itineraryId);
    if (existing && (existing.status === 'QUEUED' || existing.status === 'RUNNING')) return existing.id;
    const driver = this.driverFor(journey.itinerary);
    const id = crypto.randomUUID();

    // Same flights verified recently (any run): reuse that result instead of walking the flow again.
    const cacheMinutes = this.deps.cacheMinutes ?? 0;
    if (driver && cacheMinutes > 0 && priority < 2_000_000_000) {
      const cached = await this.deps.repos.latestVerifiedByFingerprint(journey.itinerary.fingerprint, new Date(this.now().getTime() - cacheMinutes * 60000));
      if (cached && cached.finalPrice !== null && cached.finalCurrency && cached.finalPriceEur !== null) {
        await this.deps.repos.createVerification({
          id,
          itineraryId,
          searchRunId: runId,
          status: 'VERIFIED',
          driver: `${cached.driver ?? driver.name} (reused)`,
          priority,
          attempts: 0,
          requestedAt: this.now(),
          startedAt: this.now(),
          finishedAt: this.now(),
          quotedFare: journey.itinerary.fare,
          quotedCurrency: journey.itinerary.currency,
          finalPrice: cached.finalPrice,
          finalCurrency: cached.finalCurrency,
          finalPriceEur: cached.finalPriceEur,
          breakdown: cached.breakdown,
          steps: [{ name: 'reuse', at: this.now().toISOString(), ok: true, note: `Reused verification ${cached.id} of the same flights from ${cached.finishedAt?.toISOString() ?? ''}` }],
          error: null,
        });
        const source = `${driver.kind === 'BROWSER' ? 'booking-flow' : 'api'}:${(cached.driver ?? driver.name).replace(' (reused)', '')}`;
        await this.deps.searchService.applyVerifiedFare(itineraryId, { amount: cached.finalPrice, currency: cached.finalCurrency, amountEur: cached.finalPriceEur, verifiedAt: cached.finishedAt?.toISOString() ?? this.now().toISOString(), source, breakdown: cached.breakdown });
        await this.ensureTopVerified(runId);
        return id;
      }
    }
    await this.deps.repos.createVerification({
      id,
      itineraryId,
      searchRunId: runId,
      status: driver ? 'QUEUED' : 'UNSUPPORTED',
      driver: driver?.name ?? null,
      priority,
      requestedAt: this.now(),
      quotedFare: journey.itinerary.fare,
      quotedCurrency: journey.itinerary.currency,
      error: driver ? null : `No booking-flow driver for provider "${journey.itinerary.provider}" / airline ${journey.itinerary.primaryAirline}`,
      finishedAt: driver ? null : this.now(),
    });
    this.kick();
    return id;
  }

  /** On startup: jobs left RUNNING by a previous process go back to the queue, then processing resumes. */
  async recover(): Promise<void> {
    const reset = await this.deps.repos.resetRunningVerifications();
    if (reset > 0) this.deps.log.warn({ reset }, 'requeued verifications interrupted by a restart');
    this.kick();
  }

  /** Starts processing without waiting (fire and forget). */
  kick(): void {
    if (!this.deps.enabled || this.stopped) return;
    if (!this.pumping) {
      this.pumping = this.pump().finally(() => {
        this.pumping = null;
      });
    }
  }

  /** Processes the queue until it is empty (used by tests and the API). */
  async drain(): Promise<void> {
    this.kick();
    while (this.pumping) await this.pumping;
  }

  private async pump(): Promise<void> {
    while (!this.stopped) {
      if (this.active >= this.deps.concurrency) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      let job: { id: string; itineraryId: string; attempts: number } | null;
      try {
        job = await this.deps.repos.claimNextVerification(this.now());
      } catch (e) {
        this.stats.lastError = e instanceof Error ? e.message : String(e);
        this.deps.log.error({ err: this.stats.lastError }, 'verification queue claim failed');
        return;
      }
      if (!job) {
        if (this.active === 0) return;
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      this.active++;
      void this.process(job.id, job.itineraryId, job.attempts)
        .catch((e: unknown) => {
          this.stats.lastError = e instanceof Error ? e.message : String(e);
          this.deps.log.error({ err: this.stats.lastError, verificationId: job!.id }, 'verification crashed');
        })
        .finally(() => {
          this.active--;
        });
    }
  }

  private async process(id: string, itineraryId: string, attempts: number): Promise<void> {
    const repos = this.deps.repos;
    const journey = await repos.getJourney(itineraryId);
    if (!journey) {
      await repos.updateVerification(id, { status: 'FAILED', error: 'Itinerary disappeared', finishedAt: this.now() });
      return;
    }
    const driver = this.driverFor(journey.itinerary);
    if (!driver) {
      await repos.updateVerification(id, { status: 'UNSUPPORTED', error: 'No driver', finishedAt: this.now() });
      return;
    }
    const dir = path.join(this.deps.dataDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const log = (m: string): void => this.deps.log.info({ verificationId: id }, m);
    try {
      const result = await driver.verify({ verificationId: id, itinerary: journey.itinerary, passengers: passengersOf(journey), browser: () => this.deps.browser.get(), screenshotDir: dir, selfBaseUrl: this.deps.selfBaseUrl(), log });
      const settings = await repos.getSettings();
      const finalPriceEur = convertToEur(result.finalPrice, result.currency, settings.home.fxRatesToEur);
      const verifiedAt = this.now().toISOString();
      const verifiedFare: VerifiedFare = { amount: result.finalPrice, currency: result.currency, amountEur: finalPriceEur, verifiedAt, source: `${driver.kind === 'BROWSER' ? 'booking-flow' : 'api'}:${driver.name}`, breakdown: result.breakdown };
      await repos.updateVerification(id, { status: 'VERIFIED', finalPrice: result.finalPrice, finalCurrency: result.currency, finalPriceEur, breakdown: result.breakdown, steps: result.steps, finishedAt: this.now(), error: null });
      await repos.addObservation({
        observedAt: verifiedAt,
        originAirport: journey.itinerary.originAirport,
        arrivalGateway: journey.itinerary.arrivalGateway,
        outboundDate: journey.itinerary.outbound.departureLocal.slice(0, 10),
        inboundDate: journey.itinerary.inbound.departureLocal.slice(0, 10),
        airline: journey.itinerary.primaryAirline,
        cabin: journey.itinerary.cabinSummary.requestedCabin,
        fare: result.finalPrice,
        currency: result.currency,
        fareEur: finalPriceEur,
        provider: verifiedFare.source,
        itineraryFingerprint: journey.itinerary.fingerprint,
        searchRunId: await repos.getItineraryRunId(itineraryId),
      });
      await this.deps.searchService.applyVerifiedFare(itineraryId, verifiedFare);
      this.stats.processed++;
      this.stats.verified++;
      this.deps.log.info({ verificationId: id, itineraryId, finalPriceEur }, 'final price verified');
      await this.ensureTopVerified(await repos.getItineraryRunId(itineraryId));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const steps: VerificationStep[] = e instanceof VerificationError ? e.steps : [{ name: 'verify', at: this.now().toISOString(), ok: false, note: message }];
      const retry = attempts + 1 < (this.deps.maxAttempts ?? 2);
      await repos.updateVerification(id, { status: retry ? 'QUEUED' : 'FAILED', steps, error: message, finishedAt: retry ? null : this.now() });
      this.stats.processed++;
      if (!retry) this.stats.failed++;
      this.stats.lastError = message;
      this.deps.log.warn({ verificationId: id, err: message, retry }, 'verification failed');
    }
  }

  async status(): Promise<VerificationWorkerStatus> {
    return {
      enabled: this.deps.enabled,
      running: this.active,
      queued: await this.deps.repos.countVerifications('QUEUED'),
      concurrency: this.deps.concurrency,
      drivers: this.deps.drivers.map((d) => ({ name: d.name, kind: d.kind })),
      browser: { running: this.deps.browser.isRunning, executablePath: this.deps.browser.executablePath() ?? null, lastError: this.deps.browser.lastError },
      ...this.stats,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pumping) await this.pumping.catch(() => undefined);
    await this.deps.browser.close();
  }
}

function passengersOf(j: ScoredJourney): number {
  const raw = j.itinerary.rawProviderReference as { passengers?: number } | null;
  const fromOffer = j.itinerary.providerOfferId.split('|')[5];
  return raw?.passengers ?? (fromOffer ? Number(fromOffer) || 1 : 1);
}
