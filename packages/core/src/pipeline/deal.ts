import type { DealAssessment, EnrichedJourney, NormalizedItinerary, PipelineContext } from '../types.js';
import { assessFare } from '../intelligence/assess.js';

/**
 * Deal intelligence step of the pipeline: delegates to the historical fare
 * intelligence engine (`intelligence/`). Reference "normal" fares come from the
 * application's own observation history (cohort levels 1–4) and otherwise from
 * the fare distribution of the current search; marketing "was/now" prices are
 * never used.
 */
export function assessDeal(it: NormalizedItinerary, set: NormalizedItinerary[], ctx: PipelineContext, journey?: EnrichedJourney): DealAssessment {
  return assessFare(it, {
    set,
    history: ctx.history,
    config: ctx.fareIntelligence,
    airports: ctx.airports,
    objective: ctx.objective,
    now: ctx.now ?? new Date().toISOString(),
    journey,
  });
}
