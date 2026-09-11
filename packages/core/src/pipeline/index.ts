import type { DealLevel, NormalizedItinerary, PipelineContext, PipelineResult, RejectedItinerary, ScoreWeights, ScoredJourney } from '../types.js';
import { dedupeItineraries } from '../normalize.js';
import { evaluateHardConstraints } from './constraints.js';
import { enrichJourney } from './enrich.js';
import { assessDeal } from './deal.js';
import { computeSetStats, scoreCategories } from './scoring.js';
import { paretoAnalysis } from './pareto.js';
import { rankJourneys, type RankOptions } from './rank.js';
import { detectOpportunities } from '../intelligence/opportunities.js';
import { DEAL_LEVELS } from '../types.js';

export * from './constraints.js';
export * from './enrich.js';
export * from './timing.js';
export * from './scoring.js';
export * from './pareto.js';
export * from './deal.js';
export * from './rank.js';

export const emptyDealCounts = (): Record<DealLevel, number> => Object.fromEntries(DEAL_LEVELS.map((l) => [l, 0])) as Record<DealLevel, number>;

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
    const deal = assessDeal(j.itinerary, accepted, ctx, j);
    const cs = scoreCategories(j, stats, ctx, deal);
    return {
      ...j,
      categoryScores: cs.scores,
      overallScore: 0,
      journeyValueScore: 0,
      reasons: cs.reasons,
      labels: [],
      baseline: { baselineItineraryId: null, baselineOrigin: null, baselineStrategy: 'NONE', savingVsBaseline: null, airfareSavingVsBaseline: null, extraMinutesVsBaseline: null, savingPerExtraHour: null, dominant: false, isBaseline: false, breakEvenFareEur: null, breakEvenFareWithTimeEur: null },
      deal,
      paretoDominated: false,
      dominatedBy: null,
      convenienceScore: cs.convenienceScore,
      rank: 0,
      sleepOpportunityScore: cs.sleepOpportunityScore,
    };
  });

  // Pareto dominance is only meaningful within the same requested cabin (economy always "dominates" business on cost).
  for (const cabin of new Set(scored.map((j) => j.itinerary.cabinSummary.requestedCabin))) {
    const group = scored.filter((j) => j.itinerary.cabinSummary.requestedCabin === cabin);
    const pareto = paretoAnalysis(group.map((j) => ({ id: j.itinerary.id, cost: j.cost.trueJourneyCost, minutes: j.totalActiveTravelBurdenMinutes, convenience: j.convenienceScore })));
    for (const j of group) {
      const by = pareto.get(j.itinerary.id) ?? null;
      j.paretoDominated = by !== null;
      j.dominatedBy = by;
    }
  }

  const journeys = rankJourneys(scored, rankOptions(ctx));
  const opportunities = detectOpportunities(journeys, ctx);
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
    opportunities,
  };
}

/** Rank options derived from the context: profile weights and baseline, value of time only when enabled. */
export function rankOptions(ctx: Pick<PipelineContext, 'fareIntelligence' | 'profile'>): RankOptions {
  return { weights: ctx.profile.scoringWeights, baselineOrigin: ctx.profile.baselineOrigin, valueOfTimeEurPerHour: ctx.fareIntelligence.timeValue.enabled ? ctx.fareIntelligence.timeValue.eurPerActiveHour : null };
}

/** Re-scores already loaded journeys with new weights, without touching providers. */
export function rescoreJourneys(journeys: ScoredJourney[], weights: ScoreWeights, baselineOrigin: string, valueOfTimeEurPerHour: number | null = null): ScoredJourney[] {
  return rankJourneys(journeys, { weights, baselineOrigin, valueOfTimeEurPerHour });
}
