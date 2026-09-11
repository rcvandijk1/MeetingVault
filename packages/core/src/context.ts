import type { Airport, DestinationGateway, FareIntelligenceConfig, FareObservation, GroundTransferProfile, HomeSettings, OriginAccessProfile, PipelineContext, TravelObjective, TripProfile } from './types.js';
import { AIRPORTS } from './data/airports.js';
import { DEFAULT_FARE_INTELLIGENCE, DEFAULT_GATEWAYS, DEFAULT_GROUND_TRANSFERS, DEFAULT_HOME, DEFAULT_ORIGIN_PROFILES, KRABI_REGION_OBJECTIVE, buildDefaultProfile } from './defaults.js';

export interface ContextInput {
  profile?: TripProfile;
  home?: HomeSettings;
  airports?: Airport[];
  originProfiles?: OriginAccessProfile[];
  gateways?: DestinationGateway[];
  groundTransfers?: GroundTransferProfile[];
  history?: FareObservation[];
  fareIntelligence?: Partial<FareIntelligenceConfig>;
  objective?: TravelObjective;
  now?: string;
}

/** Fills missing keys of a stored config with defaults (forward compatible with new settings). */
export function mergeFareIntelligenceConfig(input?: Partial<FareIntelligenceConfig> | null): FareIntelligenceConfig {
  const d = DEFAULT_FARE_INTELLIGENCE;
  const i = input ?? {};
  return {
    thresholds: { ...d.thresholds, ...i.thresholds },
    minCohortSamples: i.minCohortSamples ?? d.minCohortSamples,
    confidence: { ...d.confidence, ...i.confidence },
    windowsDays: i.windowsDays ?? d.windowsDays,
    preferredWindowDays: i.preferredWindowDays ?? d.preferredWindowDays,
    recentDays: i.recentDays ?? d.recentDays,
    rollingDays: i.rollingDays ?? d.rollingDays,
    seasonalityEnabled: i.seasonalityEnabled ?? d.seasonalityEnabled,
    advancePurchaseBandEdges: i.advancePurchaseBandEdges ?? d.advancePurchaseBandEdges,
    tripDurationToleranceDays: i.tripDurationToleranceDays ?? d.tripDurationToleranceDays,
    outlier: { ...d.outlier, ...i.outlier },
    drop: { ...d.drop, ...i.drop },
    opportunities: { ...d.opportunities, ...i.opportunities },
    timeValue: { ...d.timeValue, ...i.timeValue },
    cabinQualityPenalty: { ...d.cabinQualityPenalty, ...i.cabinQualityPenalty },
  };
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
    fareIntelligence: mergeFareIntelligenceConfig(input.fareIntelligence),
    objective: input.objective ?? KRABI_REGION_OBJECTIVE,
    now: input.now,
  };
}
