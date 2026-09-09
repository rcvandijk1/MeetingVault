import type { Airport, DealThresholds, DestinationGateway, FareObservation, GroundTransferProfile, HomeSettings, OriginAccessProfile, PipelineContext, TripProfile } from './types.js';
import { AIRPORTS } from './data/airports.js';
import { DEFAULT_DEAL_THRESHOLDS, DEFAULT_GATEWAYS, DEFAULT_GROUND_TRANSFERS, DEFAULT_HOME, DEFAULT_ORIGIN_PROFILES, buildDefaultProfile } from './defaults.js';

export interface ContextInput {
  profile?: TripProfile;
  home?: HomeSettings;
  airports?: Airport[];
  originProfiles?: OriginAccessProfile[];
  gateways?: DestinationGateway[];
  groundTransfers?: GroundTransferProfile[];
  history?: FareObservation[];
  dealThresholds?: DealThresholds;
  now?: string;
}

/** Builds a pipeline context from lists (as loaded from the database) with seed defaults as fallback. */
export function buildPipelineContext(input: ContextInput = {}): PipelineContext {
  const airports = input.airports ?? AIRPORTS;
  const originProfiles = input.originProfiles ?? DEFAULT_ORIGIN_PROFILES;
  const gateways = input.gateways ?? DEFAULT_GATEWAYS;
  return {
    profile: input.profile ?? buildDefaultProfile(),
    home: input.home ?? DEFAULT_HOME,
    airports: Object.fromEntries(airports.map((a) => [a.code, a])),
    originProfiles: Object.fromEntries(originProfiles.map((p) => [p.airportCode, p])),
    gateways: Object.fromEntries(gateways.map((g) => [g.code, g])),
    groundTransfers: input.groundTransfers ?? DEFAULT_GROUND_TRANSFERS,
    history: input.history ?? [],
    dealThresholds: input.dealThresholds ?? DEFAULT_DEAL_THRESHOLDS,
    now: input.now,
  };
}
