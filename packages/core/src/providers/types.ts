import type { DateFareEstimate, DiscoveryRequest, FlightSearchRequest, NormalizedItinerary } from '../types.js';
import type { NormalizeOptions } from '../normalize.js';

export interface ProviderCapabilities {
  /** Supports cheap-date / inspiration style discovery (Stage A). */
  discovery: boolean;
  /** Supports re-pricing an offer by id. */
  refresh: boolean;
  /** Talks to a live external API (false for the mock). */
  live: boolean;
}

export interface ProviderHealth {
  provider: string;
  ok: boolean;
  configured: boolean;
  message: string;
  checkedAt: string;
}

/**
 * The single seam between the application and any flight data source.
 * Adapters convert provider payloads into `NormalizedItinerary` immediately;
 * nothing else in the system sees a provider response.
 */
export interface FlightSearchProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  search(request: FlightSearchRequest, opts: NormalizeOptions): Promise<NormalizedItinerary[]>;
  discover?(request: DiscoveryRequest): Promise<DateFareEstimate[]>;
  refreshOffer?(providerOfferId: string, opts: NormalizeOptions): Promise<NormalizedItinerary | null>;
  healthCheck(): Promise<ProviderHealth>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;
