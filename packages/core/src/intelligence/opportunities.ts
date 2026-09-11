import type { Cabin, FareConfidence, FareIntelligenceConfig, FareObservation, FareOpportunity, FareOpportunityType, OpportunitySeverity, PipelineContext, ScoredJourney } from '../types.js';
import { hashString } from '../hash.js';
import { median } from './stats.js';

const CONF_RANK: Record<FareConfidence, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const atLeast = (c: FareConfidence, min: FareConfidence): boolean => CONF_RANK[c] >= CONF_RANK[min];
const eur = (n: number): string => `€${Math.round(n).toLocaleString('en-GB')}`;

function make(j: ScoredJourney, type: FareOpportunityType, severity: OpportunitySeverity, confidence: FareConfidence, reason: string, metrics: FareOpportunity['metrics'], now: string): FareOpportunity {
  const it = j.itinerary;
  return {
    id: hashString(`${type}|${it.fingerprint}|${now}`),
    type,
    severity,
    confidence,
    reason,
    metrics,
    itineraryId: it.id,
    fingerprint: it.fingerprint,
    originAirport: it.originAirport,
    arrivalGateway: it.arrivalGateway,
    cabin: it.cabinSummary.requestedCabin,
    fareEur: it.fareEur,
    detectedAt: now,
  };
}

/** Economy median of the same route (any cabin quality) for the premium-cabin anomaly check. */
function economyMedian(j: ScoredJourney, history: FareObservation[]): number | null {
  const it = j.itinerary;
  const fares = history.filter((o) => o.cabin === ('ECONOMY' as Cabin) && o.originAirport === it.originAirport && o.arrivalGateway === it.arrivalGateway && o.fareEur > 0).map((o) => o.fareEur);
  return fares.length >= 5 ? median(fares) : null;
}

/**
 * Raises FareOpportunity events for ranked journeys. Runs after ranking because
 * the alternative-airport and routing checks need the baseline comparison and
 * the other journeys of the run. Deterministic; attaches events to
 * `journey.deal.opportunities` and returns them all.
 */
export function detectOpportunities(journeys: ScoredJourney[], ctx: PipelineContext): FareOpportunity[] {
  const cfg: FareIntelligenceConfig = ctx.fareIntelligence;
  const now = ctx.now ?? new Date().toISOString();
  const out: FareOpportunity[] = [];
  const primaryGateway = ctx.objective.gateways.find((g) => g.onward === 'NONE')?.code ?? 'KBV';

  for (const j of journeys) {
    const d = j.deal;
    const events: FareOpportunity[] = [];
    const t = d.trend;

    // NEW_LOW: strictly below every earlier observation of this exact itinerary.
    if (t && t.isNewLow && t.timesSeenBefore >= cfg.drop.newLowMinObservations && t.lowestSeenEur !== null) {
      const pct = ((t.lowestSeenEur - j.itinerary.fareEur) / t.lowestSeenEur) * 100;
      events.push(make(j, 'NEW_LOW', pct >= 15 ? 'STRONG' : pct >= 5 ? 'NOTABLE' : 'INFO', t.timesSeenBefore >= 10 ? 'HIGH' : 'MEDIUM', `${eur(j.itinerary.fareEur)} is the lowest price seen for these flights (previous low ${eur(t.lowestSeenEur)} over ${t.timesSeenBefore} observations).`, { fareEur: j.itinerary.fareEur, previousLowEur: t.lowestSeenEur, percentBelowPreviousLow: Math.round(pct * 10) / 10, timesSeenBefore: t.timesSeenBefore }, now));
    }

    // SIGNIFICANT_DROP: versus the previous observation or the 30-day median of this itinerary.
    if (t && t.changeVsPreviousPercent !== null && t.previousFareEur !== null) {
      const vsPrev = -t.changeVsPreviousPercent;
      const vs30 = t.changeVs30dMedianPercent !== null ? -t.changeVs30dMedianPercent : null;
      const best = Math.max(vsPrev, vs30 ?? -Infinity);
      if (best >= cfg.drop.significantDropPercent) {
        events.push(make(j, 'SIGNIFICANT_DROP', best >= 25 ? 'STRONG' : best >= 15 ? 'NOTABLE' : 'INFO', t.timesSeenBefore >= 5 ? 'HIGH' : 'MEDIUM', `Price dropped ${Math.round(best)}% (${eur(t.previousFareEur)} → ${eur(j.itinerary.fareEur)}${vs30 !== null && t.median30dEur !== null ? `; 30-day median ${eur(t.median30dEur)}` : ''}).`, { fareEur: j.itinerary.fareEur, previousFareEur: t.previousFareEur, dropVsPreviousPercent: Math.round(vsPrev * 10) / 10, dropVs30dMedianPercent: vs30 === null ? null : Math.round(vs30 * 10) / 10, median30dEur: t.median30dEur }, now));
      }
    }

    // HISTORICAL_OUTLIER: far below the historical cohort median with usable confidence.
    if (d.source === 'HISTORY' && (d.level === 'EXCEPTIONAL' || d.level === 'EXCELLENT') && atLeast(d.confidence, 'MEDIUM') && d.referenceFare !== null) {
      events.push(make(j, 'HISTORICAL_OUTLIER', d.level === 'EXCEPTIONAL' ? 'STRONG' : 'NOTABLE', d.confidence, `${eur(j.itinerary.fareEur)} is ${Math.round(100 - (d.percentOfMedian ?? 100))}% below the historical median of ${eur(d.referenceFare)} (${d.cohort?.sampleCount ?? 0} comparable fares, ${d.confidence.toLowerCase()} confidence).`, { fareEur: j.itinerary.fareEur, medianEur: d.referenceFare, percentOfMedian: d.percentOfMedian, dealScore: d.dealScore, cohortLevel: d.cohort?.level ?? null, sampleCount: d.cohort?.sampleCount ?? null }, now));
    }

    // ALTERNATIVE_AIRPORT_OPPORTUNITY: a non-baseline origin that pays for its extra burden.
    const b = j.baseline;
    if (!b.isBaseline && b.savingVsBaseline !== null && b.baselineOrigin !== null && b.baselineOrigin !== j.itinerary.originAirport && b.savingVsBaseline >= cfg.opportunities.altAirportMinSavingEur && (b.dominant || (b.savingPerExtraHour !== null && b.savingPerExtraHour >= cfg.opportunities.altAirportMinSavingPerHour))) {
      const airfare = b.airfareSavingVsBaseline ?? b.savingVsBaseline;
      const lead = `${j.itinerary.originAirport} airfare is ${eur(airfare)} cheaper than the best ${b.baselineOrigin} option, ${eur(b.savingVsBaseline)} cheaper after positioning, hotel and transfer costs`;
      events.push(make(j, 'ALTERNATIVE_AIRPORT_OPPORTUNITY', b.dominant ? 'STRONG' : b.savingVsBaseline >= 3 * cfg.opportunities.altAirportMinSavingEur ? 'NOTABLE' : 'INFO', 'HIGH', b.dominant ? `${lead}, and it is not slower.` : `${lead}; ${eur(b.savingPerExtraHour ?? 0)} per extra hour of travel, worth it while its fare stays below ${eur(b.breakEvenFareEur ?? 0)}.`, { airfareSavingVsBaselineEur: airfare, savingVsBaselineEur: b.savingVsBaseline, extraMinutes: b.extraMinutesVsBaseline, savingPerExtraHourEur: b.savingPerExtraHour, breakEvenFareEur: b.breakEvenFareEur, baselineOrigin: b.baselineOrigin }, now));
    }

    // PREMIUM_CABIN_ANOMALY: a full premium cabin priced like economy or far below its own history.
    const premium = j.itinerary.cabinSummary.requestedCabin === 'BUSINESS' || j.itinerary.cabinSummary.requestedCabin === 'FIRST';
    if (premium && d.cabinQuality.label === 'FULL') {
      const econ = economyMedian(j, ctx.history);
      if (econ !== null && j.itinerary.fareEur <= econ * cfg.opportunities.premiumVsEconomyMaxRatio) {
        events.push(make(j, 'PREMIUM_CABIN_ANOMALY', j.itinerary.fareEur <= econ * 1.3 ? 'STRONG' : 'NOTABLE', 'MEDIUM', `Full ${j.itinerary.cabinSummary.requestedCabin.toLowerCase()} at ${eur(j.itinerary.fareEur)} is only ${Math.round((j.itinerary.fareEur / econ) * 100) / 100}× the economy median of ${eur(econ)} on this route.`, { fareEur: j.itinerary.fareEur, economyMedianEur: econ, ratioToEconomy: Math.round((j.itinerary.fareEur / econ) * 100) / 100 }, now));
      } else if (d.source === 'HISTORY' && d.level === 'EXCEPTIONAL' && atLeast(d.confidence, 'MEDIUM') && d.referenceFare !== null) {
        events.push(make(j, 'PREMIUM_CABIN_ANOMALY', 'STRONG', d.confidence, `Full ${j.itinerary.cabinSummary.requestedCabin.toLowerCase()} at ${Math.round(d.percentOfMedian ?? 0)}% of its historical median (${eur(d.referenceFare)}).`, { fareEur: j.itinerary.fareEur, medianEur: d.referenceFare, percentOfMedian: d.percentOfMedian, dealScore: d.dealScore }, now));
      }
    }

    // ROUTING_OPPORTUNITY: a secondary gateway (e.g. Phuket + driver) that beats every primary-gateway option from the same origin.
    if (j.itinerary.arrivalGateway !== primaryGateway && !j.paretoDominated) {
      const primaries = journeys.filter((x) => x.itinerary.originAirport === j.itinerary.originAirport && x.itinerary.cabinSummary.requestedCabin === j.itinerary.cabinSummary.requestedCabin && x.itinerary.arrivalGateway === primaryGateway);
      if (primaries.length > 0) {
        const bestPrimary = Math.min(...primaries.map((x) => x.cost.trueJourneyCost));
        const saving = bestPrimary - j.cost.trueJourneyCost;
        if (saving >= cfg.opportunities.routingMinSavingEur) {
          events.push(make(j, 'ROUTING_OPPORTUNITY', saving >= 3 * cfg.opportunities.routingMinSavingEur ? 'STRONG' : 'NOTABLE', 'HIGH', `Arriving via ${j.itinerary.arrivalGateway} saves ${eur(saving)} in true journey cost (transfer included) versus the best ${primaryGateway} option from ${j.itinerary.originAirport}.`, { savingVsPrimaryGatewayEur: Math.round(saving * 100) / 100, primaryGateway, bestPrimaryTrueCostEur: Math.round(bestPrimary), trueCostEur: Math.round(j.cost.trueJourneyCost), groundMinutes: j.groundTransfer.minutes }, now));
        }
      }
    }

    j.deal = { ...d, opportunities: events };
    out.push(...events);
  }
  return out;
}
