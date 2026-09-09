import type { DealLevel, NormalizedItinerary, PipelineContext, PipelineResult, RejectedItinerary, ScoreWeights, ScoredJourney } from '../types.js';
import { dedupeItineraries } from '../normalize.js';
import { evaluateHardConstraints } from './constraints.js';
import { enrichJourney } from './enrich.js';
import { assessDeal } from './deal.js';
import { computeSetStats, scoreCategories } from './scoring.js';
import { paretoAnalysis } from './pareto.js';
import { rankJourneys } from './rank.js';

export * from './constraints.js';
export * from './enrich.js';
export * from './timing.js';
export * from './scoring.js';
export * from './pareto.js';
export * from './deal.js';
export * from './rank.js';

const emptyDealCounts = (): Record<DealLevel, number> => ({ NORMAL: 0, GOOD: 0, EXCELLENT: 0, EXCEPTIONAL: 0, INSANE: 0 });

/**
 * TRIP INTENT → (providers) → NORMALIZATION → DEDUPLICATION → HARD FILTERS →
 * HOME ACCESS → HOTEL → DESTINATION GROUND → TRUE COST → DOOR-TO-DOOR →
 * SOFT SCORING → PARETO → DEAL INTELLIGENCE → RANKED JOURNEYS.
 *
 * Fully deterministic: same input, same output.
 */
export function runPipeline(itineraries: NormalizedItinerary[], ctx: PipelineContext): PipelineResult {
  const deduped = dedupeItineraries(itineraries);

  const rejected: RejectedItinerary[] = [];
  const accepted: NormalizedItinerary[] = [];
  for (const it of deduped) {
    const reasons = evaluateHardConstraints(it, ctx);
    if (reasons.length > 0) {
      rejected.push({ itineraryId: it.id, fingerprint: it.fingerprint, originAirport: it.originAirport, arrivalGateway: it.arrivalGateway, fareEur: it.fareEur, reasons });
    } else {
      accepted.push(it);
    }
  }

  const enriched = accepted.map((it) => enrichJourney(it, ctx));
  const stats = enriched.length > 0 ? computeSetStats(enriched, ctx.profile.scoringParams) : { bestTrueCost: 0, bestActiveBurden: 0 };

  const scored: ScoredJourney[] = enriched.map((j) => {
    const deal = assessDeal(j.itinerary, accepted, ctx.history, ctx.dealThresholds, ctx.profile);
    const cs = scoreCategories(j, stats, ctx, deal);
    return {
      ...j,
      categoryScores: cs.scores,
      overallScore: 0,
      reasons: cs.reasons,
      labels: [],
      baseline: { baselineItineraryId: null, baselineOrigin: null, baselineStrategy: 'NONE', savingVsBaseline: null, extraMinutesVsBaseline: null, savingPerExtraHour: null, dominant: false, isBaseline: false },
      deal,
      paretoDominated: false,
      dominatedBy: null,
      convenienceScore: cs.convenienceScore,
      rank: 0,
      sleepOpportunityScore: cs.sleepOpportunityScore,
    };
  });

  const pareto = paretoAnalysis(scored.map((j) => ({ id: j.itinerary.id, cost: j.cost.trueJourneyCost, minutes: j.totalActiveTravelBurdenMinutes, convenience: j.convenienceScore })));
  for (const j of scored) {
    const by = pareto.get(j.itinerary.id) ?? null;
    j.paretoDominated = by !== null;
    j.dominatedBy = by;
  }

  const journeys = rankJourneys(scored, { weights: ctx.profile.scoringWeights, baselineOrigin: ctx.profile.baselineOrigin });
  const dealCounts = emptyDealCounts();
  for (const j of journeys) dealCounts[j.deal.level]++;

  return {
    journeys,
    rejected,
    stats: {
      received: itineraries.length,
      afterDedup: deduped.length,
      rejected: rejected.length,
      scored: journeys.length,
      paretoDominated: journeys.filter((j) => j.paretoDominated).length,
      dealCounts,
    },
  };
}

/** Re-scores already loaded journeys with new weights, without touching providers. */
export function rescoreJourneys(journeys: ScoredJourney[], weights: ScoreWeights, baselineOrigin: string): ScoredJourney[] {
  return rankJourneys(journeys, { weights, baselineOrigin });
}
