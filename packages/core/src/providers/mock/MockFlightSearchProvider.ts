import type { Cabin, DateFareEstimate, DiscoveryRequest, FlightSearchRequest, FlightSegment, NormalizedItinerary } from '../../types.js';
import { CABIN_RANK } from '../../types.js';
import type { FlightSearchProvider, ProviderHealth } from '../types.js';
import { buildItinerary, type NormalizeOptions } from '../../normalize.js';
import { AIRPORT_INDEX } from '../../data/airports.js';
import { hashUnit } from '../../hash.js';
import { addDays, addMinutesUtc, localToUtcIso, utcToLocalIso } from '../../time.js';
import { GENERIC_HUBS, ROUTE_TEMPLATES, type RouteTemplate, type TemplateSegment } from './templates.js';

export const MOCK_PROVIDER_NAME = 'mock';

const CABIN_FARE_FACTOR: Record<Cabin, number> = { ECONOMY: 0.32, PREMIUM_ECONOMY: 0.55, BUSINESS: 1, FIRST: 1.9 };

export interface MockProviderOptions {
  templates?: RouteTemplate[];
  /** Adds synthetic routes for origins without explicit templates. Default true. */
  synthesizeGenericRoutes?: boolean;
  /** Fixed clock for deterministic `providerExpiresAt`. */
  now?: () => Date;
  /** Simulated latency in ms (0 for tests). */
  latencyMs?: number;
  /** When set, the provider throws for these origins (for failure tests). */
  failForOrigins?: string[];
}

function priceJitter(key: string): number {
  // Deterministic ±12% variation, with a mild weekend premium.
  return 0.88 + hashUnit(key) * 0.24;
}

function weekendPremium(date: string): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6 || dow === 0 ? 1.06 : 1;
}

export class MockFlightSearchProvider implements FlightSearchProvider {
  readonly name = MOCK_PROVIDER_NAME;
  readonly capabilities = { discovery: true, refresh: true, live: false };
  private readonly templates: RouteTemplate[];
  private readonly synth: boolean;
  private readonly now: () => Date;
  private readonly latencyMs: number;
  private readonly failFor: Set<string>;
  public calls = 0;

  constructor(opts: MockProviderOptions = {}) {
    this.templates = opts.templates ?? ROUTE_TEMPLATES;
    this.synth = opts.synthesizeGenericRoutes ?? true;
    this.now = opts.now ?? (() => new Date());
    this.latencyMs = opts.latencyMs ?? 0;
    this.failFor = new Set(opts.failForOrigins ?? []);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { provider: this.name, ok: true, configured: true, message: `Mock provider with ${this.templates.length} route templates`, checkedAt: this.now().toISOString() };
  }

  private templatesFor(origin: string, gateway: string): RouteTemplate[] {
    const explicit = this.templates.filter((t) => t.origin === origin && t.gateway === gateway);
    if (explicit.length > 0 || !this.synth) return explicit;
    return this.synthesize(origin, gateway);
  }

  /**
   * Synthesises a plausible Middle-East-hub itinerary for an origin without
   * fixtures. Hub departure times are derived from the UTC arrival time plus a
   * deterministic connection, so connections are always realistic.
   */
  private synthesize(origin: string, gateway: string): RouteTemplate[] {
    const airport = AIRPORT_INDEX[origin];
    if (!airport || airport.region !== 'EUROPE') return [];
    const pick = GENERIC_HUBS[Math.floor(hashUnit(`hub:${origin}`) * GENERIC_HUBS.length)]!;
    const hubTz = AIRPORT_INDEX[pick.hub]!.timezone;
    const gatewayTz = AIRPORT_INDEX[gateway]!.timezone;
    const refDate = '2027-01-20'; // reference date only used to derive day offsets
    const depHour = 13 + Math.floor(hashUnit(`dep:${origin}:${gateway}`) * 9); // 13:00–21:00
    const depTime = `${String(depHour).padStart(2, '0')}:${hashUnit(`min:${origin}`) > 0.5 ? '35' : '10'}`;
    const legMinutes = 340 + Math.floor(hashUnit(`dur:${origin}`) * 60);
    const base = 1500 + Math.floor(hashUnit(`fare:${origin}:${gateway}`) * 500);
    const connectionOut = 105 + Math.floor(hashUnit(`conn:${origin}:${gateway}`) * 120); // 1h45–3h45
    const connectionRet = 100 + Math.floor(hashUnit(`connr:${origin}:${gateway}`) * 110);
    const fn = 100 + Math.floor(hashUnit(`fn:${origin}`) * 800);

    // Outbound: origin → hub, then hub → gateway after the connection.
    const outDepUtc = localToUtcIso(`${refDate}T${depTime}`, airport.timezone);
    const hubDepUtc = addMinutesUtc(outDepUtc, legMinutes + connectionOut);
    const hubDepLocal = utcToLocalIso(hubDepUtc, hubTz);
    const hubDayOffset = Math.round((Date.parse(`${hubDepLocal.slice(0, 10)}T00:00:00Z`) - Date.parse(`${refDate}T00:00:00Z`)) / 86400000);

    // Return: gateway → hub in the evening, then hub → origin after the connection.
    const retDepLocal = gateway === 'KBV' ? '20:35' : '20:05';
    const retDepUtc = localToUtcIso(`${refDate}T${retDepLocal}`, gatewayTz);
    const hubRetDepUtc = addMinutesUtc(retDepUtc, 425 + connectionRet);
    const hubRetDepLocal = utcToLocalIso(hubRetDepUtc, hubTz);
    const hubRetDayOffset = Math.round((Date.parse(`${hubRetDepLocal.slice(0, 10)}T00:00:00Z`) - Date.parse(`${refDate}T00:00:00Z`)) / 86400000);

    const outbound: TemplateSegment[] = [
      { origin, destination: pick.hub, depTime, depDayOffset: 0, durationMinutes: legMinutes, carrier: pick.carrier, flightNumber: `${pick.carrier}${fn}`, aircraft: pick.longHaulAircraft, premiumCabin: 'BUSINESS', ticketGroup: 'T1', seatProduct: pick.seat },
      { origin: pick.hub, destination: gateway, depTime: hubDepLocal.slice(11, 16), depDayOffset: hubDayOffset, durationMinutes: gateway === 'KBV' ? 390 : 395, carrier: pick.carrier, flightNumber: gateway === 'KBV' ? pick.hubToKbv : pick.hubToHkt, aircraft: pick.feederAircraft, premiumCabin: 'BUSINESS', ticketGroup: 'T1', seatProduct: pick.seat },
    ];
    const inbound: TemplateSegment[] = [
      { origin: gateway, destination: pick.hub, depTime: retDepLocal, depDayOffset: 0, durationMinutes: 425, carrier: pick.carrier, flightNumber: `${gateway === 'KBV' ? pick.hubToKbv : pick.hubToHkt}R`, aircraft: pick.feederAircraft, premiumCabin: 'BUSINESS', ticketGroup: 'T1', seatProduct: pick.seat },
      { origin: pick.hub, destination: origin, depTime: hubRetDepLocal.slice(11, 16), depDayOffset: hubRetDayOffset, durationMinutes: legMinutes + 25, carrier: pick.carrier, flightNumber: `${pick.carrier}${fn - 1}`, aircraft: pick.longHaulAircraft, premiumCabin: 'BUSINESS', ticketGroup: 'T1', seatProduct: pick.seat },
    ];
    return [{ id: `${origin}-${pick.hub}-${gateway}-${pick.carrier}-SYN`, origin, gateway, baseFareBusiness: base, note: 'Synthesised discovery route', outbound, inbound }];
  }

  fareFor(t: RouteTemplate, outboundDate: string, returnDate: string, cabin: Cabin, passengers: number): number {
    const perPax = t.baseFareBusiness * CABIN_FARE_FACTOR[cabin] * priceJitter(`${t.id}|${outboundDate}|${returnDate}`) * weekendPremium(outboundDate);
    return Math.round(perPax * passengers);
  }

  private buildSegments(segments: TemplateSegment[], date: string, cabin: Cabin, feederEconomyAllowed: boolean): FlightSegment[] {
    return segments.map((s) => {
      const originTz = AIRPORT_INDEX[s.origin]?.timezone ?? 'UTC';
      const destTz = AIRPORT_INDEX[s.destination]?.timezone ?? 'UTC';
      const depLocal = `${addDays(date, s.depDayOffset)}T${s.depTime}`;
      const depUtc = localToUtcIso(depLocal, originTz);
      const arrUtc = addMinutesUtc(depUtc, s.durationMinutes);
      // Cabin: economy request → all economy; premium request → template cabin, feeder may be economy.
      let segCabin: Cabin;
      if (CABIN_RANK[cabin] === 0) segCabin = 'ECONOMY';
      else if (s.premiumCabin === 'ECONOMY') segCabin = feederEconomyAllowed ? 'ECONOMY' : cabin;
      else segCabin = cabin;
      return {
        origin: s.origin,
        destination: s.destination,
        departureUtc: depUtc,
        departureLocal: depLocal,
        arrivalUtc: arrUtc,
        arrivalLocal: utcToLocalIso(arrUtc, destTz),
        marketingCarrier: s.carrier,
        operatingCarrier: s.carrier,
        flightNumber: s.flightNumber,
        aircraft: s.aircraft,
        cabin: segCabin,
        fareClass: segCabin === 'BUSINESS' ? 'J' : segCabin === 'FIRST' ? 'F' : segCabin === 'PREMIUM_ECONOMY' ? 'W' : 'Y',
        seatProduct: segCabin === 'ECONOMY' ? 'standard' : (s.seatProduct ?? null),
        durationMinutes: s.durationMinutes,
        ticketGroup: s.ticketGroup,
      };
    });
  }

  private build(t: RouteTemplate, req: FlightSearchRequest, opts: NormalizeOptions): NormalizedItinerary {
    const fare = this.fareFor(t, req.outboundDate, req.returnDate, req.cabin, req.passengers);
    const offerId = ['mock', t.id, req.outboundDate, req.returnDate, req.cabin, req.passengers].join('|');
    const expires = new Date(this.now().getTime() + 30 * 60000).toISOString();
    return buildItinerary(
      {
        provider: this.name,
        providerOfferId: offerId,
        fare,
        currency: t.currency ?? 'EUR',
        outboundSegments: this.buildSegments(t.outbound, req.outboundDate, req.cabin, req.feederEconomyAllowed),
        inboundSegments: this.buildSegments(t.inbound, req.returnDate, req.cabin, req.feederEconomyAllowed),
        requestedCabin: req.cabin,
        providerExpiresAt: expires,
        rawProviderReference: { template: t.id, note: t.note },
      },
      { ...opts, now: opts.now ?? this.now().toISOString() },
    );
  }

  async search(req: FlightSearchRequest, opts: NormalizeOptions): Promise<NormalizedItinerary[]> {
    this.calls++;
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.failFor.has(req.origin)) throw new Error(`Simulated provider failure for origin ${req.origin}`);
    return this.templatesFor(req.origin, req.destination)
      .filter((t) => t.outbound.length - 1 <= req.maxConnections && t.inbound.length - 1 <= req.maxConnections)
      .map((t) => this.build(t, req, opts));
  }

  async discover(req: DiscoveryRequest): Promise<DateFareEstimate[]> {
    this.calls++;
    const templates = this.templatesFor(req.origin, req.destination);
    const out: DateFareEstimate[] = [];
    for (const o of req.outboundDates) {
      for (const r of req.returnDates) {
        if (r <= o) continue;
        const fares = templates.map((t) => this.fareFor(t, o, r, req.cabin, req.passengers));
        if (fares.length === 0) continue;
        out.push({ origin: req.origin, destination: req.destination, outboundDate: o, returnDate: r, estimatedFareEur: Math.min(...fares), provider: this.name });
      }
    }
    return out;
  }

  async refreshOffer(providerOfferId: string, opts: NormalizeOptions): Promise<NormalizedItinerary | null> {
    this.calls++;
    const [prefix, templateId, outboundDate, returnDate, cabin, pax] = providerOfferId.split('|');
    if (prefix !== 'mock' || !templateId || !outboundDate || !returnDate || !cabin || !pax) return null;
    const t = [...this.templates, ...this.synthesize(templateId.split('-')[0] ?? '', templateId.includes('HKT') ? 'HKT' : 'KBV')].find((x) => x.id === templateId);
    if (!t) return null;
    return this.build(t, { origin: t.origin, destination: t.gateway, outboundDate, returnDate, passengers: Number(pax), cabin: cabin as Cabin, feederEconomyAllowed: true, maxConnections: 3 }, opts);
  }
}
