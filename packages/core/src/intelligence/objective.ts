import type { Airport, CabinQualityAssessment, CabinQualityLabel, CabinSummary, FareIntelligenceConfig, TravelObjective } from '../types.js';
import { daysBetween } from '../time.js';

/** Route family id of a gateway, or null when the gateway does not serve the objective. */
export function routeFamilyFor(gateway: string, objective: TravelObjective): string | null {
  return objective.gateways.some((g) => g.code === gateway) ? objective.id : null;
}

/** Origin region id (cohort level 3) derived from the airport's country. Unknown countries form their own region. */
export function originRegionFor(airportCode: string, airports: Record<string, Airport>, objective: TravelObjective): string {
  const country = airports[airportCode]?.country;
  if (!country) return `AIRPORT:${airportCode}`;
  for (const [region, countries] of Object.entries(objective.originRegions)) if (countries.includes(country)) return region;
  return `COUNTRY:${country}`;
}

export type Season = 'WINTER' | 'SPRING' | 'SUMMER' | 'AUTUMN';

/** Meteorological season of a YYYY-MM-DD travel date (Dec–Feb winter, …). */
export function seasonOf(date: string): Season {
  const m = Number(date.slice(5, 7));
  if (m === 12 || m <= 2) return 'WINTER';
  if (m <= 5) return 'SPRING';
  if (m <= 8) return 'SUMMER';
  return 'AUTUMN';
}

/** Label of the advance-purchase band containing `daysToDeparture`, e.g. "31-60" or "365+". */
export function advancePurchaseBand(daysToDeparture: number, edges: number[]): string {
  const sorted = [...edges].sort((a, b) => a - b);
  let lower = 0;
  for (const edge of sorted) {
    if (daysToDeparture <= edge) return `${lower}-${edge}`;
    lower = edge + 1;
  }
  return `${sorted[sorted.length - 1] ?? 0}+`;
}

export function daysToDeparture(observedAtIso: string, outboundDate: string): number {
  return daysBetween(observedAtIso.slice(0, 10), outboundDate);
}

/** Trip-length band label for a target trip (± tolerance days). */
export function tripDaysBand(tripDays: number, tolerance: number): string {
  return `${Math.max(1, tripDays - tolerance)}-${tripDays + tolerance} days`;
}

/**
 * Duration-weighted cabin quality: FULL when every segment is in the requested
 * cabin or better; MOSTLY when all long-haul segments are and the majority of
 * air time is; MIXED otherwise (a long-haul segment below the requested cabin).
 */
export function cabinQualityLabel(summary: Pick<CabinSummary, 'premiumCabinPercent' | 'longHaulPremiumPercent'>): CabinQualityLabel {
  if (summary.premiumCabinPercent >= 99.5) return 'FULL';
  if (summary.longHaulPremiumPercent >= 99.5 && summary.premiumCabinPercent >= 60) return 'MOSTLY';
  return 'MIXED';
}

export function assessCabinQuality(summary: CabinSummary, cfg: Pick<FareIntelligenceConfig, 'cabinQualityPenalty'>): CabinQualityAssessment {
  const label = cabinQualityLabel(summary);
  const penalty = label === 'FULL' ? 0 : label === 'MOSTLY' ? cfg.cabinQualityPenalty.mostly : cfg.cabinQualityPenalty.mixed;
  return { label, premiumCabinPercent: summary.premiumCabinPercent, longHaulPremiumPercent: summary.longHaulPremiumPercent, penalty };
}

export const CABIN_QUALITY_TEXT: Record<CabinQualityLabel, string> = { FULL: 'Full', MOSTLY: 'Mostly', MIXED: 'Mixed' };
