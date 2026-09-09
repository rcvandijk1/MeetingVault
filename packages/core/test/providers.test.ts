import { describe, expect, it } from 'vitest';
import { DuffelFlightSearchProvider, parseIsoDuration } from '../src/providers/duffel/DuffelFlightSearchProvider.js';
import { AmadeusFlightSearchProvider } from '../src/providers/amadeus/AmadeusFlightSearchProvider.js';
import { MockFlightSearchProvider } from '../src/providers/mock/MockFlightSearchProvider.js';
import type { FetchLike } from '../src/providers/types.js';
import { AIRPORTS } from '../src/data/airports.js';
import { FX, NOW } from './helpers.js';

const tz = Object.fromEntries(AIRPORTS.map((a) => [a.code, a.timezone]));

function fakeFetch(handler: (url: string, init?: Parameters<FetchLike>[1]) => { status: number; body: unknown }): FetchLike & { calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fn = (async (url: string, init?: Parameters<FetchLike>[1]) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.body) };
  }) as FetchLike & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

const duffelOffer = {
  id: 'off_123',
  total_amount: '1690.00',
  total_currency: 'EUR',
  expires_at: '2026-09-09T07:00:00Z',
  owner: { iata_code: 'QR', name: 'Qatar Airways' },
  slices: [
    {
      segments: [
        { id: 's1', origin: { iata_code: 'AMS', time_zone: 'Europe/Amsterdam' }, destination: { iata_code: 'DOH', time_zone: 'Asia/Qatar' }, departing_at: '2027-01-20T20:30:00', arriving_at: '2027-01-21T04:45:00', marketing_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, operating_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, marketing_carrier_flight_number: '274', aircraft: { name: 'Boeing 787-9' }, duration: 'PT6H15M', origin_terminal: null, destination_terminal: null, passengers: [{ cabin_class: 'business', fare_basis_code: 'JBUS', cabin: { amenities: { seat: { type: 'full_flat' } } } }] },
        { id: 's2', origin: { iata_code: 'DOH', time_zone: 'Asia/Qatar' }, destination: { iata_code: 'KBV', time_zone: 'Asia/Bangkok' }, departing_at: '2027-01-21T06:50:00', arriving_at: '2027-01-21T17:20:00', marketing_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, operating_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, marketing_carrier_flight_number: '968', aircraft: { name: 'Boeing 787-8' }, duration: 'PT6H30M', origin_terminal: null, destination_terminal: null, passengers: [{ cabin_class: 'business' }] },
      ],
    },
    {
      segments: [
        { id: 's3', origin: { iata_code: 'KBV', time_zone: 'Asia/Bangkok' }, destination: { iata_code: 'DOH', time_zone: 'Asia/Qatar' }, departing_at: '2027-02-08T20:35:00', arriving_at: '2027-02-08T23:35:00', marketing_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, operating_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, marketing_carrier_flight_number: '969', aircraft: { name: 'Boeing 787-8' }, duration: 'PT7H', origin_terminal: null, destination_terminal: null, passengers: [{ cabin_class: 'business' }] },
        { id: 's4', origin: { iata_code: 'DOH', time_zone: 'Asia/Qatar' }, destination: { iata_code: 'AMS', time_zone: 'Europe/Amsterdam' }, departing_at: '2027-02-09T01:40:00', arriving_at: '2027-02-09T06:25:00', marketing_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, operating_carrier: { iata_code: 'QR', name: 'Qatar Airways' }, marketing_carrier_flight_number: '273', aircraft: { name: 'Airbus A350-900' }, duration: 'PT6H45M', origin_terminal: null, destination_terminal: null, passengers: [{ cabin_class: 'business' }] },
      ],
    },
  ],
};

describe('Duffel adapter', () => {
  it('parses ISO durations', () => {
    expect(parseIsoDuration('PT6H15M')).toBe(375);
    expect(parseIsoDuration('P1DT2H')).toBe(1560);
  });

  it('sends a v2 offer request and normalises offers without leaking provider shapes', async () => {
    const fetch = fakeFetch((url) => (url.includes('/air/offer_requests') ? { status: 200, body: { data: { id: 'orq_1', offers: [duffelOffer] } } } : { status: 404, body: {} }));
    const p = new DuffelFlightSearchProvider({ accessToken: 'test', fetch, airportTimezones: tz, now: () => new Date(NOW) });
    const res = await p.search({ origin: 'AMS', destination: 'KBV', outboundDate: '2027-01-20', returnDate: '2027-02-08', passengers: 1, cabin: 'BUSINESS', feederCabin: 'ECONOMY', maxConnections: 2 }, { fxRatesToEur: FX, now: NOW });
    expect(fetch.calls[0]!.init?.headers?.['Duffel-Version']).toBe('v2');
    expect(fetch.calls[0]!.init?.headers?.['Authorization']).toBe('Bearer test');
    const body = JSON.parse(fetch.calls[0]!.init!.body!) as { data: { slices: unknown[]; cabin_class: string; passengers: unknown[] } };
    expect(body.data.slices).toHaveLength(2);
    expect(body.data.cabin_class).toBe('business');
    expect(res).toHaveLength(1);
    const it = res[0]!;
    expect(it.provider).toBe('duffel');
    expect(it.fareEur).toBe(1690);
    expect(it.originAirport).toBe('AMS');
    expect(it.arrivalGateway).toBe('KBV');
    expect(it.outbound.connections[0]!.minutes).toBe(125);
    expect(it.segments[0]!.departureUtc).toBe('2027-01-20T19:30:00.000Z');
    expect(it.segments[0]!.seatProduct).toBe('full_flat');
    expect(it.cabinSummary.premiumCabinPercent).toBe(100);
  });

  it('reports a health problem when the token is missing and surfaces HTTP errors', async () => {
    const p = new DuffelFlightSearchProvider({ accessToken: undefined, fetch: fakeFetch(() => ({ status: 500, body: {} })), airportTimezones: tz });
    expect((await p.healthCheck()).configured).toBe(false);
    const failing = new DuffelFlightSearchProvider({ accessToken: 'x', fetch: fakeFetch(() => ({ status: 429, body: { errors: [{ title: 'rate limited' }] } })), airportTimezones: tz });
    await expect(failing.search({ origin: 'AMS', destination: 'KBV', outboundDate: '2027-01-20', returnDate: '2027-02-08', passengers: 1, cabin: 'BUSINESS', feederCabin: 'ECONOMY', maxConnections: 2 }, { fxRatesToEur: FX })).rejects.toThrow(/HTTP 429/);
  });
});

const amadeusOffer = {
  id: '1',
  lastTicketingDate: '2026-12-01',
  price: { grandTotal: '1500.00', currency: 'USD' },
  itineraries: [
    { duration: 'PT21H50M', segments: [{ id: '1', departure: { iataCode: 'AMS', at: '2027-01-20T20:30:00' }, arrival: { iataCode: 'DOH', at: '2027-01-21T04:45:00' }, carrierCode: 'QR', number: '274', aircraft: { code: '789' }, operating: { carrierCode: 'QR' }, duration: 'PT6H15M' }, { id: '2', departure: { iataCode: 'DOH', at: '2027-01-21T06:50:00' }, arrival: { iataCode: 'KBV', at: '2027-01-21T17:20:00' }, carrierCode: 'QR', number: '968', aircraft: { code: '788' }, duration: 'PT6H30M' }] },
    { duration: 'PT16H50M', segments: [{ id: '3', departure: { iataCode: 'KBV', at: '2027-02-08T20:35:00' }, arrival: { iataCode: 'DOH', at: '2027-02-08T23:35:00' }, carrierCode: 'QR', number: '969', duration: 'PT7H' }, { id: '4', departure: { iataCode: 'DOH', at: '2027-02-09T01:40:00' }, arrival: { iataCode: 'AMS', at: '2027-02-09T06:25:00' }, carrierCode: 'QR', number: '273', duration: 'PT6H45M' }] },
  ],
  travelerPricings: [{ fareDetailsBySegment: [{ segmentId: '1', cabin: 'BUSINESS', class: 'J' }, { segmentId: '2', cabin: 'BUSINESS', class: 'J' }, { segmentId: '3', cabin: 'BUSINESS', class: 'J' }, { segmentId: '4', cabin: 'BUSINESS', class: 'J' }] }],
};

describe('Amadeus adapter', () => {
  it('authenticates with client credentials, searches and converts USD to EUR', async () => {
    const fetch = fakeFetch((url, init) => {
      if (url.endsWith('/v1/security/oauth2/token')) {
        expect(init?.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(init?.body).toContain('grant_type=client_credentials');
        return { status: 200, body: { access_token: 'tok', expires_in: 1799 } };
      }
      if (url.includes('/v2/shopping/flight-offers?')) return { status: 200, body: { data: [amadeusOffer] } };
      if (url.endsWith('/v1/shopping/flight-offers/pricing')) return { status: 200, body: { data: { flightOffers: [{ ...amadeusOffer, price: { grandTotal: '1550.00', currency: 'USD' } }] } } };
      return { status: 404, body: {} };
    });
    const p = new AmadeusFlightSearchProvider({ clientId: 'id', clientSecret: 'secret', fetch, airportTimezones: tz, now: () => new Date(NOW) });
    const res = await p.search({ origin: 'AMS', destination: 'KBV', outboundDate: '2027-01-20', returnDate: '2027-02-08', passengers: 1, cabin: 'BUSINESS', feederCabin: 'ECONOMY', maxConnections: 2 }, { fxRatesToEur: FX, now: NOW });
    expect(res).toHaveLength(1);
    expect(res[0]!.currency).toBe('USD');
    expect(res[0]!.fareEur).toBe(1380);
    expect(res[0]!.segments[1]!.cabin).toBe('BUSINESS');
    expect(res[0]!.outbound.connections[0]!.minutes).toBe(125);
    expect(fetch.calls.filter((c) => c.url.includes('oauth2/token'))).toHaveLength(1);
    const searchCall = fetch.calls.find((c) => c.url.includes('/v2/shopping/flight-offers?'))!;
    expect(searchCall.url).toContain('travelClass=BUSINESS');
    expect(searchCall.init?.headers?.['Authorization']).toBe('Bearer tok');

    const refreshed = await p.refreshOffer(res[0]!.providerOfferId, { fxRatesToEur: FX, now: NOW });
    expect(refreshed?.fareEur).toBe(1426);
  });

  it('reports unconfigured credentials', async () => {
    const p = new AmadeusFlightSearchProvider({ clientId: undefined, clientSecret: undefined, fetch: fakeFetch(() => ({ status: 500, body: {} })), airportTimezones: tz });
    expect((await p.healthCheck()).configured).toBe(false);
  });
});

describe('Mock provider', () => {
  it('refreshes an offer by id deterministically', async () => {
    const p = new MockFlightSearchProvider({ now: () => new Date(NOW) });
    const [it] = await p.search({ origin: 'AMS', destination: 'KBV', outboundDate: '2027-01-20', returnDate: '2027-02-08', passengers: 1, cabin: 'BUSINESS', feederCabin: 'ECONOMY', maxConnections: 2 }, { fxRatesToEur: FX, now: NOW });
    const again = await p.refreshOffer(it!.providerOfferId, { fxRatesToEur: FX, now: NOW });
    expect(again?.fingerprint).toBe(it!.fingerprint);
    expect(again?.fareEur).toBe(it!.fareEur);
  });

  it('downgrades every segment to economy for economy requests', async () => {
    const p = new MockFlightSearchProvider({ now: () => new Date(NOW) });
    const res = await p.search({ origin: 'AMS', destination: 'KBV', outboundDate: '2027-01-20', returnDate: '2027-02-08', passengers: 2, cabin: 'ECONOMY', feederCabin: 'ECONOMY', maxConnections: 2 }, { fxRatesToEur: FX, now: NOW });
    expect(res.every((it) => it.segments.every((s) => s.cabin === 'ECONOMY'))).toBe(true);
    expect(res[0]!.fareEur).toBeLessThan(1500);
  });
});
