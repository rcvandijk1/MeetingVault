import { describe, expect, it } from 'vitest';
import { computeGroundTransfer, computeOriginAccess, computeTrueCost, determineOutboundHotel, determineReturnHotel, enrichJourney } from '../src/pipeline/enrich.js';
import { DEFAULT_GROUND_TRANSFERS, DEFAULT_ORIGIN_PROFILES } from '../src/defaults.js';
import { amsDohKbv, itinerary, testContext } from './helpers.js';

const fra = DEFAULT_ORIGIN_PROFILES.find((p) => p.airportCode === 'FRA')!;
const ams = DEFAULT_ORIGIN_PROFILES.find((p) => p.airportCode === 'AMS')!;
const cph = DEFAULT_ORIGIN_PROFILES.find((p) => p.airportCode === 'CPH')!;

describe('hotel determination', () => {
  it('requires a hotel for an early Frankfurt departure but not an afternoon one', () => {
    expect(determineOutboundHotel('2027-01-20T07:00', fra).required).toBe(true);
    expect(determineOutboundHotel('2027-01-20T14:00', fra).required).toBe(false);
  });

  it('honours explicit overrides', () => {
    expect(determineOutboundHotel('2027-01-20T14:00', { ...fra, hotelRequiredRule: 'ALWAYS' }).required).toBe(true);
    expect(determineOutboundHotel('2027-01-20T07:00', { ...fra, hotelRequiredRule: 'NEVER' }).required).toBe(false);
  });

  it('includes the configured hotel cost', () => {
    expect(determineOutboundHotel('2027-01-20T07:00', fra).cost).toBe(fra.hotelCost);
    expect(determineOutboundHotel('2027-01-20T14:00', fra).cost).toBe(0);
  });

  it('requires a return hotel only after the latest same-day arrival time', () => {
    expect(determineReturnHotel('2027-02-09T19:30', cph).required).toBe(true);
    expect(determineReturnHotel('2027-02-09T07:20', cph).required).toBe(false);
    expect(determineReturnHotel('2027-02-09T23:30', ams).required).toBe(false); // no rule configured
  });
});

describe('origin access cost', () => {
  it('sums the configured per-direction costs and exposes parking separately', () => {
    const a = computeOriginAccess({ ...ams, accessMonetaryCost: 10, trainCost: 20, fuelCost: 30, tollCost: 5, parkingCost: 90 });
    expect(a.costPerDirection).toBe(65);
    expect(a.parkingCost).toBe(90);
    expect(a.travelMinutes).toBe(ams.accessTravelMinutes);
  });
});

describe('HKT ground transfer', () => {
  it('models the Phuket → Krabi private driver', () => {
    const g = computeGroundTransfer('HKT', DEFAULT_GROUND_TRANSFERS);
    expect(g.required).toBe(true);
    expect(g.mode).toBe('PRIVATE_DRIVER');
    expect(g.minutes).toBe(180);
    expect(g.costPerDirection).toBe(95);
  });

  it('returns a zero transfer when none is configured or it is disabled', () => {
    expect(computeGroundTransfer('HKT', DEFAULT_GROUND_TRANSFERS.map((g) => ({ ...g, enabled: false }))).required).toBe(false);
    expect(computeGroundTransfer('SIN', DEFAULT_GROUND_TRANSFERS).minutes).toBe(0);
  });
});

describe('true journey cost', () => {
  it('adds every configured component to the airfare', () => {
    const cost = computeTrueCost({
      airfareEur: 1395,
      access: { airportCode: 'FRA', mode: 'TRAIN', travelMinutes: 270, costPerDirection: 72.5, parkingCost: 55, bufferMinutes: 150, inconveniencePenalty: 35 },
      hotelOutbound: { required: true, reason: '', cost: 120, restMinutes: 0 },
      hotelReturn: { required: false, reason: '', cost: 0, restMinutes: 0 },
      groundOutbound: { required: true, fromCode: 'HKT', toPlace: 'KRABI', mode: 'PRIVATE_DRIVER', minutes: 180, costPerDirection: 95, inconveniencePenalty: 30 },
      groundReturn: { required: true, fromCode: 'HKT', toPlace: 'KRABI', mode: 'PRIVATE_DRIVER', minutes: 180, costPerDirection: 95, inconveniencePenalty: 30 },
    });
    expect(cost.airfare).toBe(1395);
    expect(cost.accessOutbound + cost.accessReturn).toBe(145);
    expect(cost.hotelOutbound).toBe(120);
    expect(cost.parking).toBe(55);
    expect(cost.groundOutbound + cost.groundReturn).toBe(190);
    expect(cost.trueJourneyCost).toBe(1905);
  });
});

describe('door-to-door calculation', () => {
  it('starts at home in Alphen aan den Rijn and ends in Krabi', () => {
    const ctx = testContext();
    const j = enrichJourney(amsDohKbv(), ctx);
    // 20:30 departure − 150 min buffer − 45 min drive = 17:15 leave home
    expect(j.outboundTimeline.leaveHomeLocal).toBe('2027-01-20T17:15');
    // arrival KBV 17:20 + 35 exit + 35 taxi = 18:30 in Krabi
    expect(j.outboundTimeline.arriveKrabiLocal).toBe('2027-01-21T18:30');
    expect(j.doorToKrabiMinutes).toBe(60 * 19 + 15); // 17:15 CET → 18:30 ICT next day = 25h15 − 6h tz = 19h15
    expect(j.outboundTimeline.homeToAirportMinutes).toBe(45);
    expect(j.outboundTimeline.flightJourneyMinutes).toBe(j.itinerary.outbound.totalMinutes);
    expect(j.outboundTimeline.destinationGroundMinutes).toBe(35);
    expect(j.hotelOutbound.required).toBe(false);
    expect(j.outboundTimeline.activeTravelBurdenMinutes).toBe(j.outboundTimeline.totalElapsedMinutes);
    expect(j.tripDays).toBe(19);
  });

  it('reflects the previous-evening hotel in elapsed time but not in the active burden', () => {
    const ctx = testContext();
    const it = itinerary({
      fare: 1390,
      out: [
        { from: 'FRA', to: 'BKK', dep: '2027-01-20T09:30', minutes: 650, carrier: 'TG' },
        { from: 'BKK', to: 'KBV', dep: '2027-01-21T06:50', minutes: 80, carrier: 'TG' },
      ],
      ret: [
        { from: 'KBV', to: 'BKK', dep: '2027-02-08T18:35', minutes: 80, carrier: 'TG' },
        { from: 'BKK', to: 'FRA', dep: '2027-02-08T23:45', minutes: 740, carrier: 'TG' },
      ],
    });
    const j = enrichJourney(it, ctx);
    expect(j.hotelOutbound.required).toBe(true);
    expect(j.outboundTimeline.leaveHomeLocal).toBe('2027-01-19T18:00');
    expect(j.outboundTimeline.hotelRestMinutes).toBeGreaterThan(0);
    expect(j.outboundTimeline.activeTravelBurdenMinutes).toBe(j.outboundTimeline.totalElapsedMinutes - j.outboundTimeline.hotelRestMinutes);
    expect(j.cost.hotelOutbound).toBe(fra.hotelCost);
    expect(j.totalElapsedJourneyMinutes).toBeGreaterThan(j.totalActiveTravelBurdenMinutes);
  });

  it('adds the Phuket ground transfer time and cost', () => {
    const ctx = testContext();
    const it = itinerary({
      fare: 1420,
      out: [
        { from: 'DUS', to: 'DOH', dep: '2027-01-20T15:40', minutes: 370 },
        { from: 'DOH', to: 'HKT', dep: '2027-01-21T01:50', minutes: 395 },
      ],
      ret: [
        { from: 'HKT', to: 'DOH', dep: '2027-02-08T20:05', minutes: 425 },
        { from: 'DOH', to: 'DUS', dep: '2027-02-09T01:20', minutes: 395 },
      ],
    });
    const j = enrichJourney(it, ctx);
    expect(j.groundTransfer.mode).toBe('PRIVATE_DRIVER');
    expect(j.outboundTimeline.destinationGroundMinutes).toBe(180);
    expect(j.cost.groundOutbound + j.cost.groundReturn).toBe(190);
    expect(j.cost.trueJourneyCost).toBe(1420 + 35 * 2 + 120 + 190);
  });
});
