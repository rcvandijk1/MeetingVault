import type { CabinQualityLabel, DealLevel, FareConfidence, ScoredJourney } from '@kfr/core';
import { routeKey } from './format';

export type SortKey = 'score' | 'airfare' | 'trueCost' | 'doorToDoor' | 'departure' | 'arrival' | 'savingPerExtraHour' | 'dealScore' | 'percentOfMedian' | 'savingVsMedian';

export const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'score', label: 'Overall score' },
  { key: 'airfare', label: 'Airfare' },
  { key: 'trueCost', label: 'True journey cost' },
  { key: 'doorToDoor', label: 'Door-to-door time' },
  { key: 'departure', label: 'Departure time' },
  { key: 'arrival', label: 'Arrival time' },
  { key: 'savingPerExtraHour', label: 'Saving per extra hour' },
  { key: 'dealScore', label: 'Fare deal score' },
  { key: 'percentOfMedian', label: '% of historical median' },
  { key: 'savingVsMedian', label: 'Saving vs median' },
];

export interface ResultFilters {
  minScore: number;
  maxAirfare: number | null;
  maxTrueCost: number | null;
  origins: string[];
  gateways: string[];
  airlines: string[];
  maxTransfers: number | null;
  maxLayoverMinutes: number | null;
  maxDoorToDoorMinutes: number | null;
  hotel: 'any' | 'no' | 'yes';
  selfTransfer: 'any' | 'no' | 'yes';
  cabins: string[];
  dealLevels: DealLevel[];
  minDealScore: number;
  confidences: FareConfidence[];
  cabinQualities: CabinQualityLabel[];
  opportunitiesOnly: boolean;
  outboundFrom: string;
  outboundTo: string;
  nonDominatedOnly: boolean;
  collapseSimilar: boolean;
}

export const EMPTY_FILTERS: ResultFilters = {
  minScore: 0,
  maxAirfare: null,
  maxTrueCost: null,
  origins: [],
  gateways: [],
  airlines: [],
  maxTransfers: null,
  maxLayoverMinutes: null,
  maxDoorToDoorMinutes: null,
  hotel: 'any',
  selfTransfer: 'any',
  cabins: [],
  dealLevels: [],
  minDealScore: 0,
  confidences: [],
  cabinQualities: [],
  opportunitiesOnly: false,
  outboundFrom: '',
  outboundTo: '',
  nonDominatedOnly: false,
  collapseSimilar: true,
};

export function applyFilters(journeys: ScoredJourney[], f: ResultFilters): ScoredJourney[] {
  return journeys.filter((j) => {
    const it = j.itinerary;
    if (j.overallScore < f.minScore) return false;
    if (f.maxAirfare !== null && it.fareEur > f.maxAirfare) return false;
    if (f.maxTrueCost !== null && j.cost.trueJourneyCost > f.maxTrueCost) return false;
    if (f.origins.length && !f.origins.includes(it.originAirport)) return false;
    if (f.gateways.length && !f.gateways.includes(it.arrivalGateway)) return false;
    if (f.airlines.length && !f.airlines.includes(it.primaryAirline)) return false;
    if (f.maxTransfers !== null && Math.max(it.outbound.transfers, it.inbound.transfers) > f.maxTransfers) return false;
    if (f.maxLayoverMinutes !== null && Math.max(it.outbound.longestConnectionMinutes, it.inbound.longestConnectionMinutes) > f.maxLayoverMinutes) return false;
    if (f.maxDoorToDoorMinutes !== null && j.doorToKrabiMinutes > f.maxDoorToDoorMinutes) return false;
    if (f.hotel === 'no' && (j.hotelOutbound.required || j.hotelReturn.required)) return false;
    if (f.hotel === 'yes' && !(j.hotelOutbound.required || j.hotelReturn.required)) return false;
    if (f.selfTransfer === 'no' && it.selfTransfers > 0) return false;
    if (f.selfTransfer === 'yes' && it.selfTransfers === 0) return false;
    if (f.cabins.length && !f.cabins.includes(it.cabinSummary.requestedCabin)) return false;
    if (f.dealLevels.length && !f.dealLevels.includes(j.deal.level)) return false;
    if (f.minDealScore > 0 && (j.deal.dealScore ?? -1) < f.minDealScore) return false;
    if (f.confidences.length && !f.confidences.includes(j.deal.confidence)) return false;
    if (f.cabinQualities.length && !f.cabinQualities.includes(j.deal.cabinQuality.label)) return false;
    if (f.opportunitiesOnly && j.deal.opportunities.length === 0) return false;
    const outDate = it.outbound.departureLocal.slice(0, 10);
    if (f.outboundFrom && outDate < f.outboundFrom) return false;
    if (f.outboundTo && outDate > f.outboundTo) return false;
    if (f.nonDominatedOnly && j.paretoDominated) return false;
    return true;
  });
}

export function sortJourneys(journeys: ScoredJourney[], key: SortKey, dir: 'asc' | 'desc'): ScoredJourney[] {
  const val = (j: ScoredJourney): number => {
    switch (key) {
      case 'score':
        return j.overallScore;
      case 'airfare':
        return j.itinerary.fareEur;
      case 'trueCost':
        return j.cost.trueJourneyCost;
      case 'doorToDoor':
        return j.doorToKrabiMinutes;
      case 'departure':
        return new Date(j.itinerary.outbound.departureUtc).getTime();
      case 'arrival':
        return new Date(j.itinerary.outbound.arrivalUtc).getTime();
      case 'savingPerExtraHour':
        return j.baseline.savingPerExtraHour ?? (j.baseline.dominant ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      case 'dealScore':
        return j.deal.dealScore ?? -1;
      case 'percentOfMedian':
        return j.deal.percentOfMedian ?? Number.POSITIVE_INFINITY;
      case 'savingVsMedian':
        return j.deal.savingVsMedianEur ?? Number.NEGATIVE_INFINITY;
    }
  };
  const m = dir === 'asc' ? 1 : -1;
  return [...journeys].sort((a, b) => (val(a) - val(b)) * m || a.rank - b.rank);
}

export const DEFAULT_SORT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  score: 'desc',
  airfare: 'asc',
  trueCost: 'asc',
  doorToDoor: 'asc',
  departure: 'asc',
  arrival: 'asc',
  savingPerExtraHour: 'desc',
  dealScore: 'desc',
  percentOfMedian: 'asc',
  savingVsMedian: 'desc',
};

export interface JourneyGroup {
  key: string;
  best: ScoredJourney;
  others: ScoredJourney[];
}

/** Collapses near-identical results (same route, airline and cabin on other dates) under the best one. */
export function groupSimilar(sorted: ScoredJourney[], collapse: boolean): JourneyGroup[] {
  if (!collapse) return sorted.map((j) => ({ key: j.itinerary.id, best: j, others: [] }));
  const groups = new Map<string, JourneyGroup>();
  const order: string[] = [];
  for (const j of sorted) {
    const k = routeKey(j);
    const g = groups.get(k);
    if (!g) {
      groups.set(k, { key: k, best: j, others: [] });
      order.push(k);
    } else {
      g.others.push(j);
    }
  }
  return order.map((k) => groups.get(k)!);
}

export function distinct<T>(items: T[]): T[] {
  return [...new Set(items)];
}
