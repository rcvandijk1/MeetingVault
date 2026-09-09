import { describe, expect, it } from 'vitest';
import { dedupeItineraries, deriveConnections, itineraryFingerprint, summarizeCabin } from '../src/normalize.js';
import { convertToEur } from '../src/currency.js';
import { amsDohKbv, itinerary, segment } from './helpers.js';

describe('connections and transfers', () => {
  it('derives connection duration and counts transfers', () => {
    const it = amsDohKbv();
    expect(it.outbound.transfers).toBe(1);
    expect(it.outbound.connections[0]!.airport).toBe('DOH');
    expect(it.outbound.connections[0]!.minutes).toBe(125);
    expect(it.outbound.connections[0]!.type).toBe('PROTECTED');
    expect(it.protectedConnections).toBe(2);
    expect(it.selfTransfers).toBe(0);
  });

  it('detects a self-transfer when ticket groups differ', () => {
    const it = itinerary({
      fare: 1250,
      out: [
        { from: 'AMS', to: 'BKK', dep: '2027-01-20T17:30', minutes: 665, carrier: 'KL', ticket: 'T1' },
        { from: 'BKK', to: 'KBV', dep: '2027-01-21T14:30', minutes: 80, carrier: 'PG', ticket: 'T2', cabin: 'ECONOMY' },
      ],
      ret: [
        { from: 'KBV', to: 'BKK', dep: '2027-02-08T10:05', minutes: 80, carrier: 'PG', ticket: 'T2', cabin: 'ECONOMY' },
        { from: 'BKK', to: 'AMS', dep: '2027-02-08T16:00', minutes: 770, carrier: 'KL', ticket: 'T1' },
      ],
    });
    expect(it.selfTransfers).toBe(2);
    expect(it.outbound.connections[0]!.type).toBe('SELF_TRANSFER');
    expect(it.outbound.connections[0]!.baggageRecheckExpected).toBe(true);
    expect(it.ticketGroups).toEqual(['T1', 'T2']);
  });

  it('flags airport changes and overnight connections', () => {
    const segs = [
      segment({ from: 'AMS', to: 'BKK', dep: '2027-01-20T08:00', minutes: 660 }), // arrives 01:00 BKK
      segment({ from: 'DMK', to: 'KBV', dep: '2027-01-21T09:00', minutes: 80 }), // 8h later, other airport
    ];
    const conns = deriveConnections(segs);
    expect(conns[0]!.airportChange).toBe(true);
    expect(conns[0]!.overnight).toBe(true);
  });
});

describe('cabin summary', () => {
  it('computes the percentage of the air journey in the requested cabin', () => {
    const segs = [
      segment({ from: 'AMS', to: 'BKK', dep: '2027-01-20T17:30', minutes: 665, cabin: 'BUSINESS' }),
      segment({ from: 'BKK', to: 'KBV', dep: '2027-01-21T14:30', minutes: 80, cabin: 'ECONOMY' }),
    ];
    const s = summarizeCabin(segs, 'BUSINESS');
    expect(s.premiumCabinPercent).toBeCloseTo(89.3, 1);
    expect(s.longHaulPremiumPercent).toBe(100);
    expect(s.mixedCabin).toBe(true);
    expect(s.misleadingMixedCabin).toBe(false);
  });

  it('flags a misleading mixed cabin when the long-haul is below the requested cabin', () => {
    const segs = [
      segment({ from: 'AMS', to: 'DOH', dep: '2027-01-20T20:30', minutes: 375, cabin: 'BUSINESS' }),
      segment({ from: 'DOH', to: 'KBV', dep: '2027-01-21T06:50', minutes: 390, cabin: 'ECONOMY' }),
    ];
    const s = summarizeCabin(segs, 'BUSINESS');
    expect(s.misleadingMixedCabin).toBe(true);
    expect(s.longHaulPremiumPercent).toBeCloseTo(49, 0);
  });
});

describe('fingerprint and deduplication', () => {
  it('produces the same fingerprint for the same flights from different providers', () => {
    const a = amsDohKbv({ id: 'a' });
    const b = { ...amsDohKbv({ id: 'b', fare: 1750 }), provider: 'other' };
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(itineraryFingerprint(a.segments)).toBe(a.fingerprint);
    const deduped = dedupeItineraries([b, a]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.fareEur).toBe(1690);
    expect(deduped[0]!.alternatives).toHaveLength(1);
    expect(deduped[0]!.alternatives[0]!.provider).toBe('other');
  });

  it('keeps itineraries with different departure times separate', () => {
    const a = amsDohKbv({ depTime: '20:30' });
    const b = amsDohKbv({ depTime: '15:55' });
    expect(dedupeItineraries([a, b])).toHaveLength(2);
  });
});

describe('currency', () => {
  it('normalises provider currencies to EUR and refuses unknown ones', () => {
    expect(convertToEur(100, 'USD', { USD: 0.92 })).toBe(92);
    expect(convertToEur(100, 'eur', {})).toBe(100);
    expect(() => convertToEur(100, 'XYZ', {})).toThrow();
    const it = itinerary({ fare: 1000, currency: 'USD', out: [{ from: 'AMS', to: 'KBV', dep: '2027-01-20T20:30', minutes: 700 }], ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }] });
    expect(it.fareEur).toBe(920);
  });
});
