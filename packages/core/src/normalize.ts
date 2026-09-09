import type { Cabin, CabinSummary, Connection, Direction, FlightSegment, ItineraryLeg, NormalizedItinerary, ProviderFareAlternative } from './types.js';
import { CABIN_RANK } from './types.js';
import { intervalCoversNightHour, minutesBetween } from './time.js';
import { hashString } from './hash.js';
import { convertToEur } from './currency.js';
import { airlineName } from './data/airports.js';

/**
 * A provider-neutral draft of an itinerary. Provider adapters produce this;
 * `buildItinerary` turns it into the immutable normalized model.
 */
export interface ItineraryDraft {
  provider: string;
  providerOfferId: string;
  fare: number;
  currency: string;
  outboundSegments: FlightSegment[];
  inboundSegments: FlightSegment[];
  requestedCabin: Cabin;
  providerExpiresAt: string | null;
  rawProviderReference: unknown;
  /** Segments at least this long are long-haul for cabin percentage purposes. */
  longHaulMinMinutes?: number;
}

export interface NormalizeOptions {
  fxRatesToEur: Record<string, number>;
  /** Extra minutes assumed when baggage must be re-checked on a self-transfer. */
  baggageRecheckExtraMinutes?: number;
  now?: string;
}

const SAME_CITY_AIRPORTS: Record<string, string> = { BKK: 'BANGKOK', DMK: 'BANGKOK' };

function cityKey(code: string): string {
  return SAME_CITY_AIRPORTS[code] ?? code;
}

/** Derives connections from adjacent segments using UTC timestamps. */
export function deriveConnections(segments: FlightSegment[]): Connection[] {
  const out: Connection[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    const minutes = minutesBetween(a.arrivalUtc, b.departureUtc);
    const airportChange = a.destination !== b.origin;
    const selfTransfer = a.ticketGroup !== b.ticketGroup;
    const terminalChange = Boolean(a.destinationTerminal && b.originTerminal && a.destinationTerminal !== b.originTerminal) || airportChange;
    out.push({
      airport: a.destination,
      nextAirport: b.origin,
      type: selfTransfer ? 'SELF_TRANSFER' : 'PROTECTED',
      minutes,
      overnight: intervalCoversNightHour(a.arrivalLocal, b.departureLocal, minutes),
      airportChange,
      terminalChange,
      baggageRecheckExpected: selfTransfer || airportChange,
      arrivalLocal: a.arrivalLocal,
      departureLocal: b.departureLocal,
    });
  }
  return out;
}

export function buildLeg(direction: Direction, segments: FlightSegment[]): ItineraryLeg {
  if (segments.length === 0) throw new Error(`Cannot build ${direction} leg without segments`);
  const connections = deriveConnections(segments);
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const airMinutes = segments.reduce((s, x) => s + x.durationMinutes, 0);
  const connectionMinutes = connections.reduce((s, c) => s + c.minutes, 0);
  return {
    direction,
    segments,
    connections,
    departureUtc: first.departureUtc,
    departureLocal: first.departureLocal,
    arrivalUtc: last.arrivalUtc,
    arrivalLocal: last.arrivalLocal,
    totalMinutes: minutesBetween(first.departureUtc, last.arrivalUtc),
    airMinutes,
    connectionMinutes,
    longestConnectionMinutes: connections.reduce((m, c) => Math.max(m, c.minutes), 0),
    transfers: connections.length,
    protectedConnections: connections.filter((c) => c.type === 'PROTECTED').length,
    selfTransfers: connections.filter((c) => c.type === 'SELF_TRANSFER').length,
  };
}

export function summarizeCabin(segments: FlightSegment[], requestedCabin: Cabin, longHaulMinMinutes = 300): CabinSummary {
  const total = segments.reduce((s, x) => s + x.durationMinutes, 0);
  const premium = segments.filter((s) => CABIN_RANK[s.cabin] >= CABIN_RANK[requestedCabin]).reduce((s, x) => s + x.durationMinutes, 0);
  const longHaul = segments.filter((s) => s.durationMinutes >= longHaulMinMinutes);
  const longHaulTotal = longHaul.reduce((s, x) => s + x.durationMinutes, 0);
  const longHaulPremium = longHaul.filter((s) => CABIN_RANK[s.cabin] >= CABIN_RANK[requestedCabin]).reduce((s, x) => s + x.durationMinutes, 0);
  const ranks = segments.map((s) => CABIN_RANK[s.cabin]);
  const lowest = Math.min(...ranks);
  const highest = Math.max(...ranks);
  const byRank = (r: number): Cabin => (Object.keys(CABIN_RANK) as Cabin[]).find((c) => CABIN_RANK[c] === r) ?? 'ECONOMY';
  const premiumPercent = total === 0 ? 0 : Math.round((premium / total) * 1000) / 10;
  const longHaulPremiumPercent = longHaulTotal === 0 ? premiumPercent : Math.round((longHaulPremium / longHaulTotal) * 1000) / 10;
  const mixed = lowest !== highest;
  return {
    requestedCabin,
    premiumCabinPercent: premiumPercent,
    longHaulPremiumPercent,
    lowestCabin: byRank(lowest),
    highestCabin: byRank(highest),
    mixedCabin: mixed,
    // A long-haul segment below the requested cabin is the misleading case ("business" that is mostly economy).
    misleadingMixedCabin: mixed && longHaulPremiumPercent < 100,
  };
}

/** Fingerprint of the physical itinerary: flights, dates/times, route, cabin. Provider independent. */
export function itineraryFingerprint(segments: FlightSegment[]): string {
  const key = segments
    .map((s) => [s.marketingCarrier, s.flightNumber, s.origin, s.destination, s.departureUtc.slice(0, 16), s.cabin].join('|'))
    .join('#');
  return hashString(key);
}

function primaryAirline(segments: FlightSegment[]): string {
  const longest = [...segments].sort((a, b) => b.durationMinutes - a.durationMinutes)[0]!;
  return longest.marketingCarrier;
}

export function buildItinerary(draft: ItineraryDraft, opts: NormalizeOptions): NormalizedItinerary {
  const outbound = buildLeg('OUTBOUND', draft.outboundSegments);
  const inbound = buildLeg('RETURN', draft.inboundSegments);
  const segments = [...draft.outboundSegments, ...draft.inboundSegments];
  const fingerprint = itineraryFingerprint(segments);
  const fareEur = convertToEur(draft.fare, draft.currency, opts.fxRatesToEur);
  const ticketGroups = [...new Set(segments.map((s) => s.ticketGroup))];
  const airline = primaryAirline(draft.outboundSegments);
  return {
    id: `${draft.provider}:${draft.providerOfferId}`,
    provider: draft.provider,
    providerOfferId: draft.providerOfferId,
    fare: draft.fare,
    currency: draft.currency,
    fareEur,
    outbound,
    inbound,
    cabinSummary: summarizeCabin(segments, draft.requestedCabin, draft.longHaulMinMinutes),
    originAirport: draft.outboundSegments[0]!.origin,
    arrivalGateway: draft.outboundSegments[draft.outboundSegments.length - 1]!.destination,
    segments,
    protectedConnections: outbound.protectedConnections + inbound.protectedConnections,
    selfTransfers: outbound.selfTransfers + inbound.selfTransfers,
    totalAirMinutes: outbound.airMinutes + inbound.airMinutes,
    totalConnectionMinutes: outbound.connectionMinutes + inbound.connectionMinutes,
    ticketGroups,
    primaryAirline: airline,
    primaryAirlineName: airlineName(airline),
    providerExpiresAt: draft.providerExpiresAt,
    rawProviderReference: draft.rawProviderReference,
    fingerprint,
    alternatives: [],
    firstSeen: opts.now,
    lastSeen: opts.now,
    lastValidated: opts.now,
  };
}

/**
 * Deduplicates itineraries by fingerprint. The cheapest (EUR) offer wins;
 * other providers' offers of the same flights are kept as alternatives.
 */
export function dedupeItineraries(itineraries: NormalizedItinerary[]): NormalizedItinerary[] {
  const byFp = new Map<string, NormalizedItinerary>();
  for (const it of itineraries) {
    const existing = byFp.get(it.fingerprint);
    if (!existing) {
      byFp.set(it.fingerprint, { ...it, alternatives: [...it.alternatives] });
      continue;
    }
    const alt = (x: NormalizedItinerary): ProviderFareAlternative => ({
      provider: x.provider,
      providerOfferId: x.providerOfferId,
      fare: x.fare,
      currency: x.currency,
      fareEur: x.fareEur,
      providerExpiresAt: x.providerExpiresAt,
    });
    if (it.fareEur < existing.fareEur) {
      byFp.set(it.fingerprint, { ...it, alternatives: [...existing.alternatives, alt(existing), ...it.alternatives] });
    } else if (!existing.alternatives.some((a) => a.provider === it.provider && a.providerOfferId === it.providerOfferId)) {
      existing.alternatives.push(alt(it));
    }
  }
  return [...byFp.values()];
}

export function connectionAirports(it: NormalizedItinerary): string[] {
  return [...it.outbound.connections, ...it.inbound.connections].map((c) => c.airport);
}

export function routeString(leg: ItineraryLeg): string {
  const codes = [leg.segments[0]!.origin, ...leg.segments.map((s) => s.destination)];
  return codes.join(' → ');
}

export function sameCity(a: string, b: string): boolean {
  return cityKey(a) === cityKey(b);
}
