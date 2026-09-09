import type {
  CostBreakdown,
  EnrichedJourney,
  GroundTransferProfile,
  GroundTransferResult,
  HotelDecision,
  HotelRule,
  JourneyTimeline,
  NormalizedItinerary,
  OriginAccessProfile,
  OriginAccessResult,
  PipelineContext,
  ReturnTimeline,
} from '../types.js';
import { addDays, addMinutesUtc, daysBetween, hhmmToMinutes, localDate, localMinutesOfDay, localToUtcIso, minutesBetween, utcToLocalIso } from '../time.js';
import { round2 } from '../currency.js';

// ---------------------------------------------------------------------------
// Origin access
// ---------------------------------------------------------------------------

export function computeOriginAccess(p: OriginAccessProfile): OriginAccessResult {
  return {
    airportCode: p.airportCode,
    mode: p.preferredAccessMode,
    travelMinutes: p.accessTravelMinutes,
    costPerDirection: round2(p.accessMonetaryCost + p.trainCost + p.fuelCost + p.tollCost),
    parkingCost: p.parkingCost,
    bufferMinutes: p.airportBufferMinutes,
    inconveniencePenalty: p.inconveniencePenalty,
  };
}

// ---------------------------------------------------------------------------
// Hotel determination
// ---------------------------------------------------------------------------

/**
 * Outbound hotel rule: a hotel is required when the flight departs before the
 * earliest same-day-reachable local time, unless explicitly overridden.
 */
export function determineOutboundHotel(departureLocal: string, p: Pick<OriginAccessProfile, 'sameDayEarliestDepartureTime' | 'hotelCost' | 'hotelRequiredRule' | 'airportCode'>): HotelDecision {
  const rule: HotelRule = p.hotelRequiredRule;
  if (rule === 'ALWAYS') return { required: true, reason: `Hotel always required at ${p.airportCode} (rule)`, cost: p.hotelCost, restMinutes: 0 };
  if (rule === 'NEVER') return { required: false, reason: `Hotel never required at ${p.airportCode} (rule)`, cost: 0, restMinutes: 0 };
  const dep = localMinutesOfDay(departureLocal);
  const earliest = hhmmToMinutes(p.sameDayEarliestDepartureTime);
  if (dep < earliest) {
    return {
      required: true,
      reason: `Departure ${departureLocal.slice(11, 16)} is before the earliest same-day reachable time ${p.sameDayEarliestDepartureTime} at ${p.airportCode}`,
      cost: p.hotelCost,
      restMinutes: 0,
    };
  }
  return { required: false, reason: `Departure ${departureLocal.slice(11, 16)} is reachable from home on the same day`, cost: 0, restMinutes: 0 };
}

export function determineReturnHotel(arrivalLocal: string, p: Pick<OriginAccessProfile, 'returnHotelLatestArrivalTime' | 'hotelCost' | 'hotelRequiredRule' | 'airportCode'>): HotelDecision {
  if (p.hotelRequiredRule === 'NEVER' || !p.returnHotelLatestArrivalTime) {
    return { required: false, reason: 'Same-day journey home after arrival', cost: 0, restMinutes: 0 };
  }
  const arr = localMinutesOfDay(arrivalLocal);
  const latest = hhmmToMinutes(p.returnHotelLatestArrivalTime);
  if (arr > latest) {
    return {
      required: true,
      reason: `Arrival ${arrivalLocal.slice(11, 16)} at ${p.airportCode} is after the latest same-day time ${p.returnHotelLatestArrivalTime}`,
      cost: p.hotelCost,
      restMinutes: 0,
    };
  }
  return { required: false, reason: 'Same-day journey home after arrival', cost: 0, restMinutes: 0 };
}

// ---------------------------------------------------------------------------
// Destination ground transfer
// ---------------------------------------------------------------------------

export function computeGroundTransfer(gatewayCode: string, transfers: GroundTransferProfile[], toPlace = 'KRABI'): GroundTransferResult {
  const t = transfers.find((g) => g.fromCode === gatewayCode && g.toPlace === toPlace && g.enabled);
  if (!t) {
    return { required: false, fromCode: gatewayCode, toPlace, mode: null, minutes: 0, costPerDirection: 0, inconveniencePenalty: 0 };
  }
  return { required: true, fromCode: gatewayCode, toPlace, mode: t.mode, minutes: t.minutes, costPerDirection: t.monetaryCost, inconveniencePenalty: t.inconveniencePenalty };
}

// ---------------------------------------------------------------------------
// True journey cost
// ---------------------------------------------------------------------------

export function computeTrueCost(args: {
  airfareEur: number;
  /** Final price from the booking flow / pricing API, when verified. */
  verifiedFareEur?: number | null;
  access: OriginAccessResult;
  hotelOutbound: HotelDecision;
  hotelReturn: HotelDecision;
  groundOutbound: GroundTransferResult;
  groundReturn: GroundTransferResult;
  other?: number;
}): CostBreakdown {
  const other = args.other ?? 0;
  const verified = args.verifiedFareEur !== undefined && args.verifiedFareEur !== null;
  const parts = {
    airfare: round2(args.airfareEur),
    bookingFees: verified ? round2(args.verifiedFareEur! - args.airfareEur) : 0,
    accessOutbound: args.access.costPerDirection,
    accessReturn: args.access.costPerDirection,
    hotelOutbound: args.hotelOutbound.required ? args.hotelOutbound.cost : 0,
    hotelReturn: args.hotelReturn.required ? args.hotelReturn.cost : 0,
    parking: args.access.parkingCost,
    groundOutbound: args.groundOutbound.costPerDirection,
    groundReturn: args.groundReturn.costPerDirection,
    other,
  };
  const trueJourneyCost = round2(Object.values(parts).reduce((s, v) => s + v, 0));
  return { ...parts, fareVerified: verified, trueJourneyCost };
}

// ---------------------------------------------------------------------------
// Door-to-door timelines
// ---------------------------------------------------------------------------

export function computeOutboundTimeline(
  it: NormalizedItinerary,
  ctx: PipelineContext,
  access: OriginAccessResult,
  hotel: HotelDecision,
  ground: GroundTransferResult,
): { timeline: JourneyTimeline; hotel: HotelDecision } {
  const originTz = ctx.airports[it.originAirport]?.timezone ?? ctx.home.timezone;
  const gatewayTz = ctx.airports[it.arrivalGateway]?.timezone ?? 'Asia/Bangkok';
  const gateway = ctx.gateways[it.arrivalGateway];
  const exitMinutes = gateway?.exitBufferMinutes ?? 0;

  const depUtc = it.outbound.departureUtc;
  const atAirportUtc = addMinutesUtc(depUtc, -access.bufferMinutes);
  let leaveHomeUtc: string;
  let restMinutes = 0;

  if (hotel.required) {
    // Leave home the previous evening, sleep near the airport, walk to check-in.
    const depDateAtOrigin = localDate(utcToLocalIso(depUtc, originTz));
    const eveningLocal = `${addDays(depDateAtOrigin, -1)}T${ctx.home.hotelEveningDepartureTime}`;
    leaveHomeUtc = localToUtcIso(eveningLocal, ctx.home.timezone);
    const arriveHotelUtc = addMinutesUtc(leaveHomeUtc, access.travelMinutes);
    restMinutes = minutesBetween(arriveHotelUtc, atAirportUtc);
    if (restMinutes < ctx.home.minHotelRestMinutes) {
      restMinutes = ctx.home.minHotelRestMinutes;
      leaveHomeUtc = addMinutesUtc(atAirportUtc, -(restMinutes + access.travelMinutes));
    }
  } else {
    leaveHomeUtc = addMinutesUtc(atAirportUtc, -access.travelMinutes);
  }

  const arriveKrabiUtc = addMinutesUtc(it.outbound.arrivalUtc, exitMinutes + ground.minutes);
  const totalElapsedMinutes = minutesBetween(leaveHomeUtc, arriveKrabiUtc);
  const timeline: JourneyTimeline = {
    leaveHomeLocal: utcToLocalIso(leaveHomeUtc, ctx.home.timezone),
    leaveHomeUtc,
    arriveKrabiLocal: utcToLocalIso(arriveKrabiUtc, gatewayTz),
    arriveKrabiUtc,
    homeToAirportMinutes: access.travelMinutes,
    airportBufferMinutes: access.bufferMinutes,
    flightJourneyMinutes: it.outbound.totalMinutes,
    connectionMinutes: it.outbound.connectionMinutes,
    destinationExitMinutes: exitMinutes,
    destinationGroundMinutes: ground.minutes,
    hotelRestMinutes: restMinutes,
    totalElapsedMinutes,
    activeTravelBurdenMinutes: totalElapsedMinutes - restMinutes,
  };
  return { timeline, hotel: { ...hotel, restMinutes } };
}

export function computeReturnTimeline(
  it: NormalizedItinerary,
  ctx: PipelineContext,
  access: OriginAccessResult,
  hotel: HotelDecision,
  ground: GroundTransferResult,
): { timeline: ReturnTimeline; hotel: HotelDecision } {
  const departureGateway = it.inbound.segments[0]!.origin;
  const gateway = ctx.gateways[departureGateway];
  const checkIn = gateway?.checkInBufferMinutes ?? 120;
  const gatewayTz = ctx.airports[departureGateway]?.timezone ?? 'Asia/Bangkok';
  const leaveKrabiUtc = addMinutesUtc(it.inbound.departureUtc, -(checkIn + ground.minutes));
  const exit = ctx.home.airportExitMinutes;
  let restMinutes = 0;
  if (hotel.required) restMinutes = ctx.home.minHotelRestMinutes;
  const arriveHomeUtc = addMinutesUtc(it.inbound.arrivalUtc, exit + restMinutes + access.travelMinutes);
  const totalElapsedMinutes = minutesBetween(leaveKrabiUtc, arriveHomeUtc);
  const timeline: ReturnTimeline = {
    leaveKrabiLocal: utcToLocalIso(leaveKrabiUtc, gatewayTz),
    leaveKrabiUtc,
    arriveHomeLocal: utcToLocalIso(arriveHomeUtc, ctx.home.timezone),
    arriveHomeUtc,
    groundMinutes: ground.minutes,
    checkInBufferMinutes: checkIn,
    flightJourneyMinutes: it.inbound.totalMinutes,
    connectionMinutes: it.inbound.connectionMinutes,
    airportExitMinutes: exit,
    airportToHomeMinutes: access.travelMinutes,
    hotelRestMinutes: restMinutes,
    totalElapsedMinutes,
    activeTravelBurdenMinutes: totalElapsedMinutes - restMinutes,
  };
  return { timeline, hotel: { ...hotel, restMinutes } };
}

// ---------------------------------------------------------------------------
// Full enrichment
// ---------------------------------------------------------------------------

export function enrichJourney(it: NormalizedItinerary, ctx: PipelineContext): EnrichedJourney {
  const originProfile = ctx.originProfiles[it.originAirport];
  if (!originProfile) throw new Error(`No origin access profile for ${it.originAirport}`);
  const returnAirport = it.inbound.segments[it.inbound.segments.length - 1]!.destination;
  const returnProfile = ctx.originProfiles[returnAirport] ?? originProfile;

  const access = computeOriginAccess(originProfile);
  const returnAccess = computeOriginAccess(returnProfile);
  const hotelOut0 = determineOutboundHotel(it.outbound.departureLocal, originProfile);
  const hotelRet0 = determineReturnHotel(it.inbound.arrivalLocal, returnProfile);
  const groundOut = computeGroundTransfer(it.arrivalGateway, ctx.groundTransfers);
  const groundRet = computeGroundTransfer(it.inbound.segments[0]!.origin, ctx.groundTransfers);

  const out = computeOutboundTimeline(it, ctx, access, hotelOut0, groundOut);
  const ret = computeReturnTimeline(it, ctx, returnAccess, hotelRet0, groundRet);
  const cost = computeTrueCost({
    airfareEur: it.fareEur,
    verifiedFareEur: it.verifiedFare?.amountEur ?? null,
    access: { ...access, costPerDirection: access.costPerDirection },
    hotelOutbound: out.hotel,
    hotelReturn: ret.hotel,
    groundOutbound: groundOut,
    groundReturn: groundRet,
  });
  // Return access cost may differ for open-jaw itineraries.
  if (returnAirport !== it.originAirport) {
    cost.accessReturn = returnAccess.costPerDirection;
    cost.trueJourneyCost = round2(cost.trueJourneyCost - access.costPerDirection + returnAccess.costPerDirection);
  }

  const doorToKrabiMinutes = out.timeline.totalElapsedMinutes;
  const krabiToDoorMinutes = ret.timeline.totalElapsedMinutes;
  return {
    itinerary: it,
    originAccess: access,
    hotelOutbound: out.hotel,
    hotelReturn: ret.hotel,
    groundTransfer: groundOut,
    cost,
    outboundTimeline: out.timeline,
    returnTimeline: ret.timeline,
    doorToKrabiMinutes,
    krabiToDoorMinutes,
    totalDoorToDoorMinutes: doorToKrabiMinutes + krabiToDoorMinutes,
    totalElapsedJourneyMinutes: doorToKrabiMinutes + krabiToDoorMinutes,
    totalActiveTravelBurdenMinutes: out.timeline.activeTravelBurdenMinutes + ret.timeline.activeTravelBurdenMinutes,
    tripDays: daysBetween(localDate(it.outbound.departureLocal), localDate(it.inbound.departureLocal)),
  };
}
