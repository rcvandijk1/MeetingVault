import type { Cabin, DateFareEstimate, FlightSearchRequest, NormalizedItinerary } from '../types.js';
import type { FlightSearchProvider } from './types.js';
import type { NormalizeOptions } from '../normalize.js';
import { addDays, eachDate } from '../time.js';

export interface SearchPlan {
  origins: string[];
  gateways: string[];
  outboundEarliestDate: string;
  outboundLatestDate: string;
  returnEarliestDate: string;
  returnLatestDate: string;
  minTripDays: number;
  preferredTripDaysMin: number;
  preferredTripDaysMax: number;
  maxTripDays: number;
  passengers: number;
  cabin: Cabin;
  feederEconomyAllowed: boolean;
  maxConnections: number;
  /** Stage B budget: number of live (origin, gateway, dates) searches. */
  maxValidationCandidates: number;
}

export interface Candidate {
  origin: string;
  gateway: string;
  outboundDate: string;
  returnDate: string;
  estimatedFareEur: number | null;
  source: 'DISCOVERY' | 'SAMPLED';
}

export interface ProviderUsageEvent {
  provider: string;
  kind: 'search' | 'discover' | 'refresh' | 'health';
  request: unknown;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  error: string | null;
  resultCount: number;
  cached: boolean;
}

export interface ProviderFailure {
  provider: string;
  error: string;
  time: string;
  request: unknown;
}

export interface OrchestratorResult {
  itineraries: NormalizedItinerary[];
  candidates: Candidate[];
  failures: ProviderFailure[];
  usage: ProviderUsageEvent[];
  stats: { datePairs: number; discoveryCalls: number; searchCalls: number; cacheHits: number; providersUsed: string[] };
}

export interface OrchestratorOptions {
  maxConcurrency?: number;
  minIntervalMs?: number;
  cacheTtlMs?: number;
  now?: () => Date;
  onUsage?: (e: ProviderUsageEvent) => void;
  /** Upper bound of outbound dates considered per window (evenly sampled). */
  maxOutboundDates?: number;
  /** Number of return dates per outbound date (spread across the preferred trip length). */
  returnDatesPerOutbound?: number;
}

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => this.queue.push(() => {
      this.active++;
      resolve(() => this.release());
    }));
  }
  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** Enumerates the date pairs of a plan, bounded and evenly sampled. */
export function enumerateDatePairs(plan: SearchPlan, maxOutboundDates = 12, returnDatesPerOutbound = 3): Array<{ outboundDate: string; returnDate: string }> {
  const allOut = [...eachDate(plan.outboundEarliestDate, plan.outboundLatestDate)];
  const outs = sampleEvenly(allOut, maxOutboundDates);
  const pairs: Array<{ outboundDate: string; returnDate: string }> = [];
  const seen = new Set<string>();
  for (const o of outs) {
    const lengths = sampleEvenly(range(plan.preferredTripDaysMin, plan.preferredTripDaysMax), returnDatesPerOutbound);
    for (const len of lengths) {
      const r = addDays(o, len);
      if (r < plan.returnEarliestDate || r > plan.returnLatestDate) continue;
      if (len < plan.minTripDays || len > plan.maxTripDays) continue;
      const key = `${o}|${r}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ outboundDate: o, returnDate: r });
    }
  }
  return pairs;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  if (max <= 1) return [items[0]!];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]!);
  return [...new Set(out)];
}

/**
 * Two-stage search: Stage A discovers promising (origin, gateway, dates)
 * combinations cheaply; Stage B validates the best of them with live
 * detailed searches. Bounded concurrency, per-provider minimum interval,
 * TTL cache and usage logging keep API cost under control.
 */
export class SearchOrchestrator {
  private readonly providers: FlightSearchProvider[];
  private readonly semaphore: Semaphore;
  private readonly minInterval: number;
  private readonly cacheTtl: number;
  private readonly now: () => Date;
  private readonly onUsage?: (e: ProviderUsageEvent) => void;
  private readonly maxOutboundDates: number;
  private readonly returnDatesPerOutbound: number;
  private lastCallAt = new Map<string, number>();
  private cache = new Map<string, { at: number; value: NormalizedItinerary[] }>();

  constructor(providers: FlightSearchProvider[], opts: OrchestratorOptions = {}) {
    this.providers = providers;
    this.semaphore = new Semaphore(opts.maxConcurrency ?? 3);
    this.minInterval = opts.minIntervalMs ?? 0;
    this.cacheTtl = opts.cacheTtlMs ?? 30 * 60000;
    this.now = opts.now ?? (() => new Date());
    this.onUsage = opts.onUsage;
    this.maxOutboundDates = opts.maxOutboundDates ?? 12;
    this.returnDatesPerOutbound = opts.returnDatesPerOutbound ?? 3;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /** Per-provider minimum interval between calls; only live providers are rate limited. */
  private async throttle(provider: FlightSearchProvider): Promise<void> {
    if (this.minInterval <= 0 || !provider.capabilities.live) return;
    const last = this.lastCallAt.get(provider.name) ?? 0;
    const wait = last + this.minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt.set(provider.name, Date.now());
  }

  private async call<T>(provider: FlightSearchProvider, kind: ProviderUsageEvent['kind'], request: unknown, fn: () => Promise<T>, count: (r: T) => number, usage: ProviderUsageEvent[], failures: ProviderFailure[]): Promise<T | null> {
    const release = await this.semaphore.acquire();
    const started = Date.now();
    try {
      await this.throttle(provider);
      const result = await fn();
      const e: ProviderUsageEvent = { provider: provider.name, kind, request, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: true, error: null, resultCount: count(result), cached: false };
      usage.push(e);
      this.onUsage?.(e);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const e: ProviderUsageEvent = { provider: provider.name, kind, request, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ok: false, error: message, resultCount: 0, cached: false };
      usage.push(e);
      this.onUsage?.(e);
      failures.push({ provider: provider.name, error: message, time: this.now().toISOString(), request });
      return null;
    } finally {
      release();
    }
  }

  /** Stage A: discovery. */
  async discover(plan: SearchPlan, usage: ProviderUsageEvent[], failures: ProviderFailure[]): Promise<{ candidates: Candidate[]; datePairs: number; calls: number }> {
    const pairs = enumerateDatePairs(plan, this.maxOutboundDates, this.returnDatesPerOutbound);
    const outboundDates = [...new Set(pairs.map((p) => p.outboundDate))];
    const returnDates = [...new Set(pairs.map((p) => p.returnDate))];
    const discoverers = this.providers.filter((p) => p.capabilities.discovery && p.discover);
    const estimates: DateFareEstimate[] = [];
    let calls = 0;
    if (discoverers.length > 0) {
      const tasks: Array<Promise<void>> = [];
      for (const origin of plan.origins) {
        for (const gateway of plan.gateways) {
          for (const p of discoverers) {
            const req = { origin, destination: gateway, outboundDates, returnDates, passengers: plan.passengers, cabin: plan.cabin };
            calls++;
            tasks.push(
              this.call(p, 'discover', req, () => p.discover!(req), (r) => r.length, usage, failures).then((r) => {
                if (r) estimates.push(...r);
              }),
            );
          }
        }
      }
      await Promise.all(tasks);
    }
    const pairSet = new Set(pairs.map((p) => `${p.outboundDate}|${p.returnDate}`));
    const byKey = new Map<string, Candidate>();
    for (const e of estimates) {
      if (!pairSet.has(`${e.outboundDate}|${e.returnDate}`)) continue;
      const key = `${e.origin}|${e.destination}|${e.outboundDate}|${e.returnDate}`;
      const existing = byKey.get(key);
      if (!existing || (existing.estimatedFareEur ?? Infinity) > e.estimatedFareEur) {
        byKey.set(key, { origin: e.origin, gateway: e.destination, outboundDate: e.outboundDate, returnDate: e.returnDate, estimatedFareEur: e.estimatedFareEur, source: 'DISCOVERY' });
      }
    }
    // Origins/gateways without discovery data still get sampled candidates so nothing is silently dropped.
    for (const origin of plan.origins) {
      for (const gateway of plan.gateways) {
        const has = [...byKey.values()].some((c) => c.origin === origin && c.gateway === gateway);
        if (has) continue;
        for (const pair of sampleEvenly(pairs, 4)) {
          byKey.set(`${origin}|${gateway}|${pair.outboundDate}|${pair.returnDate}`, { origin, gateway, ...pair, estimatedFareEur: null, source: 'SAMPLED' });
        }
      }
    }
    return { candidates: [...byKey.values()], datePairs: pairs.length, calls };
  }

  /** Picks the Stage B candidates: guaranteed coverage per origin/gateway, then the cheapest estimates. */
  selectCandidates(candidates: Candidate[], budget: number, origins: string[], gateways: string[]): Candidate[] {
    const sorted = [...candidates].sort((a, b) => (a.estimatedFareEur ?? Infinity) - (b.estimatedFareEur ?? Infinity) || a.outboundDate.localeCompare(b.outboundDate));
    const chosen: Candidate[] = [];
    const chosenKeys = new Set<string>();
    const key = (c: Candidate): string => `${c.origin}|${c.gateway}|${c.outboundDate}|${c.returnDate}`;
    const perPair = Math.max(1, Math.floor(budget / Math.max(1, origins.length * gateways.length)));
    for (const origin of origins) {
      for (const gateway of gateways) {
        for (const c of sorted.filter((x) => x.origin === origin && x.gateway === gateway).slice(0, perPair)) {
          if (chosen.length >= budget) break;
          chosenKeys.add(key(c));
          chosen.push(c);
        }
      }
    }
    for (const c of sorted) {
      if (chosen.length >= budget) break;
      if (chosenKeys.has(key(c))) continue;
      chosenKeys.add(key(c));
      chosen.push(c);
    }
    return chosen;
  }

  /** Stage B: live validation searches. */
  async validate(plan: SearchPlan, candidates: Candidate[], normalize: NormalizeOptions, usage: ProviderUsageEvent[], failures: ProviderFailure[]): Promise<{ itineraries: NormalizedItinerary[]; calls: number; cacheHits: number }> {
    const itineraries: NormalizedItinerary[] = [];
    let calls = 0;
    let cacheHits = 0;
    const nowMs = this.now().getTime();
    const tasks: Array<Promise<void>> = [];
    for (const c of candidates) {
      const req: FlightSearchRequest = { origin: c.origin, destination: c.gateway, outboundDate: c.outboundDate, returnDate: c.returnDate, passengers: plan.passengers, cabin: plan.cabin, feederEconomyAllowed: plan.feederEconomyAllowed, maxConnections: plan.maxConnections };
      for (const p of this.providers) {
        const cacheKey = `${p.name}|${req.origin}|${req.destination}|${req.outboundDate}|${req.returnDate}|${req.cabin}|${req.passengers}|${req.maxConnections}`;
        const cached = this.cache.get(cacheKey);
        if (cached && nowMs - cached.at < this.cacheTtl) {
          cacheHits++;
          itineraries.push(...cached.value);
          const e: ProviderUsageEvent = { provider: p.name, kind: 'search', request: req, startedAt: this.now().toISOString(), durationMs: 0, ok: true, error: null, resultCount: cached.value.length, cached: true };
          usage.push(e);
          this.onUsage?.(e);
          continue;
        }
        calls++;
        tasks.push(
          this.call(p, 'search', req, () => p.search(req, normalize), (r) => r.length, usage, failures).then((r) => {
            if (r) {
              this.cache.set(cacheKey, { at: nowMs, value: r });
              itineraries.push(...r);
            }
          }),
        );
      }
    }
    await Promise.all(tasks);
    return { itineraries, calls, cacheHits };
  }

  async run(plan: SearchPlan, normalize: NormalizeOptions): Promise<OrchestratorResult> {
    const usage: ProviderUsageEvent[] = [];
    const failures: ProviderFailure[] = [];
    const discovery = await this.discover(plan, usage, failures);
    const selected = this.selectCandidates(discovery.candidates, plan.maxValidationCandidates, plan.origins, plan.gateways);
    const validation = await this.validate(plan, selected, normalize, usage, failures);
    return {
      itineraries: validation.itineraries,
      candidates: selected,
      failures,
      usage,
      stats: { datePairs: discovery.datePairs, discoveryCalls: discovery.calls, searchCalls: validation.calls, cacheHits: validation.cacheHits, providersUsed: this.providers.map((p) => p.name) },
    };
  }

  private pendingUsage: ProviderUsageEvent[] = [];

  /** Re-prices a single offer with its provider. Usage is collected and available through `drainUsage()`. */
  async refresh(itinerary: NormalizedItinerary, normalize: NormalizeOptions): Promise<{ itinerary: NormalizedItinerary | null; failure: ProviderFailure | null }> {
    const provider = this.providers.find((p) => p.name === itinerary.provider);
    if (!provider || !provider.refreshOffer || !provider.capabilities.refresh) return { itinerary: null, failure: null };
    const failures: ProviderFailure[] = [];
    const refreshed = await this.call(provider, 'refresh', { providerOfferId: itinerary.providerOfferId }, () => provider.refreshOffer!(itinerary.providerOfferId, normalize), (r) => (r ? 1 : 0), this.pendingUsage, failures);
    return { itinerary: refreshed ?? null, failure: failures[0] ?? null };
  }

  /** Returns and clears usage events recorded outside of `run()` (i.e. by `refresh()`). */
  drainUsage(): ProviderUsageEvent[] {
    const out = this.pendingUsage;
    this.pendingUsage = [];
    return out;
  }

  async health(): Promise<Array<Awaited<ReturnType<FlightSearchProvider['healthCheck']>>>> {
    return Promise.all(this.providers.map((p) => p.healthCheck()));
  }
}
