import type { FareIntelligenceConfig, FareObservation, FareTrend } from '../types.js';
import { median } from './stats.js';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Price movement of one physical itinerary across earlier observations.
 * `history` may contain any observations; only those with the fingerprint are
 * used. The current fare is never part of the medians it is compared with.
 */
export function fareTrend(fingerprint: string, currentFareEur: number, history: FareObservation[], now: string, cfg: Pick<FareIntelligenceConfig, 'recentDays' | 'rollingDays'>): FareTrend | null {
  const own = history.filter((o) => o.itineraryFingerprint === fingerprint && Number.isFinite(o.fareEur) && o.fareEur > 0 && o.observedAt < now).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  if (own.length === 0) return null;
  const nowMs = new Date(now).getTime();
  const within = (days: number): number[] => own.filter((o) => nowMs - new Date(o.observedAt).getTime() <= days * 86400000).map((o) => o.fareEur);
  const first = own[0]!;
  const previous = own[own.length - 1]!;
  const fares = own.map((o) => o.fareEur);
  const lowest = Math.min(...fares);
  const highest = Math.max(...fares);
  const median7 = median(within(cfg.recentDays));
  const median30 = median(within(cfg.rollingDays));
  const changeEur = currentFareEur - previous.fareEur;
  return {
    fingerprint,
    timesSeenBefore: own.length,
    firstSeenAt: first.observedAt,
    firstSeenFareEur: first.fareEur,
    previousObservedAt: previous.observedAt,
    previousFareEur: previous.fareEur,
    lowestSeenEur: lowest,
    highestSeenEur: highest,
    currentFareEur,
    changeVsPreviousEur: Math.round(changeEur * 100) / 100,
    changeVsPreviousPercent: previous.fareEur > 0 ? round1((changeEur / previous.fareEur) * 100) : null,
    median7dEur: median7,
    median30dEur: median30,
    changeVs30dMedianPercent: median30 && median30 > 0 ? round1(((currentFareEur - median30) / median30) * 100) : null,
    isNewLow: currentFareEur < lowest,
  };
}
