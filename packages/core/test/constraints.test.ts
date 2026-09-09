import { describe, expect, it } from 'vitest';
import { evaluateHardConstraints, evaluateLegConstraints } from '../src/pipeline/constraints.js';
import { amsDohKbv, itinerary, testContext, testProfile } from './helpers.js';

describe('hard constraints', () => {
  it('accepts a compliant itinerary', () => {
    expect(evaluateHardConstraints(amsDohKbv(), testContext())).toEqual([]);
  });

  it('rejects a transfer longer than the hard maximum (6h with max 5h)', () => {
    const it = itinerary({
      fare: 1310,
      out: [
        { from: 'AMS', to: 'IST', dep: '2027-01-20T11:10', minutes: 215, carrier: 'TK' },
        { from: 'IST', to: 'KBV', dep: '2027-01-20T22:45', minutes: 590, carrier: 'TK' },
      ],
      ret: [
        { from: 'KBV', to: 'IST', dep: '2027-02-08T13:20', minutes: 660, carrier: 'TK' },
        { from: 'IST', to: 'AMS', dep: '2027-02-08T22:30', minutes: 225, carrier: 'TK' },
      ],
    });
    expect(it.outbound.longestConnectionMinutes).toBe(360);
    const reasons = evaluateHardConstraints(it, testContext());
    expect(reasons.some((r) => r.includes('6h00 layover at IST exceeds maximum of 5h00'))).toBe(true);
  });

  it('filters by maximum number of transfers', () => {
    const it = itinerary({
      fare: 1200,
      out: [
        { from: 'AMS', to: 'FRA', dep: '2027-01-20T10:00', minutes: 70, carrier: 'LH' },
        { from: 'FRA', to: 'BKK', dep: '2027-01-20T13:40', minutes: 650, carrier: 'LH' },
        { from: 'BKK', to: 'KBV', dep: '2027-01-21T09:20', minutes: 80, carrier: 'TG' },
      ],
      ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }],
    });
    const profile = testProfile({ outboundConstraints: { ...testProfile().outboundConstraints, maxAirTransfers: 1 } });
    const reasons = evaluateHardConstraints(it, testContext({}, profile));
    expect(reasons).toContain('Outbound: 2 air transfer(s) exceeds maximum of 1');
    const relaxed = testProfile({ outboundConstraints: { ...testProfile().outboundConstraints, maxAirTransfers: 2 } });
    expect(evaluateHardConstraints(it, testContext({}, relaxed))).toEqual([]);
  });

  it('applies total layover limits', () => {
    const leg = amsDohKbv().outbound;
    const c = { ...testProfile().outboundConstraints, maxTotalLayoverMinutes: 60 };
    expect(evaluateLegConstraints(leg, c, 'Outbound').some((r) => r.includes('total layover'))).toBe(true);
  });

  it('allows outbound and return to have different rules', () => {
    const it = amsDohKbv(); // both connections are 2h05
    const profile = testProfile({
      outboundConstraints: { ...testProfile().outboundConstraints, maxIndividualLayoverMinutes: 240 },
      returnConstraints: { ...testProfile().returnConstraints, maxIndividualLayoverMinutes: 100 },
    });
    const reasons = evaluateHardConstraints(it, testContext({}, profile));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^Return:/);
  });

  it('prohibits airport changes and self-transfers when configured', () => {
    const selfTransfer = itinerary({
      fare: 1250,
      out: [
        { from: 'AMS', to: 'BKK', dep: '2027-01-20T17:30', minutes: 665, carrier: 'KL', ticket: 'T1' },
        { from: 'DMK', to: 'KBV', dep: '2027-01-21T14:30', minutes: 80, carrier: 'FD', ticket: 'T2', cabin: 'ECONOMY' },
      ],
      ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }],
    });
    const strict = testProfile({ outboundConstraints: { ...testProfile().outboundConstraints, airportChangesAllowed: false, selfTransferAllowed: false } });
    const reasons = evaluateHardConstraints(selfTransfer, testContext({}, strict));
    expect(reasons.some((r) => r.includes('airport change'))).toBe(true);
    expect(reasons.some((r) => r.includes('self-transfer at BKK is not allowed'))).toBe(true);
    const lenient = testProfile({ outboundConstraints: { ...testProfile().outboundConstraints, airportChangesAllowed: true, selfTransferAllowed: true } });
    expect(evaluateHardConstraints(selfTransfer, testContext({}, lenient))).toEqual([]);
  });

  it('enforces the minimum self-transfer buffer separately from protected connections', () => {
    const it = itinerary({
      fare: 1250,
      out: [
        { from: 'AMS', to: 'BKK', dep: '2027-01-20T17:30', minutes: 665, carrier: 'KL', ticket: 'T1' },
        { from: 'BKK', to: 'KBV', dep: '2027-01-21T12:30', minutes: 80, carrier: 'PG', ticket: 'T2', cabin: 'ECONOMY' }, // 1h55 buffer
      ],
      ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }],
    });
    const reasons = evaluateHardConstraints(it, testContext());
    expect(reasons.some((r) => r.includes('self-transfer buffer'))).toBe(true);
  });

  it('can disable the HKT ground transfer route', () => {
    const it = itinerary({
      fare: 1420,
      out: [{ from: 'DUS', to: 'DOH', dep: '2027-01-20T15:40', minutes: 370 }, { from: 'DOH', to: 'HKT', dep: '2027-01-21T01:50', minutes: 395 }],
      ret: [{ from: 'HKT', to: 'DOH', dep: '2027-02-08T20:05', minutes: 425 }, { from: 'DOH', to: 'DUS', dep: '2027-02-09T01:20', minutes: 395 }],
    });
    expect(evaluateHardConstraints(it, testContext())).toEqual([]);
    const profile = testProfile({ outboundConstraints: { ...testProfile().outboundConstraints, hktGroundTransferAllowed: false } });
    expect(evaluateHardConstraints(it, testContext({}, profile)).some((r) => r.includes('HKT'))).toBe(true);
  });

  it('rejects a long-haul segment below the requested cabin', () => {
    const it = itinerary({
      fare: 900,
      out: [{ from: 'AMS', to: 'DOH', dep: '2027-01-20T20:30', minutes: 375, cabin: 'ECONOMY' }, { from: 'DOH', to: 'KBV', dep: '2027-01-21T06:50', minutes: 390 }],
      ret: [{ from: 'KBV', to: 'AMS', dep: '2027-02-08T20:30', minutes: 780 }],
    });
    expect(evaluateHardConstraints(it, testContext())).toContain('Long-haul cabin below requested BUSINESS');
  });
});
