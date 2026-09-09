import type { ItineraryLeg, NormalizedItinerary, PipelineContext, TransferConstraints } from '../types.js';
import { CABIN_RANK } from '../types.js';
import { formatDuration, daysBetween, localDate } from '../time.js';

/**
 * Hard constraints. A violated hard rule eliminates the itinerary; it never
 * merely lowers a score (soft preferences live in the scoring stage).
 */
export function evaluateLegConstraints(leg: ItineraryLeg, c: TransferConstraints, label: string): string[] {
  const reasons: string[] = [];
  if (leg.transfers > c.maxAirTransfers) {
    reasons.push(`${label}: ${leg.transfers} air transfer(s) exceeds maximum of ${c.maxAirTransfers}`);
  }
  for (const conn of leg.connections) {
    if (conn.minutes > c.maxIndividualLayoverMinutes) {
      reasons.push(`${label}: ${formatDuration(conn.minutes)} layover at ${conn.airport} exceeds maximum of ${formatDuration(c.maxIndividualLayoverMinutes)}`);
    }
    if (conn.type === 'PROTECTED' && conn.minutes < c.minConnectionMinutes) {
      reasons.push(`${label}: ${formatDuration(conn.minutes)} connection at ${conn.airport} is below minimum of ${formatDuration(c.minConnectionMinutes)}`);
    }
    if (conn.type === 'SELF_TRANSFER') {
      if (!c.selfTransferAllowed) {
        reasons.push(`${label}: self-transfer at ${conn.airport} is not allowed`);
      } else if (conn.minutes < c.minSelfTransferBufferMinutes) {
        reasons.push(`${label}: self-transfer buffer ${formatDuration(conn.minutes)} at ${conn.airport} is below minimum of ${formatDuration(c.minSelfTransferBufferMinutes)}`);
      }
    }
    if (conn.airportChange && !c.airportChangesAllowed) {
      reasons.push(`${label}: airport change ${conn.airport} → ${conn.nextAirport} is not allowed`);
    }
    if (conn.overnight && !c.overnightLayoversAllowed) {
      reasons.push(`${label}: overnight layover at ${conn.airport} is not allowed`);
    }
  }
  if (leg.connectionMinutes > c.maxTotalLayoverMinutes) {
    reasons.push(`${label}: total layover ${formatDuration(leg.connectionMinutes)} exceeds maximum of ${formatDuration(c.maxTotalLayoverMinutes)}`);
  }
  if (leg.totalMinutes > c.maxTotalJourneyMinutes) {
    reasons.push(`${label}: air journey ${formatDuration(leg.totalMinutes)} exceeds maximum of ${formatDuration(c.maxTotalJourneyMinutes)}`);
  }
  if (leg.selfTransfers > c.maxSelfTransfers) {
    reasons.push(`${label}: ${leg.selfTransfers} self-transfer(s) exceeds maximum of ${c.maxSelfTransfers}`);
  }
  return reasons;
}

export function evaluateHardConstraints(it: NormalizedItinerary, ctx: PipelineContext): string[] {
  const { profile } = ctx;
  const reasons: string[] = [];

  // Origins / gateways
  if (!profile.enabledOrigins.includes(it.originAirport)) {
    reasons.push(`Origin ${it.originAirport} is not enabled in the profile`);
  }
  const originProfile = ctx.originProfiles[it.originAirport];
  if (!originProfile) {
    reasons.push(`No origin access profile configured for ${it.originAirport}`);
  } else if (!originProfile.enabled) {
    reasons.push(`Origin ${it.originAirport} is disabled`);
  }
  if (!profile.enabledArrivalGateways.includes(it.arrivalGateway)) {
    reasons.push(`Arrival gateway ${it.arrivalGateway} is not enabled in the profile`);
  }
  const gateway = ctx.gateways[it.arrivalGateway];
  if (!gateway) {
    reasons.push(`Unknown arrival gateway ${it.arrivalGateway}`);
  } else if (!gateway.enabled) {
    reasons.push(`Arrival gateway ${it.arrivalGateway} is disabled`);
  }
  const ground = ctx.groundTransfers.find((g) => g.fromCode === it.arrivalGateway);
  if (ground && !ground.enabled) {
    reasons.push(`Ground transfer ${it.arrivalGateway} → ${ground.toPlace} is disabled`);
  }
  if (it.arrivalGateway === 'HKT') {
    if (!profile.outboundConstraints.hktGroundTransferAllowed) reasons.push('Outbound: arrival via HKT with ground transfer is not allowed');
    if (!profile.returnConstraints.hktGroundTransferAllowed) reasons.push('Return: departure via HKT with ground transfer is not allowed');
  }

  // Trip length
  const tripDays = daysBetween(localDate(it.outbound.departureLocal), localDate(it.inbound.departureLocal));
  if (tripDays < profile.minTripDays) reasons.push(`Trip of ${tripDays} days is shorter than minimum ${profile.minTripDays}`);
  if (tripDays > profile.maxTripDays) reasons.push(`Trip of ${tripDays} days is longer than maximum ${profile.maxTripDays}`);
  if (localDate(it.outbound.departureLocal) < profile.outboundEarliestDate || localDate(it.outbound.departureLocal) > profile.outboundLatestDate) {
    reasons.push(`Outbound date ${localDate(it.outbound.departureLocal)} is outside the outbound window`);
  }
  if (localDate(it.inbound.departureLocal) < profile.returnEarliestDate || localDate(it.inbound.departureLocal) > profile.returnLatestDate) {
    reasons.push(`Return date ${localDate(it.inbound.departureLocal)} is outside the return window`);
  }

  // Cabin
  const cs = it.cabinSummary;
  if (cs.longHaulPremiumPercent < 100) {
    reasons.push(`Long-haul cabin below requested ${profile.longHaulCabin}`);
  }
  if (!profile.feederEconomyAllowed && CABIN_RANK[cs.lowestCabin] < CABIN_RANK[profile.longHaulCabin]) {
    reasons.push(`Feeder segment in ${cs.lowestCabin} is not allowed`);
  }
  if (!profile.mixedCabinAllowed && cs.mixedCabin) {
    reasons.push('Mixed-cabin itineraries are not allowed');
  }

  // Tickets
  if (it.ticketGroups.length > 1 && (!profile.outboundConstraints.mixedTicketAllowed || !profile.returnConstraints.mixedTicketAllowed)) {
    reasons.push('Mixed-ticket itineraries are not allowed');
  }

  reasons.push(...evaluateLegConstraints(it.outbound, profile.outboundConstraints, 'Outbound'));
  reasons.push(...evaluateLegConstraints(it.inbound, profile.returnConstraints, 'Return'));
  return reasons;
}
