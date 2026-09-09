import type { NormalizedItinerary, SearchOrchestrator } from '@kfr/core';
import { VerificationError, type BookingFlowDriver, type VerificationContext, type VerificationResult } from '../types.js';

/**
 * For API selling channels (Duffel, Amadeus) the pricing endpoint *is* the
 * step before payment: it returns the total that would be charged when the
 * order is created. This driver re-prices the offer and reports that total.
 */
export class ApiPricingDriver implements BookingFlowDriver {
  readonly name = 'api-pricing';
  readonly kind = 'API' as const;

  constructor(
    private readonly orchestrator: SearchOrchestrator,
    private readonly fxRatesToEur: () => Promise<Record<string, number>>,
    private readonly providers: string[] = ['duffel', 'amadeus'],
  ) {}

  supports(it: NormalizedItinerary): boolean {
    return this.providers.includes(it.provider);
  }

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const at = new Date().toISOString();
    const { itinerary, failure } = await this.orchestrator.refresh(ctx.itinerary, { fxRatesToEur: await this.fxRatesToEur(), now: at });
    if (!itinerary) {
      throw new VerificationError(failure?.error ?? `${ctx.itinerary.provider} could not re-price the offer`, [{ name: 'reprice', at, ok: false, note: failure?.error ?? null }]);
    }
    return {
      finalPrice: itinerary.fare,
      currency: itinerary.currency,
      breakdown: [{ label: 'Priced offer total', amount: itinerary.fare }],
      steps: [{ name: 'reprice', at, ok: true, note: `${ctx.itinerary.provider} pricing API confirmed ${itinerary.currency} ${itinerary.fare}` }],
    };
  }
}
