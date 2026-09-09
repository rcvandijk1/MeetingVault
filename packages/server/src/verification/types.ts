import type { NormalizedItinerary } from '@kfr/core';
import type { Browser } from 'playwright-core';
import type { VerificationStep } from '../db/schema.js';

export interface VerificationResult {
  finalPrice: number;
  currency: string;
  breakdown: Array<{ label: string; amount: number }>;
  steps: VerificationStep[];
}

export interface VerificationContext {
  verificationId: string;
  itinerary: NormalizedItinerary;
  passengers: number;
  /** Lazily launches (and caches) the shared browser. */
  browser: () => Promise<Browser>;
  /** Directory where the driver may store screenshots for this verification. */
  screenshotDir: string;
  /** Base URL of this server (used by drivers that talk to locally hosted flows). */
  selfBaseUrl: string;
  log: (msg: string) => void;
}

/**
 * A booking-flow driver knows how to walk one selling channel's booking
 * process up to, and never through, the payment step, and report the final
 * price it sees there. Browser drivers use Playwright; API channels use the
 * provider's pricing endpoint.
 */
export interface BookingFlowDriver {
  readonly name: string;
  readonly kind: 'BROWSER' | 'API';
  supports(itinerary: NormalizedItinerary): boolean;
  verify(ctx: VerificationContext): Promise<VerificationResult>;
}

export class VerificationError extends Error {
  constructor(
    message: string,
    public readonly steps: VerificationStep[] = [],
  ) {
    super(message);
    this.name = 'VerificationError';
  }
}
