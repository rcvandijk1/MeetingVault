import type { NormalizedItinerary, ScoringParams, TimePreferenceBand, TimePreferenceProfile } from '../types.js';
import { hhmmToMinutes, localMinutesOfDay } from '../time.js';

/** Raw desirability of a minute-of-day according to the bands (0 when no band matches). */
export function bandScoreAt(bands: TimePreferenceBand[], minuteOfDay: number): number {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  for (const b of bands) {
    const start = hhmmToMinutes(b.start);
    const end = hhmmToMinutes(b.end);
    if (start === end) return b.score; // whole day
    if (start < end) {
      if (m >= start && m < end) return b.score;
    } else if (m >= start || m < end) {
      // band crosses midnight
      return b.score;
    }
  }
  return 0;
}

/** Maps a raw band score onto 0..100 relative to the best and worst band of the profile. */
export function normalizeBandScore(bands: TimePreferenceBand[], raw: number): number {
  if (bands.length === 0) return 50;
  const values = bands.map((b) => b.score);
  const min = Math.min(...values, raw);
  const max = Math.max(...values, raw);
  if (max === min) return 100;
  return Math.round(((raw - min) / (max - min)) * 1000) / 10;
}

export function timeOfDayScore(bands: TimePreferenceBand[], localIso: string): number {
  return normalizeBandScore(bands, bandScoreAt(bands, localMinutesOfDay(localIso)));
}

export interface TimingBreakdown {
  outboundDeparture: number;
  outboundArrival: number;
  returnDeparture: number;
  returnArrival: number;
  weighted: number;
}

export function flightTimingBreakdown(it: NormalizedItinerary, prefs: TimePreferenceProfile, params: Pick<ScoringParams, 'timingDepartureWeight' | 'timingArrivalWeight'>): TimingBreakdown {
  const od = timeOfDayScore(prefs.outboundDeparture, it.outbound.departureLocal);
  const oa = timeOfDayScore(prefs.outboundArrival, it.outbound.arrivalLocal);
  const rd = timeOfDayScore(prefs.returnDeparture, it.inbound.departureLocal);
  const ra = timeOfDayScore(prefs.returnArrival, it.inbound.arrivalLocal);
  const wd = params.timingDepartureWeight;
  const wa = params.timingArrivalWeight;
  const denom = 2 * wd + 2 * wa;
  const weighted = denom === 0 ? 50 : (od * wd + oa * wa + rd * wd + ra * wa) / denom;
  return { outboundDeparture: od, outboundArrival: oa, returnDeparture: rd, returnArrival: ra, weighted: Math.round(weighted * 10) / 10 };
}

/**
 * Deterministic long-haul sleep opportunity (0..100): an overnight long-haul
 * segment that departs in the evening and lasts long enough to sleep scores
 * high; a daytime long-haul scores low. No AI involved.
 */
export function sleepOpportunityScore(it: NormalizedItinerary, params: Pick<ScoringParams, 'longHaulMinMinutes'>): number {
  const longHaul = it.segments.filter((s) => s.durationMinutes >= params.longHaulMinMinutes);
  if (longHaul.length === 0) return 0;
  const scores = longHaul.map((s) => {
    const dep = localMinutesOfDay(s.departureLocal);
    // Departure window: best between 20:00 and 00:30 (local), acceptable from 17:00 to 02:00.
    let depScore: number;
    if (dep >= 20 * 60 || dep < 30) depScore = 100;
    else if (dep >= 17 * 60) depScore = 40 + ((dep - 17 * 60) / 180) * 60;
    else if (dep < 120) depScore = 100 - ((dep - 30) / 90) * 60;
    else depScore = 0;
    // Duration: 7h+ gives full sleep credit, 5h gives 40%.
    const durScore = Math.max(0, Math.min(100, ((s.durationMinutes - 300) / 120) * 60 + 40));
    // Arrival in the morning (05:00–12:00) is the natural end of a night flight.
    const arr = localMinutesOfDay(s.arrivalLocal);
    const arrScore = arr >= 5 * 60 && arr < 12 * 60 ? 100 : arr >= 12 * 60 && arr < 15 * 60 ? 60 : 20;
    return depScore * 0.5 + durScore * 0.25 + arrScore * 0.25;
  });
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}
