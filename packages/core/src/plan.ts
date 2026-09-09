import type { TripProfile } from './types.js';
import type { SearchPlan } from './providers/orchestrator.js';

/** Derives the provider search plan from a trip profile. */
export function planFromProfile(profile: TripProfile, overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    origins: profile.enabledOrigins,
    gateways: profile.enabledArrivalGateways,
    outboundEarliestDate: profile.outboundEarliestDate,
    outboundLatestDate: profile.outboundLatestDate,
    returnEarliestDate: profile.returnEarliestDate,
    returnLatestDate: profile.returnLatestDate,
    minTripDays: profile.minTripDays,
    preferredTripDaysMin: profile.preferredTripDaysMin,
    preferredTripDaysMax: profile.preferredTripDaysMax,
    maxTripDays: profile.maxTripDays,
    passengers: profile.passengers,
    cabin: profile.longHaulCabin,
    feederEconomyAllowed: profile.feederEconomyAllowed,
    maxConnections: Math.max(profile.outboundConstraints.maxAirTransfers, profile.returnConstraints.maxAirTransfers),
    maxValidationCandidates: profile.maxValidationCandidates,
    ...overrides,
  };
}
