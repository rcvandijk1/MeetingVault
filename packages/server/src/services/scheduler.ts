import { buildDealAlert, type NotificationProvider, type ScoredJourney } from '@kfr/core';
import type { Repositories } from '../repositories/index.js';
import type { SearchService } from './searchService.js';

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  lastRunStatus: 'COMPLETED' | 'FAILED' | null;
  lastError: string | null;
  nextRunAt: string | null;
  runsCompleted: number;
  alertsSent: number;
}

export interface SchedulerDeps {
  repos: Repositories;
  searchService: SearchService;
  notifier: NotificationProvider;
  intervalHours: number;
  enabled: boolean;
  now?: () => Date;
  log?: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void };
}

/**
 * Basic background scheduler: every N hours run the default profile's search,
 * store observations (done by the search service) and notify about journeys
 * that are new or cheaper than previously seen and above the alert thresholds.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private status: SchedulerStatus;
  private readonly now: () => Date;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.status = { enabled: deps.enabled, running: false, intervalHours: deps.intervalHours, lastRunAt: null, lastRunStatus: null, lastError: null, nextRunAt: null, runsCompleted: 0, alertsSent: 0 };
  }

  start(): void {
    if (!this.deps.enabled || this.timer) return;
    const ms = this.deps.intervalHours * 3600000;
    this.status.nextRunAt = new Date(this.now().getTime() + ms).toISOString();
    this.timer = setInterval(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.nextRunAt = null;
  }

  getStatus(): SchedulerStatus {
    return { ...this.status };
  }

  /** Runs one scheduled cycle now (also used by the API's "run now"). */
  async tick(): Promise<{ runId: string | null; alerts: number }> {
    if (this.status.running) return { runId: null, alerts: 0 };
    this.status.running = true;
    try {
      const profiles = await this.deps.repos.listProfiles();
      let alerts = 0;
      let runId: string | null = null;
      for (const profile of profiles.filter((p) => p.isDefault)) {
        // Snapshot which itineraries were known before the run so "new" can be determined.
        const outcome = await this.deps.searchService.runSearch({ profileId: profile.id, trigger: 'SCHEDULED' });
        runId = outcome.run.id;
        alerts += await this.notify(outcome.journeys);
      }
      this.status.runsCompleted++;
      this.status.alertsSent += alerts;
      this.status.lastRunStatus = 'COMPLETED';
      this.status.lastError = null;
      return { runId, alerts };
    } catch (err) {
      this.status.lastRunStatus = 'FAILED';
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.deps.log?.error({ err: this.status.lastError }, 'scheduled search failed');
      return { runId: null, alerts: 0 };
    } finally {
      this.status.running = false;
      this.status.lastRunAt = this.now().toISOString();
      if (this.timer) this.status.nextRunAt = new Date(this.now().getTime() + this.deps.intervalHours * 3600000).toISOString();
    }
  }

  private async notify(journeys: ScoredJourney[]): Promise<number> {
    const { alertThresholds } = await this.deps.repos.getSettings();
    let sent = 0;
    for (const j of journeys) {
      const alert = buildDealAlert(j, alertThresholds, this.now().toISOString());
      if (alert.channel === 'DASHBOARD') continue;
      const known = await this.deps.repos.getKnownItinerary(j.itinerary.fingerprint);
      const isNew = !known || known.timesSeen <= 1;
      const cheaperThanBefore = known ? j.itinerary.fareEur < known.lowestFareEur || j.itinerary.fareEur <= known.latestFareEur - 1 : false;
      if (!isNew && !cheaperThanBefore) continue;
      await this.deps.notifier.send(alert);
      sent++;
    }
    return sent;
  }
}
