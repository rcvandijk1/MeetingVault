import type { Cabin, FlightSegment, NormalizedItinerary, PipelineContext, TripProfile } from '../src/types.js';
import { buildItinerary } from '../src/normalize.js';
import { AIRPORT_INDEX } from '../src/data/airports.js';
import { addMinutesUtc, localToUtcIso, utcToLocalIso } from '../src/time.js';
import { buildDefaultProfile, DEFAULT_HOME } from '../src/defaults.js';
import { buildPipelineContext } from '../src/context.js';

export const NOW = '2026-09-09T06:34:00Z';
export const FX = DEFAULT_HOME.fxRatesToEur;

export interface SegSpec {
  from: string;
  to: string;
  /** Local departure, e.g. "2027-01-20T20:30" */
  dep: string;
  minutes: number;
  carrier?: string;
  flight?: string;
  cabin?: Cabin;
  ticket?: string;
  aircraft?: string;
}

export function segment(s: SegSpec): FlightSegment {
  const originTz = AIRPORT_INDEX[s.from]!.timezone;
  const destTz = AIRPORT_INDEX[s.to]!.timezone;
  const depUtc = localToUtcIso(s.dep, originTz);
  const arrUtc = addMinutesUtc(depUtc, s.minutes);
  return {
    origin: s.from,
    destination: s.to,
    departureUtc: depUtc,
    departureLocal: s.dep,
    arrivalUtc: arrUtc,
    arrivalLocal: utcToLocalIso(arrUtc, destTz),
    marketingCarrier: s.carrier ?? 'QR',
    operatingCarrier: s.carrier ?? 'QR',
    flightNumber: s.flight ?? `${s.carrier ?? 'QR'}${s.from}${s.to}`,
    aircraft: s.aircraft ?? 'Boeing 787-9',
    cabin: s.cabin ?? 'BUSINESS',
    durationMinutes: s.minutes,
    ticketGroup: s.ticket ?? 'T1',
  };
}

export function itinerary(args: { id?: string; fare: number; currency?: string; out: SegSpec[]; ret: SegSpec[]; cabin?: Cabin; provider?: string }): NormalizedItinerary {
  return buildItinerary(
    {
      provider: args.provider ?? 'test',
      providerOfferId: args.id ?? `${args.out[0]!.from}-${args.out[args.out.length - 1]!.to}-${args.fare}`,
      fare: args.fare,
      currency: args.currency ?? 'EUR',
      outboundSegments: args.out.map(segment),
      inboundSegments: args.ret.map(segment),
      requestedCabin: args.cabin ?? 'BUSINESS',
      providerExpiresAt: null,
      rawProviderReference: null,
    },
    { fxRatesToEur: FX, now: NOW },
  );
}

/** Standard AMS → DOH → KBV round trip used across tests. */
export function amsDohKbv(overrides: Partial<{ fare: number; id: string; depTime: string }> = {}): NormalizedItinerary {
  const dep = overrides.depTime ?? '20:30';
  return itinerary({
    id: overrides.id ?? 'AMS-DOH-KBV',
    fare: overrides.fare ?? 1690,
    out: [
      { from: 'AMS', to: 'DOH', dep: `2027-01-20T${dep}`, minutes: 375, flight: 'QR274' },
      { from: 'DOH', to: 'KBV', dep: '2027-01-21T06:50', minutes: 390, flight: 'QR968' },
    ],
    ret: [
      { from: 'KBV', to: 'DOH', dep: '2027-02-08T20:35', minutes: 420, flight: 'QR969' },
      { from: 'DOH', to: 'AMS', dep: '2027-02-09T01:40', minutes: 405, flight: 'QR273' },
    ],
  });
}

export function testProfile(overrides: Partial<TripProfile> = {}): TripProfile {
  return buildDefaultProfile({ passengers: 1, ...overrides });
}

export function testContext(overrides: Partial<PipelineContext> = {}, profile?: TripProfile): PipelineContext {
  return { ...buildPipelineContext({ profile: profile ?? testProfile(), now: NOW }), ...overrides };
}
