import type { DealAssessment, EnrichedJourney, ItineraryLeg, PipelineContext, ScoreCategory, ScoreReason, ScoringParams, SelfTransferPolicy } from '../types.js';
import { formatDuration } from '../time.js';
import { flightTimingBreakdown, sleepOpportunityScore } from './timing.js';

export const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

export interface SetStats {
  bestTrueCost: number;
  bestActiveBurden: number;
}

/** Active burden plus the configured fraction of hotel rest time. */
export function effectiveBurdenMinutes(j: EnrichedJourney, params: Pick<ScoringParams, 'hotelRestBurdenFactor'>): number {
  const rest = j.outboundTimeline.hotelRestMinutes + j.returnTimeline.hotelRestMinutes;
  return j.totalActiveTravelBurdenMinutes + rest * params.hotelRestBurdenFactor;
}

export function computeSetStats(set: EnrichedJourney[], params: Pick<ScoringParams, 'hotelRestBurdenFactor'>): SetStats {
  return {
    bestTrueCost: Math.min(...set.map((j) => j.cost.trueJourneyCost)),
    bestActiveBurden: Math.min(...set.map((j) => effectiveBurdenMinutes(j, params))),
  };
}

export function trueCostScore(trueCost: number, best: number, params: Pick<ScoringParams, 'costPointsPerPercentAboveBest'>): number {
  if (best <= 0) return 100;
  const pctAbove = ((trueCost - best) / best) * 100;
  return clamp100(100 - pctAbove * params.costPointsPerPercentAboveBest);
}

export function journeyTimeScore(activeBurdenMinutes: number, best: number, params: Pick<ScoringParams, 'journeyTimePointsPerExtraHour'>): number {
  const extraHours = Math.max(0, activeBurdenMinutes - best) / 60;
  return clamp100(100 - extraHours * params.journeyTimePointsPerExtraHour);
}

export function legTransferScore(leg: ItineraryLeg, params: ScoringParams): number {
  let score = 100 - leg.transfers * params.pointsPerTransfer;
  for (const c of leg.connections) {
    if (c.minutes < params.idealConnectionMinMinutes) {
      // Unrealistically short connections create risk; penalty grows as the connection shrinks.
      const shortfall = (params.idealConnectionMinMinutes - c.minutes) / params.idealConnectionMinMinutes;
      score -= shortfall * params.shortConnectionMaxPenalty;
    } else if (c.minutes > params.idealConnectionMaxMinutes) {
      score -= ((c.minutes - params.idealConnectionMaxMinutes) / 60) * params.pointsPerHourOverIdealConnection;
    }
    if (c.overnight) score -= params.overnightLayoverPenalty;
    if (c.airportChange) score -= params.airportChangePenalty;
    if (c.type === 'SELF_TRANSFER') score -= params.pointsPerTransfer / 2;
  }
  return clamp100(score);
}

export function selfTransferRiskScore(legs: ItineraryLeg[], params: ScoringParams, policy: SelfTransferPolicy): number {
  let score = 100;
  for (const leg of legs) {
    for (const c of leg.connections) {
      if (c.type !== 'SELF_TRANSFER') continue;
      score -= params.selfTransferRiskPenalty;
      if (c.minutes < policy.tightBufferMinutes + (c.baggageRecheckExpected ? policy.baggageRecheckExtraMinutes : 0)) score -= params.selfTransferTightBufferPenalty;
      if (c.baggageRecheckExpected) score -= params.baggageRecheckPenalty;
    }
  }
  return clamp100(score);
}

export function fareAnomalyScore(deal: DealAssessment): number {
  if (deal.percentBelowReference === null) return 50;
  return clamp100(50 + deal.percentBelowReference * 2);
}

export interface CategoryScoring {
  scores: Record<ScoreCategory, number>;
  reasons: ScoreReason[];
  sleepOpportunityScore: number;
  convenienceScore: number;
}

export function scoreCategories(j: EnrichedJourney, stats: SetStats, ctx: PipelineContext, deal: DealAssessment): CategoryScoring {
  const { profile } = ctx;
  const params = profile.scoringParams;
  const it = j.itinerary;
  const reasons: ScoreReason[] = [];

  // Price
  const trueCost = trueCostScore(j.cost.trueJourneyCost, stats.bestTrueCost, params);
  if (j.cost.trueJourneyCost === stats.bestTrueCost) reasons.push({ sign: '+', text: 'Lowest true journey cost in this search', category: 'trueCost' });
  else if (trueCost < 60) reasons.push({ sign: '-', text: `True journey cost €${Math.round(j.cost.trueJourneyCost - stats.bestTrueCost)} above the cheapest option`, category: 'trueCost' });

  // Journey time
  const burden = effectiveBurdenMinutes(j, params);
  const journeyTime = journeyTimeScore(burden, stats.bestActiveBurden, params);
  if (burden === stats.bestActiveBurden) reasons.push({ sign: '+', text: 'Lowest active travel burden in this search', category: 'journeyTime' });
  else if (journeyTime < 60) reasons.push({ sign: '-', text: `${formatDuration(burden - stats.bestActiveBurden)} more travel burden than the fastest option`, category: 'journeyTime' });

  // Timing + sleep
  const timing = flightTimingBreakdown(it, profile.timePreferences, params);
  const sleep = sleepOpportunityScore(it, params);
  const flightTiming = clamp100(timing.weighted + (sleep / 100) * params.sleepOpportunityMaxBonus);
  if (timing.outboundDeparture >= 80) reasons.push({ sign: '+', text: `Excellent outbound departure time (${it.outbound.departureLocal.slice(11, 16)})`, category: 'flightTiming' });
  else if (timing.outboundDeparture <= 30) reasons.push({ sign: '-', text: `Poor outbound departure time (${it.outbound.departureLocal.slice(11, 16)})`, category: 'flightTiming' });
  if (timing.outboundArrival >= 80) reasons.push({ sign: '+', text: `Good arrival time in Thailand (${it.outbound.arrivalLocal.slice(11, 16)})`, category: 'flightTiming' });
  else if (timing.outboundArrival <= 30) reasons.push({ sign: '-', text: `Awkward arrival time in Thailand (${it.outbound.arrivalLocal.slice(11, 16)})`, category: 'flightTiming' });
  if (timing.returnArrival <= 30) reasons.push({ sign: '-', text: `Awkward arrival time back in Europe (${it.inbound.arrivalLocal.slice(11, 16)})`, category: 'flightTiming' });
  if (sleep >= 70) reasons.push({ sign: '+', text: 'Overnight long-haul offers a real sleep opportunity', category: 'flightTiming' });

  // Transfers
  const transferQuality = clamp100((legTransferScore(it.outbound, params) + legTransferScore(it.inbound, params)) / 2);
  const totalTransfers = it.outbound.transfers + it.inbound.transfers;
  if (it.outbound.transfers <= 1 && it.inbound.transfers <= 1 && it.selfTransfers === 0) {
    reasons.push({ sign: '+', text: `Only ${it.outbound.transfers === 1 ? 'one' : it.outbound.transfers} protected connection outbound`, category: 'transferQuality' });
  }
  if (totalTransfers >= 4) reasons.push({ sign: '-', text: `${totalTransfers} air transfers in total`, category: 'transferQuality' });
  const longest = Math.max(it.outbound.longestConnectionMinutes, it.inbound.longestConnectionMinutes);
  if (longest > params.idealConnectionMaxMinutes + 90) reasons.push({ sign: '-', text: `Long ${formatDuration(longest)} layover`, category: 'transferQuality' });
  if ([...it.outbound.connections, ...it.inbound.connections].some((c) => c.overnight)) reasons.push({ sign: '-', text: 'Overnight layover', category: 'transferQuality' });
  if ([...it.outbound.connections, ...it.inbound.connections].some((c) => c.airportChange)) reasons.push({ sign: '-', text: 'Airport change during connection', category: 'transferQuality' });

  // Fare anomaly
  const fareAnomaly = fareAnomalyScore(deal);
  if (deal.percentBelowReference !== null && deal.percentBelowReference >= 10) {
    reasons.push({ sign: '+', text: `${Math.round(deal.percentBelowReference)}% below ${deal.source === 'HISTORY' ? 'recently observed comparable fares' : 'comparable fares in this search'}`, category: 'fareAnomaly' });
  } else if (deal.percentBelowReference !== null && deal.percentBelowReference <= -10) {
    reasons.push({ sign: '-', text: `${Math.round(-deal.percentBelowReference)}% above ${deal.source === 'HISTORY' ? 'recently observed comparable fares' : 'comparable fares in this search'}`, category: 'fareAnomaly' });
  }

  // Cabin
  let cabinQuality = it.cabinSummary.premiumCabinPercent;
  if (it.cabinSummary.misleadingMixedCabin) cabinQuality -= 15;
  cabinQuality = clamp100(cabinQuality);
  if (it.cabinSummary.premiumCabinPercent === 100) reasons.push({ sign: '+', text: `Entire air journey in ${it.cabinSummary.requestedCabin.toLowerCase().replace('_', ' ')}`, category: 'cabinQuality' });
  else if (it.cabinSummary.mixedCabin) reasons.push({ sign: '-', text: `Mixed cabin: ${Math.round(it.cabinSummary.premiumCabinPercent)}% of air time in ${it.cabinSummary.requestedCabin.toLowerCase().replace('_', ' ')}`, category: 'cabinQuality' });

  // Origin
  let originInconvenience = 100 - j.originAccess.inconveniencePenalty;
  if (j.hotelOutbound.required) originInconvenience -= params.hotelInconveniencePenalty;
  if (j.hotelReturn.required) originInconvenience -= params.hotelInconveniencePenalty / 2;
  originInconvenience = clamp100(originInconvenience);
  if (!j.hotelOutbound.required) reasons.push({ sign: '+', text: 'No airport hotel required', category: 'originInconvenience' });
  else reasons.push({ sign: '-', text: `Airport hotel required at ${it.originAirport} (€${Math.round(j.hotelOutbound.cost)})`, category: 'originInconvenience' });
  if (j.hotelReturn.required) reasons.push({ sign: '-', text: `Late arrival back at ${it.originAirport} needs a hotel night`, category: 'originInconvenience' });
  if (j.originAccess.inconveniencePenalty >= 40) reasons.push({ sign: '-', text: `${it.originAirport} needs ${formatDuration(j.originAccess.travelMinutes)} of positioning (${j.originAccess.mode.toLowerCase().replace('_', ' ')})`, category: 'originInconvenience' });

  // Self transfer
  const selfTransferRisk = selfTransferRiskScore([it.outbound, it.inbound], params, profile.selfTransferPolicy);
  if (it.selfTransfers === 0) reasons.push({ sign: '+', text: 'No self-transfer', category: 'selfTransferRisk' });
  else reasons.push({ sign: '-', text: `${it.selfTransfers} self-transfer(s) on separate tickets`, category: 'selfTransferRisk' });

  // Destination
  const destinationTransfer = clamp100(100 - j.groundTransfer.inconveniencePenalty);
  if (j.groundTransfer.required && j.groundTransfer.minutes >= 60) {
    reasons.push({ sign: '-', text: `${it.arrivalGateway} requires a ${formatDuration(j.groundTransfer.minutes)} ground transfer to ${j.groundTransfer.toPlace.toLowerCase()}`, category: 'destinationTransfer' });
  } else {
    reasons.push({ sign: '+', text: `Arrival at ${it.arrivalGateway}, short transfer to ${j.groundTransfer.toPlace.toLowerCase()}`, category: 'destinationTransfer' });
  }

  const scores: Record<ScoreCategory, number> = {
    trueCost,
    journeyTime,
    flightTiming,
    transferQuality,
    fareAnomaly,
    cabinQuality,
    originInconvenience,
    selfTransferRisk,
    destinationTransfer,
  };
  const convenienceScore = clamp100((transferQuality + originInconvenience + selfTransferRisk + destinationTransfer) / 4);
  return { scores, reasons, sleepOpportunityScore: sleep, convenienceScore };
}
