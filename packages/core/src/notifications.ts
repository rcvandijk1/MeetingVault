import type { AlertThresholds, DealLevel, ScoredJourney } from './types.js';

export type AlertChannel = 'DASHBOARD' | 'DIGEST' | 'NOTIFICATION' | 'IMMEDIATE' | 'URGENT';

export interface DealAlert {
  itineraryId: string;
  fingerprint: string;
  channel: AlertChannel;
  level: DealLevel;
  overallScore: number;
  title: string;
  body: string;
  createdAt: string;
}

/**
 * Notification delivery abstraction. Concrete providers (Telegram, e-mail,
 * push) implement `send`; the scheduler decides what to send using
 * `alertChannelFor`.
 */
export interface NotificationProvider {
  readonly name: string;
  send(alert: DealAlert): Promise<void>;
}

export function alertChannelFor(overallScore: number, t: AlertThresholds): AlertChannel {
  if (overallScore >= t.urgent) return 'URGENT';
  if (overallScore >= t.immediate) return 'IMMEDIATE';
  if (overallScore >= t.notification) return 'NOTIFICATION';
  if (overallScore >= t.digest) return 'DIGEST';
  return 'DASHBOARD';
}

export function buildDealAlert(j: ScoredJourney, thresholds: AlertThresholds, now: string): DealAlert {
  const it = j.itinerary;
  const route = [it.originAirport, ...it.outbound.connections.map((c) => c.airport), it.arrivalGateway].join(' → ');
  return {
    itineraryId: it.id,
    fingerprint: it.fingerprint,
    channel: alertChannelFor(j.overallScore, thresholds),
    level: j.deal.level,
    overallScore: j.overallScore,
    title: `${j.deal.level} · ${Math.round(j.overallScore)}/100 · ${route}`,
    body: `${it.primaryAirlineName ?? it.primaryAirline} ${it.cabinSummary.requestedCabin.toLowerCase()} · airfare €${Math.round(it.fareEur)} · true cost €${Math.round(j.cost.trueJourneyCost)} · door-to-Krabi ${Math.round(j.doorToKrabiMinutes / 60)}h`,
    createdAt: now,
  };
}

export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = 'log';
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async send(alert: DealAlert): Promise<void> {
    this.log(`[alert:${alert.channel}] ${alert.title} — ${alert.body}`);
  }
}

export class NoopNotificationProvider implements NotificationProvider {
  readonly name = 'none';
  async send(): Promise<void> {
    /* intentionally empty */
  }
}
