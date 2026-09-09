import type { Cabin, DateFareEstimate, DiscoveryRequest, FlightSearchRequest, FlightSegment, NormalizedItinerary } from '../../types.js';
import type { FetchLike, FlightSearchProvider, ProviderHealth } from '../types.js';
import { ProviderError } from '../types.js';
import { buildItinerary, type NormalizeOptions } from '../../normalize.js';
import { localToUtcIso, minutesBetween } from '../../time.js';
import { parseIsoDuration } from '../duffel/DuffelFlightSearchProvider.js';

/**
 * Amadeus Self-Service adapter.
 *
 * Contract used (from the official `amadeus` Node SDK v11):
 *   POST /v1/security/oauth2/token  (application/x-www-form-urlencoded)
 *        grant_type=client_credentials&client_id=..&client_secret=..  -> { access_token, expires_in }
 *   GET  /v2/shopping/flight-offers?originLocationCode&destinationLocationCode&departureDate&returnDate&adults&travelClass&currencyCode&max
 *        -> { data: FlightOffer[] }
 *   POST /v1/shopping/flight-offers/pricing  { data: { type: 'flight-offers-pricing', flightOffers: [offer] } }
 *        -> { data: { flightOffers: FlightOffer[] } }
 *   GET  /v1/shopping/flight-dates?origin&destination&departureDate=YYYY-MM-DD,YYYY-MM-DD&duration=..
 *        -> { data: [{ departureDate, returnDate, price: { total } }] }   (cheap-date inspiration, Stage A)
 *   FlightOffer: { id, price{grandTotal,currency}, itineraries[{duration, segments[{ id, departure{iataCode,terminal,at},
 *        arrival{...}, carrierCode, number, aircraft{code}, operating{carrierCode}, duration }]}],
 *        travelerPricings[{ fareDetailsBySegment[{ segmentId, cabin, fareBasis, class }] }] }
 *   `departure.at` is local wall-clock time without offset; time zones are resolved from our airport data.
 */
export interface AmadeusOptions {
  clientId: string | undefined;
  clientSecret: string | undefined;
  baseUrl?: string;
  fetch?: FetchLike;
  airportTimezones: Record<string, string>;
  now?: () => Date;
  currencyCode?: string;
}

interface AmadeusSegment {
  id: string;
  departure: { iataCode: string; terminal?: string; at: string };
  arrival: { iataCode: string; terminal?: string; at: string };
  carrierCode: string;
  number: string;
  aircraft?: { code?: string };
  operating?: { carrierCode?: string };
  duration?: string;
}
interface AmadeusOffer {
  id: string;
  lastTicketingDate?: string;
  price: { grandTotal: string; currency: string };
  itineraries: Array<{ duration?: string; segments: AmadeusSegment[] }>;
  travelerPricings?: Array<{ fareDetailsBySegment: Array<{ segmentId: string; cabin?: string; fareBasis?: string; class?: string }> }>;
}

const CABIN_MAP: Record<string, Cabin> = { ECONOMY: 'ECONOMY', PREMIUM_ECONOMY: 'PREMIUM_ECONOMY', BUSINESS: 'BUSINESS', FIRST: 'FIRST' };

export class AmadeusFlightSearchProvider implements FlightSearchProvider {
  readonly name = 'amadeus';
  readonly capabilities = { discovery: true, refresh: true, live: true };
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly tz: Record<string, string>;
  private readonly now: () => Date;
  private readonly currency: string;
  private token: { value: string; expiresAt: number } | null = null;
  private offerCache = new Map<string, AmadeusOffer>();

  constructor(opts: AmadeusOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.baseUrl = (opts.baseUrl ?? 'https://test.api.amadeus.com').replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike);
    this.tz = opts.airportTimezones;
    this.now = opts.now ?? (() => new Date());
    this.currency = opts.currencyCode ?? 'EUR';
  }

  get configured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = this.now().toISOString();
    if (!this.configured) {
      return {
        provider: this.name,
        ok: false,
        configured: false,
        message: 'AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET not set. Note: the Amadeus Self-Service portal was decommissioned in July 2026; this adapter now requires Amadeus Enterprise API credentials (commercial contract).',
        checkedAt,
      };
    }
    try {
      await this.accessToken();
      return { provider: this.name, ok: true, configured: true, message: 'Amadeus OAuth token obtained', checkedAt };
    } catch (e) {
      return { provider: this.name, ok: false, configured: true, message: e instanceof Error ? e.message : String(e), checkedAt };
    }
  }

  private async accessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) throw new ProviderError(this.name, 'Amadeus credentials are not configured');
    if (this.token && this.token.expiresAt > this.now().getTime() + 30000) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret }).toString();
    const res = await this.fetchImpl(`${this.baseUrl}/v1/security/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(this.name, `Amadeus token request failed with HTTP ${res.status}`, res.status, text);
    const json = JSON.parse(text) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: this.now().getTime() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, application/vnd.amadeus+json',
        ...(body !== undefined ? { 'Content-Type': 'application/vnd.amadeus+json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(this.name, `Amadeus ${method} ${path} failed with HTTP ${res.status}`, res.status, text);
    return JSON.parse(text) as T;
  }

  async search(req: FlightSearchRequest, opts: NormalizeOptions): Promise<NormalizedItinerary[]> {
    const params = new URLSearchParams({
      originLocationCode: req.origin,
      destinationLocationCode: req.destination,
      departureDate: req.outboundDate,
      returnDate: req.returnDate,
      adults: String(req.passengers),
      travelClass: req.cabin,
      currencyCode: this.currency,
      max: '50',
    });
    const res = await this.request<{ data: AmadeusOffer[] }>('GET', `/v2/shopping/flight-offers?${params.toString()}`);
    const out: NormalizedItinerary[] = [];
    for (const offer of res.data ?? []) {
      const it = this.normalizeOffer(offer, req.cabin, opts, req);
      if (it) {
        this.offerCache.set(it.providerOfferId, offer);
        out.push(it);
      }
    }
    return out;
  }

  async discover(req: DiscoveryRequest): Promise<DateFareEstimate[]> {
    const from = [...req.outboundDates].sort()[0]!;
    const to = [...req.outboundDates].sort().at(-1)!;
    const durations = [...new Set(req.returnDates.flatMap((r) => req.outboundDates.map((o) => minutesBetween(`${o}T00:00:00Z`, `${r}T00:00:00Z`) / 1440)))].filter((d) => d > 0);
    const params = new URLSearchParams({ origin: req.origin, destination: req.destination, departureDate: `${from},${to}`, duration: `${Math.min(...durations)},${Math.max(...durations)}`, viewBy: 'DATE' });
    const res = await this.request<{ data: Array<{ departureDate: string; returnDate: string; price: { total: string } }> }>('GET', `/v1/shopping/flight-dates?${params.toString()}`);
    return (res.data ?? [])
      .filter((d) => req.outboundDates.includes(d.departureDate) && req.returnDates.includes(d.returnDate))
      .map((d) => ({ origin: req.origin, destination: req.destination, outboundDate: d.departureDate, returnDate: d.returnDate, estimatedFareEur: Number(d.price.total) * req.passengers, provider: this.name }));
  }

  async refreshOffer(providerOfferId: string, opts: NormalizeOptions): Promise<NormalizedItinerary | null> {
    const cached = this.offerCache.get(providerOfferId);
    if (!cached) return null;
    const res = await this.request<{ data: { flightOffers: AmadeusOffer[] } }>('POST', '/v1/shopping/flight-offers/pricing', { data: { type: 'flight-offers-pricing', flightOffers: [cached] } });
    const priced = res.data.flightOffers[0];
    if (!priced) return null;
    const cabin = CABIN_MAP[priced.travelerPricings?.[0]?.fareDetailsBySegment[0]?.cabin ?? 'ECONOMY'] ?? 'ECONOMY';
    const it = this.normalizeOffer(priced, cabin, opts);
    if (it) this.offerCache.set(it.providerOfferId, priced);
    return it;
  }

  normalizeOffer(offer: AmadeusOffer, requestedCabin: Cabin, opts: NormalizeOptions, req?: FlightSearchRequest): NormalizedItinerary | null {
    if (offer.itineraries.length < 2) return null;
    const cabins = new Map<string, { cabin?: string; fareBasis?: string; class?: string }>();
    for (const f of offer.travelerPricings?.[0]?.fareDetailsBySegment ?? []) cabins.set(f.segmentId, f);
    try {
      const toSeg = (s: AmadeusSegment): FlightSegment => {
        const originTz = this.tz[s.departure.iataCode];
        const destTz = this.tz[s.arrival.iataCode];
        if (!originTz || !destTz) throw new ProviderError(this.name, `Unknown timezone for ${s.departure.iataCode}/${s.arrival.iataCode}`);
        const depLocal = s.departure.at.slice(0, 16);
        const arrLocal = s.arrival.at.slice(0, 16);
        const depUtc = localToUtcIso(depLocal, originTz);
        const arrUtc = localToUtcIso(arrLocal, destTz);
        const fare = cabins.get(s.id);
        return {
          origin: s.departure.iataCode,
          destination: s.arrival.iataCode,
          departureUtc: depUtc,
          departureLocal: depLocal,
          arrivalUtc: arrUtc,
          arrivalLocal: arrLocal,
          marketingCarrier: s.carrierCode,
          operatingCarrier: s.operating?.carrierCode ?? s.carrierCode,
          flightNumber: `${s.carrierCode}${s.number}`,
          aircraft: s.aircraft?.code ?? null,
          cabin: CABIN_MAP[fare?.cabin ?? ''] ?? 'ECONOMY',
          fareClass: fare?.class ?? fare?.fareBasis ?? null,
          seatProduct: null,
          durationMinutes: s.duration ? parseIsoDuration(s.duration) : minutesBetween(depUtc, arrUtc),
          ticketGroup: 'T1',
          originTerminal: s.departure.terminal ?? null,
          destinationTerminal: s.arrival.terminal ?? null,
        };
      };
      // Amadeus offer ids are only unique within a search response; qualify them with the request.
      const offerId = req ? `${offer.id}:${req.origin}${req.destination}:${req.outboundDate}:${req.returnDate}` : offer.id;
      return buildItinerary(
        {
          provider: this.name,
          providerOfferId: offerId,
          fare: Number(offer.price.grandTotal),
          currency: offer.price.currency,
          outboundSegments: offer.itineraries[0]!.segments.map(toSeg),
          inboundSegments: offer.itineraries[1]!.segments.map(toSeg),
          requestedCabin,
          providerExpiresAt: offer.lastTicketingDate ? `${offer.lastTicketingDate}T23:59:59Z` : null,
          rawProviderReference: { offerId: offer.id, lastTicketingDate: offer.lastTicketingDate ?? null },
        },
        opts,
      );
    } catch {
      return null;
    }
  }
}
