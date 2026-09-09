import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type {
  Cabin,
  AlertThresholds,
  DealLevel,
  DealThresholds,
  NormalizedItinerary,
  ScoreCategory,
  ScoreReason,
  ScoreWeights,
  ScoringParams,
  SelfTransferPolicy,
  TimePreferenceProfile,
  TransferConstraints,
  ResultLabel,
  BaselineComparison,
  DealAssessment,
  EnrichedJourney,
} from '@kfr/core';

export const airports = pgTable('airports', {
  code: varchar('code', { length: 3 }).primaryKey(),
  name: text('name').notNull(),
  city: text('city').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  timezone: text('timezone').notNull(),
  region: varchar('region', { length: 16 }).notNull(),
});

/** Singleton row (id = 1) with home location, FX rates and global thresholds. */
export const appSettings = pgTable('app_settings', {
  id: integer('id').primaryKey(),
  homeName: text('home_name').notNull(),
  homeCountryCode: varchar('home_country_code', { length: 2 }).notNull(),
  homeTimezone: text('home_timezone').notNull(),
  hotelEveningDepartureTime: varchar('hotel_evening_departure_time', { length: 5 }).notNull(),
  minHotelRestMinutes: integer('min_hotel_rest_minutes').notNull(),
  airportExitMinutes: integer('airport_exit_minutes').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  fxRatesToEur: jsonb('fx_rates_to_eur').$type<Record<string, number>>().notNull(),
  dealThresholds: jsonb('deal_thresholds').$type<DealThresholds>().notNull(),
  alertThresholds: jsonb('alert_thresholds').$type<AlertThresholds>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const originAccessProfiles = pgTable('origin_access_profiles', {
  airportCode: varchar('airport_code', { length: 3 })
    .primaryKey()
    .references(() => airports.code),
  enabled: boolean('enabled').notNull().default(true),
  preferredAccessMode: varchar('preferred_access_mode', { length: 24 }).notNull(),
  accessTravelMinutes: integer('access_travel_minutes').notNull(),
  accessMonetaryCost: real('access_monetary_cost').notNull().default(0),
  airportBufferMinutes: integer('airport_buffer_minutes').notNull(),
  sameDayEarliestDepartureTime: varchar('same_day_earliest_departure_time', { length: 5 }).notNull(),
  hotelCost: real('hotel_cost').notNull().default(0),
  hotelRequiredRule: varchar('hotel_required_rule', { length: 8 }).notNull().default('AUTO'),
  returnHotelLatestArrivalTime: varchar('return_hotel_latest_arrival_time', { length: 5 }),
  parkingCost: real('parking_cost').notNull().default(0),
  trainCost: real('train_cost').notNull().default(0),
  fuelCost: real('fuel_cost').notNull().default(0),
  tollCost: real('toll_cost').notNull().default(0),
  inconveniencePenalty: real('inconvenience_penalty').notNull().default(0),
  notes: text('notes').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const destinationGateways = pgTable('destination_gateways', {
  code: varchar('code', { length: 3 })
    .primaryKey()
    .references(() => airports.code),
  enabled: boolean('enabled').notNull().default(true),
  exitBufferMinutes: integer('exit_buffer_minutes').notNull(),
  checkInBufferMinutes: integer('check_in_buffer_minutes').notNull(),
  notes: text('notes').notNull().default(''),
});

export const groundTransferProfiles = pgTable('ground_transfer_profiles', {
  id: varchar('id', { length: 60 }).primaryKey(),
  fromCode: varchar('from_code', { length: 3 })
    .notNull()
    .references(() => airports.code),
  toPlace: text('to_place').notNull(),
  mode: varchar('mode', { length: 24 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  minutes: integer('minutes').notNull(),
  monetaryCost: real('monetary_cost').notNull(),
  inconveniencePenalty: real('inconvenience_penalty').notNull().default(0),
  notes: text('notes').notNull().default(''),
});

export const tripProfiles = pgTable('trip_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  passengers: integer('passengers').notNull(),
  outboundEarliestDate: varchar('outbound_earliest_date', { length: 10 }).notNull(),
  outboundLatestDate: varchar('outbound_latest_date', { length: 10 }).notNull(),
  returnEarliestDate: varchar('return_earliest_date', { length: 10 }).notNull(),
  returnLatestDate: varchar('return_latest_date', { length: 10 }).notNull(),
  minTripDays: integer('min_trip_days').notNull(),
  preferredTripDaysMin: integer('preferred_trip_days_min').notNull(),
  preferredTripDaysMax: integer('preferred_trip_days_max').notNull(),
  maxTripDays: integer('max_trip_days').notNull(),
  cabins: jsonb('cabins').$type<Cabin[]>().notNull(),
  feederMinCabin: varchar('feeder_min_cabin', { length: 16 }).notNull(),
  mixedCabinAllowed: boolean('mixed_cabin_allowed').notNull(),
  outboundConstraints: jsonb('outbound_constraints').$type<TransferConstraints>().notNull(),
  returnConstraints: jsonb('return_constraints').$type<TransferConstraints>().notNull(),
  timePreferences: jsonb('time_preferences').$type<TimePreferenceProfile>().notNull(),
  scoringWeights: jsonb('scoring_weights').$type<ScoreWeights>().notNull(),
  scoringParams: jsonb('scoring_params').$type<ScoringParams>().notNull(),
  selfTransferPolicy: jsonb('self_transfer_policy').$type<SelfTransferPolicy>().notNull(),
  enabledOrigins: jsonb('enabled_origins').$type<string[]>().notNull(),
  enabledArrivalGateways: jsonb('enabled_arrival_gateways').$type<string[]>().notNull(),
  baselineOrigin: varchar('baseline_origin', { length: 3 }).notNull(),
  maxValidationCandidates: integer('max_validation_candidates').notNull().default(48),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export interface SearchRunStats {
  received: number;
  afterDedup: number;
  rejected: number;
  scored: number;
  paretoDominated: number;
  dealCounts: Record<DealLevel, number>;
  datePairs: number;
  discoveryCalls: number;
  searchCalls: number;
  cacheHits: number;
  providersUsed: string[];
  /** Top-ranked journeys re-priced with their provider before presentation. */
  repriced?: number;
  durationMs: number;
}

export const searchRuns = pgTable(
  'search_runs',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').references(() => tripProfiles.id, { onDelete: 'set null' }),
    trigger: varchar('trigger', { length: 16 }).notNull().default('MANUAL'),
    status: varchar('status', { length: 16 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    request: jsonb('request').$type<unknown>().notNull(),
    profileSnapshot: jsonb('profile_snapshot').$type<unknown>().notNull(),
    stats: jsonb('stats').$type<SearchRunStats>(),
    providerErrors: jsonb('provider_errors').$type<Array<{ provider: string; error: string; time: string; request: unknown }>>().notNull().default([]),
    rejected: jsonb('rejected').$type<Array<{ itineraryId: string; fingerprint: string; originAirport: string; arrivalGateway: string; fareEur: number; reasons: string[] }>>().notNull().default([]),
    error: text('error'),
  },
  (t) => [index('search_runs_profile_idx').on(t.profileId, t.startedAt)],
);

export const itineraries = pgTable(
  'itineraries',
  {
    id: text('id').primaryKey(),
    searchRunId: text('search_run_id')
      .notNull()
      .references(() => searchRuns.id, { onDelete: 'cascade' }),
    fingerprint: varchar('fingerprint', { length: 32 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerOfferId: text('provider_offer_id').notNull(),
    fare: real('fare').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    fareEur: real('fare_eur').notNull(),
    originAirport: varchar('origin_airport', { length: 3 }).notNull(),
    arrivalGateway: varchar('arrival_gateway', { length: 3 }).notNull(),
    outboundDate: varchar('outbound_date', { length: 10 }).notNull(),
    inboundDate: varchar('inbound_date', { length: 10 }).notNull(),
    airline: varchar('airline', { length: 3 }).notNull(),
    cabin: varchar('cabin', { length: 16 }).notNull(),
    normalized: jsonb('normalized').$type<NormalizedItinerary>().notNull(),
    enriched: jsonb('enriched').$type<Omit<EnrichedJourney, 'itinerary'>>().notNull(),
    providerExpiresAt: timestamp('provider_expires_at', { withTimezone: true }),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(),
    lastValidated: timestamp('last_validated', { withTimezone: true }).notNull(),
  },
  (t) => [index('itineraries_run_idx').on(t.searchRunId), index('itineraries_fingerprint_idx').on(t.fingerprint)],
);

export const flightSegments = pgTable(
  'flight_segments',
  {
    id: text('id').primaryKey(),
    itineraryId: text('itinerary_id')
      .notNull()
      .references(() => itineraries.id, { onDelete: 'cascade' }),
    direction: varchar('direction', { length: 8 }).notNull(),
    seq: integer('seq').notNull(),
    origin: varchar('origin', { length: 3 }).notNull(),
    destination: varchar('destination', { length: 3 }).notNull(),
    departureUtc: timestamp('departure_utc', { withTimezone: true }).notNull(),
    departureLocal: varchar('departure_local', { length: 16 }).notNull(),
    arrivalUtc: timestamp('arrival_utc', { withTimezone: true }).notNull(),
    arrivalLocal: varchar('arrival_local', { length: 16 }).notNull(),
    marketingCarrier: varchar('marketing_carrier', { length: 3 }).notNull(),
    operatingCarrier: varchar('operating_carrier', { length: 3 }).notNull(),
    flightNumber: varchar('flight_number', { length: 10 }).notNull(),
    aircraft: text('aircraft'),
    cabin: varchar('cabin', { length: 16 }).notNull(),
    fareClass: varchar('fare_class', { length: 16 }),
    seatProduct: varchar('seat_product', { length: 32 }),
    durationMinutes: integer('duration_minutes').notNull(),
    ticketGroup: varchar('ticket_group', { length: 16 }).notNull(),
  },
  (t) => [index('flight_segments_itinerary_idx').on(t.itineraryId)],
);

export const scoreResults = pgTable(
  'score_results',
  {
    id: text('id').primaryKey(),
    itineraryId: text('itinerary_id')
      .notNull()
      .references(() => itineraries.id, { onDelete: 'cascade' }),
    searchRunId: text('search_run_id')
      .notNull()
      .references(() => searchRuns.id, { onDelete: 'cascade' }),
    overallScore: real('overall_score').notNull(),
    rank: integer('rank').notNull(),
    categoryScores: jsonb('category_scores').$type<Record<ScoreCategory, number>>().notNull(),
    reasons: jsonb('reasons').$type<ScoreReason[]>().notNull(),
    labels: jsonb('labels').$type<ResultLabel[]>().notNull(),
    dealLevel: varchar('deal_level', { length: 12 }).notNull(),
    deal: jsonb('deal').$type<DealAssessment>().notNull(),
    paretoDominated: boolean('pareto_dominated').notNull(),
    dominatedBy: text('dominated_by'),
    convenienceScore: real('convenience_score').notNull(),
    sleepOpportunityScore: real('sleep_opportunity_score').notNull(),
    baseline: jsonb('baseline').$type<BaselineComparison>().notNull(),
    weights: jsonb('weights').$type<ScoreWeights>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('score_results_itinerary_idx').on(t.itineraryId), index('score_results_run_idx').on(t.searchRunId, t.overallScore)],
);

/** Append-only fare observations. Never updated, never overwritten. */
export const fareObservations = pgTable(
  'fare_observations',
  {
    id: text('id').primaryKey(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    originAirport: varchar('origin_airport', { length: 3 }).notNull(),
    arrivalGateway: varchar('arrival_gateway', { length: 3 }).notNull(),
    outboundDate: varchar('outbound_date', { length: 10 }).notNull(),
    inboundDate: varchar('inbound_date', { length: 10 }).notNull(),
    airline: varchar('airline', { length: 3 }).notNull(),
    cabin: varchar('cabin', { length: 16 }).notNull(),
    fare: real('fare').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    fareEur: real('fare_eur').notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    itineraryFingerprint: varchar('itinerary_fingerprint', { length: 32 }).notNull(),
    searchRunId: text('search_run_id').references(() => searchRuns.id, { onDelete: 'set null' }),
  },
  (t) => [index('fare_observations_route_idx').on(t.originAirport, t.arrivalGateway, t.cabin, t.observedAt), index('fare_observations_fp_idx').on(t.itineraryFingerprint, t.observedAt)],
);

/** Cross-run tracking of physical itineraries. */
export const knownItineraries = pgTable('known_itineraries', {
  fingerprint: varchar('fingerprint', { length: 32 }).primaryKey(),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(),
  lastValidated: timestamp('last_validated', { withTimezone: true }).notNull(),
  lowestFareEur: real('lowest_fare_eur').notNull(),
  latestFareEur: real('latest_fare_eur').notNull(),
  timesSeen: integer('times_seen').notNull().default(1),
});

export const providerOfferReferences = pgTable(
  'provider_offer_references',
  {
    id: text('id').primaryKey(),
    itineraryId: text('itinerary_id')
      .notNull()
      .references(() => itineraries.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerOfferId: text('provider_offer_id').notNull(),
    fare: real('fare').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    fareEur: real('fare_eur').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    raw: jsonb('raw').$type<unknown>(),
  },
  (t) => [index('provider_offer_refs_itinerary_idx').on(t.itineraryId)],
);

export type VerificationStatus = 'QUEUED' | 'RUNNING' | 'VERIFIED' | 'FAILED' | 'UNSUPPORTED';

export interface VerificationStep {
  name: string;
  at: string;
  ok: boolean;
  url?: string | null;
  screenshot?: string | null;
  note?: string | null;
}

/**
 * Asynchronous final-price verification: a driver walks the booking flow of the
 * selling channel up to (never through) the payment step and records the total.
 */
export const priceVerifications = pgTable(
  'price_verifications',
  {
    id: text('id').primaryKey(),
    itineraryId: text('itinerary_id')
      .notNull()
      .references(() => itineraries.id, { onDelete: 'cascade' }),
    searchRunId: text('search_run_id').references(() => searchRuns.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull(),
    driver: varchar('driver', { length: 48 }),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    quotedFare: real('quoted_fare').notNull(),
    quotedCurrency: varchar('quoted_currency', { length: 3 }).notNull(),
    finalPrice: real('final_price'),
    finalCurrency: varchar('final_currency', { length: 3 }),
    finalPriceEur: real('final_price_eur'),
    breakdown: jsonb('breakdown').$type<Array<{ label: string; amount: number }>>().notNull().default([]),
    steps: jsonb('steps').$type<VerificationStep[]>().notNull().default([]),
    error: text('error'),
  },
  (t) => [index('price_verifications_run_idx').on(t.searchRunId), index('price_verifications_itinerary_idx').on(t.itineraryId), index('price_verifications_status_idx').on(t.status, t.priority)],
);

/** API usage and failure log for cost visibility and provider health. */
export const providerEvents = pgTable(
  'provider_events',
  {
    id: text('id').primaryKey(),
    provider: varchar('provider', { length: 32 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    searchRunId: text('search_run_id').references(() => searchRuns.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    ok: boolean('ok').notNull(),
    cached: boolean('cached').notNull().default(false),
    resultCount: integer('result_count').notNull().default(0),
    error: text('error'),
    request: jsonb('request').$type<unknown>(),
  },
  (t) => [index('provider_events_provider_idx').on(t.provider, t.startedAt)],
);
