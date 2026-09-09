import type { Cabin, FlightSearchRequest, FlightSegment, NormalizedItinerary } from '../../types.js';
import type { FetchLike, FlightSearchProvider, ProviderHealth } from '../types.js';
import { ProviderError } from '../types.js';
import { buildItinerary, type NormalizeOptions } from '../../normalize.js';
import { addMinutesUtc, localToUtcIso, minutesBetween, utcToLocalIso } from '../../time.js';

/**
 * Duffel adapter (API version v2, https://api.duffel.com).
 *
 * Contract used (from the official @duffel/api v4 typings):
 *   POST /air/offer_requests?return_offers=true
 *     body: { data: { slices[{origin,destination,departure_date}], passengers[{type:'adult'}], cabin_class, max_connections } }
 *     headers: Authorization: Bearer <token>, Duffel-Version: v2, Content-Type: application/json
 *     -> { data: { id, offers: Offer[] } }
 *   GET /air/offers/{id}  -> { data: Offer }
 *   Offer: { id, total_amount, total_currency, expires_at, owner{iata_code,name},
 *            slices[{ segments[{ origin{iata_code,time_zone}, destination{...}, departing_at, arriving_at,
 *                     marketing_carrier{iata_code,name}, operating_carrier{...}, marketing_carrier_flight_number,
 *                     aircraft{name}, duration, origin_terminal, destination_terminal,
 *                     passengers[{cabin_class, fare_basis_code, cabin{amenities{seat{type}}}}] }] }] }
 *   departing_at / arriving_at are local wall-clock times without offset; time zones come with the airports.
 */
export interface DuffelOptions {
  accessToken: string | undefined;
  baseUrl?: string;
  apiVersion?: string;
  fetch?: FetchLike;
  airportTimezones?: Record<string, string>;
  now?: () => Date;
}

interface DuffelPlace {
  iata_code: string;
  time_zone?: string | null;
  name?: string;
}
interface DuffelAirline {
  iata_code: string | null;
  name: string;
}
interface DuffelSegment {
  id: string;
  origin: DuffelPlace;
  destination: DuffelPlace;
  departing_at: string;
  arriving_at: string;
  marketing_carrier: DuffelAirline;
  operating_carrier: DuffelAirline;
  marketing_carrier_flight_number: string;
  aircraft: { name: string } | null;
  duration: string | null;
  origin_terminal: string | null;
  destination_terminal: string | null;
  passengers: Array<{ cabin_class: string; fare_basis_code?: string; cabin?: { amenities?: { seat?: { type?: string } | null } } | null }>;
}
interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  expires_at: string;
  owner: DuffelAirline;
  slices: Array<{ segments: DuffelSegment[] }>;
}

const CABIN_MAP: Record<string, Cabin> = { economy: 'ECONOMY', premium_economy: 'PREMIUM_ECONOMY', business: 'BUSINESS', first: 'FIRST' };
const CABIN_TO_DUFFEL: Record<Cabin, string> = { ECONOMY: 'economy', PREMIUM_ECONOMY: 'premium_economy', BUSINESS: 'business', FIRST: 'first' };

export class DuffelFlightSearchProvider implements FlightSearchProvider {
  readonly name = 'duffel';
  readonly capabilities = { discovery: false, refresh: true, live: true };
  private readonly token: string | undefined;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: FetchLike;
  private readonly tz: Record<string, string>;
  private readonly now: () => Date;

  constructor(opts: DuffelOptions) {
    this.token = opts.accessToken;
    this.baseUrl = (opts.baseUrl ?? 'https://api.duffel.com').replace(/\/$/, '');
    this.apiVersion = opts.apiVersion ?? 'v2';
    this.fetchImpl = opts.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike);
    this.tz = opts.airportTimezones ?? {};
    this.now = opts.now ?? (() => new Date());
  }

  get configured(): boolean {
    return Boolean(this.token);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = this.now().toISOString();
    if (!this.configured) return { provider: this.name, ok: false, configured: false, message: 'DUFFEL_ACCESS_TOKEN not set', checkedAt };
    try {
      await this.request('GET', '/air/airlines?limit=1');
      return { provider: this.name, ok: true, configured: true, message: 'Duffel API reachable', checkedAt };
    } catch (e) {
      return { provider: this.name, ok: false, configured: true, message: e instanceof Error ? e.message : String(e), checkedAt };
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new ProviderError(this.name, 'Duffel access token is not configured');
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Duffel-Version': this.apiVersion,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(this.name, `Duffel ${method} ${path} failed with HTTP ${res.status}`, res.status, safeJson(text));
    return JSON.parse(text) as T;
  }

  async search(req: FlightSearchRequest, opts: NormalizeOptions): Promise<NormalizedItinerary[]> {
    const body = {
      data: {
        slices: [
          { origin: req.origin, destination: req.destination, departure_date: req.outboundDate },
          { origin: req.destination, destination: req.origin, departure_date: req.returnDate },
        ],
        passengers: Array.from({ length: req.passengers }, () => ({ type: 'adult' })),
        cabin_class: CABIN_TO_DUFFEL[req.cabin],
        max_connections: Math.min(2, Math.max(0, req.maxConnections)),
      },
    };
    const res = await this.request<{ data: { id: string; offers: DuffelOffer[] } }>('POST', '/air/offer_requests?return_offers=true', body);
    const out: NormalizedItinerary[] = [];
    for (const offer of res.data.offers ?? []) {
      const it = this.normalizeOffer(offer, req.cabin, opts);
      if (it) out.push(it);
    }
    return out;
  }

  async refreshOffer(providerOfferId: string, opts: NormalizeOptions): Promise<NormalizedItinerary | null> {
    const res = await this.request<{ data: DuffelOffer }>('GET', `/air/offers/${encodeURIComponent(providerOfferId)}`);
    const cabin = CABIN_MAP[res.data.slices[0]?.segments[0]?.passengers[0]?.cabin_class ?? 'economy'] ?? 'ECONOMY';
    return this.normalizeOffer(res.data, cabin, opts);
  }

  normalizeOffer(offer: DuffelOffer, requestedCabin: Cabin, opts: NormalizeOptions): NormalizedItinerary | null {
    if (offer.slices.length < 2) return null;
    try {
      const outbound = offer.slices[0]!.segments.map((s) => this.segment(s));
      const inbound = offer.slices[1]!.segments.map((s) => this.segment(s));
      return buildItinerary(
        {
          provider: this.name,
          providerOfferId: offer.id,
          fare: Number(offer.total_amount),
          currency: offer.total_currency,
          outboundSegments: outbound,
          inboundSegments: inbound,
          requestedCabin,
          providerExpiresAt: offer.expires_at,
          rawProviderReference: { offerId: offer.id, owner: offer.owner?.iata_code ?? null, expiresAt: offer.expires_at },
        },
        opts,
      );
    } catch {
      return null;
    }
  }

  private timezone(place: DuffelPlace): string {
    const tz = place.time_zone ?? this.tz[place.iata_code];
    if (!tz) throw new ProviderError(this.name, `Unknown timezone for airport ${place.iata_code}`);
    return tz;
  }

  private segment(s: DuffelSegment): FlightSegment {
    const originTz = this.timezone(s.origin);
    const destTz = this.timezone(s.destination);
    const depLocal = s.departing_at.slice(0, 16);
    const arrLocal = s.arriving_at.slice(0, 16);
    const depUtc = localToUtcIso(depLocal, originTz);
    const arrUtc = localToUtcIso(arrLocal, destTz);
    const duration = s.duration ? parseIsoDuration(s.duration) : minutesBetween(depUtc, arrUtc);
    const pax = s.passengers[0];
    return {
      origin: s.origin.iata_code,
      destination: s.destination.iata_code,
      departureUtc: depUtc,
      departureLocal: depLocal,
      arrivalUtc: duration && Math.abs(minutesBetween(depUtc, arrUtc) - duration) > 60 ? addMinutesUtc(depUtc, duration) : arrUtc,
      arrivalLocal: arrLocal || utcToLocalIso(arrUtc, destTz),
      marketingCarrier: s.marketing_carrier.iata_code ?? 'XX',
      operatingCarrier: s.operating_carrier?.iata_code ?? s.marketing_carrier.iata_code ?? 'XX',
      marketingCarrierName: s.marketing_carrier.name,
      flightNumber: `${s.marketing_carrier.iata_code ?? ''}${s.marketing_carrier_flight_number}`,
      aircraft: s.aircraft?.name ?? null,
      cabin: CABIN_MAP[pax?.cabin_class ?? 'economy'] ?? 'ECONOMY',
      fareClass: pax?.fare_basis_code ?? null,
      seatProduct: pax?.cabin?.amenities?.seat?.type ?? null,
      durationMinutes: duration,
      ticketGroup: 'T1',
      originTerminal: s.origin_terminal,
      destinationTerminal: s.destination_terminal,
    };
  }
}

export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + +(m[3] ?? 0);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
