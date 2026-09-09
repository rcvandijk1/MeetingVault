/**
 * Core domain model of Krabi Flight Radar.
 *
 * Everything in this file is provider-agnostic. Provider responses are
 * converted into `NormalizedItinerary` immediately by the provider adapters;
 * nothing downstream (pipeline, scoring, UI) may depend on provider shapes.
 */

export type Cabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export const CABINS: Cabin[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
export const CABIN_RANK: Record<Cabin, number> = { ECONOMY: 0, PREMIUM_ECONOMY: 1, BUSINESS: 2, FIRST: 3 };

export type AccessMode = 'CAR' | 'TRAIN' | 'POSITIONING_FLIGHT' | 'OTHER';
export const ACCESS_MODES: AccessMode[] = ['CAR', 'TRAIN', 'POSITIONING_FLIGHT', 'OTHER'];

export type HotelRule = 'AUTO' | 'ALWAYS' | 'NEVER';

export type Direction = 'OUTBOUND' | 'RETURN';

export type ConnectionType = 'PROTECTED' | 'SELF_TRANSFER';

export type DealLevel = 'NORMAL' | 'GOOD' | 'EXCELLENT' | 'EXCEPTIONAL' | 'INSANE';
export const DEAL_LEVELS: DealLevel[] = ['NORMAL', 'GOOD', 'EXCELLENT', 'EXCEPTIONAL', 'INSANE'];

export type GroundMode = 'PRIVATE_DRIVER' | 'TAXI' | 'SHUTTLE' | 'BUS' | 'FERRY' | 'OTHER';
export const GROUND_MODES: GroundMode[] = ['PRIVATE_DRIVER', 'TAXI', 'SHUTTLE', 'BUS', 'FERRY', 'OTHER'];

export type ResultLabel =
  | 'CHEAPEST'
  | 'FASTEST'
  | 'BEST_OVERALL'
  | 'BEST_TIMING'
  | 'BEST_BASELINE_ORIGIN'
  | 'BEST_ALTERNATIVE_ORIGIN'
  | 'DOMINANT';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export interface Airport {
  code: string; // IATA
  name: string;
  city: string;
  country: string; // ISO-3166 alpha-2
  timezone: string; // IANA
  /** Coarse grouping used for UI and for the mock provider. */
  region: 'EUROPE' | 'MIDDLE_EAST' | 'ASIA' | 'OTHER';
}

/** Where the traveller actually lives / starts. */
export interface HomeSettings {
  name: string;
  countryCode: string;
  timezone: string;
  /** Local time at which one leaves home the previous evening when an airport hotel is needed. */
  hotelEveningDepartureTime: string; // "HH:MM"
  /** Minimum rest at a hotel before leaving for the airport (used when the evening-departure rule is impossible). */
  minHotelRestMinutes: number;
  /** Luggage / exit time after landing back at the European airport. */
  airportExitMinutes: number;
  currency: 'EUR';
  /** Static conversion rates: 1 unit of key = value EUR. */
  fxRatesToEur: Record<string, number>;
}

/** Cost and time of getting from home to a departure airport (and back). */
export interface OriginAccessProfile {
  airportCode: string;
  enabled: boolean;
  preferredAccessMode: AccessMode;
  /** Home -> airport travel time, one direction. */
  accessTravelMinutes: number;
  /** Generic monetary cost per direction (e.g. positioning flight, taxi). */
  accessMonetaryCost: number;
  /** Time needed inside the airport before departure. */
  airportBufferMinutes: number;
  /** Earliest local departure time that is reachable from home on the same day. */
  sameDayEarliestDepartureTime: string; // "HH:MM"
  /** Cost of one airport hotel night. */
  hotelCost: number;
  hotelRequiredRule: HotelRule;
  /** Latest local arrival time back at this airport for which going home the same day is realistic. null = always. */
  returnHotelLatestArrivalTime: string | null;
  /** Per trip. */
  parkingCost: number;
  /** Per direction. */
  trainCost: number;
  /** Per direction. */
  fuelCost: number;
  /** Per direction. */
  tollCost: number;
  /** 0 (no inconvenience) .. 100 (unbearable). Subjective, editable. */
  inconveniencePenalty: number;
  notes: string;
}

export interface DestinationGateway {
  code: string;
  enabled: boolean;
  /** Luggage / immigration / airport exit time after landing. */
  exitBufferMinutes: number;
  /** Check-in / security time before the return departure. */
  checkInBufferMinutes: number;
  notes: string;
}

export interface GroundTransferProfile {
  id: string;
  fromCode: string; // airport IATA
  toPlace: string; // e.g. "KRABI"
  mode: GroundMode;
  enabled: boolean;
  minutes: number;
  monetaryCost: number; // per direction
  inconveniencePenalty: number; // 0..100
  notes: string;
}

// ---------------------------------------------------------------------------
// Preferences / configuration
// ---------------------------------------------------------------------------

export interface TransferConstraints {
  maxAirTransfers: number;
  maxIndividualLayoverMinutes: number;
  maxTotalLayoverMinutes: number;
  /** First departure to final arrival of this direction (air journey). */
  maxTotalJourneyMinutes: number;
  minConnectionMinutes: number;
  maxSelfTransfers: number;
  minSelfTransferBufferMinutes: number;
  airportChangesAllowed: boolean;
  overnightLayoversAllowed: boolean;
  selfTransferAllowed: boolean;
  mixedTicketAllowed: boolean;
  hktGroundTransferAllowed: boolean;
}

export interface TimePreferenceBand {
  start: string; // "HH:MM" inclusive
  end: string; // "HH:MM" exclusive; start > end means the band crosses midnight
  score: number; // arbitrary desirability, e.g. -30..+20
}

export interface TimePreferenceProfile {
  outboundDeparture: TimePreferenceBand[];
  outboundArrival: TimePreferenceBand[];
  returnDeparture: TimePreferenceBand[];
  returnArrival: TimePreferenceBand[];
}

export type ScoreCategory =
  | 'trueCost'
  | 'journeyTime'
  | 'flightTiming'
  | 'transferQuality'
  | 'fareAnomaly'
  | 'cabinQuality'
  | 'originInconvenience'
  | 'selfTransferRisk'
  | 'destinationTransfer';

export const SCORE_CATEGORIES: ScoreCategory[] = [
  'trueCost',
  'journeyTime',
  'flightTiming',
  'transferQuality',
  'fareAnomaly',
  'cabinQuality',
  'originInconvenience',
  'selfTransferRisk',
  'destinationTransfer',
];

export const SCORE_CATEGORY_LABELS: Record<ScoreCategory, string> = {
  trueCost: 'True journey cost',
  journeyTime: 'Door-to-door journey time',
  flightTiming: 'Flight timing',
  transferQuality: 'Transfer quality',
  fareAnomaly: 'Fare anomaly',
  cabinQuality: 'Cabin quality',
  originInconvenience: 'Origin inconvenience',
  selfTransferRisk: 'Self-transfer risk',
  destinationTransfer: 'Destination transfer',
};

export type ScoreWeights = Record<ScoreCategory, number>;

/** Tunable, non-personal parameters of the deterministic scoring curves. */
export interface ScoringParams {
  /** Points removed per hour of active travel burden beyond the best result in the set. */
  journeyTimePointsPerExtraHour: number;
  /** Fraction (0..1) of hotel rest time that still counts as journey burden in the time score. */
  hotelRestBurdenFactor: number;
  /** Points removed per 1% of true cost above the cheapest result in the set. */
  costPointsPerPercentAboveBest: number;
  idealConnectionMinMinutes: number;
  idealConnectionMaxMinutes: number;
  pointsPerTransfer: number;
  pointsPerHourOverIdealConnection: number;
  shortConnectionMaxPenalty: number;
  overnightLayoverPenalty: number;
  airportChangePenalty: number;
  hotelInconveniencePenalty: number;
  selfTransferRiskPenalty: number;
  selfTransferTightBufferPenalty: number;
  baggageRecheckPenalty: number;
  /** Bonus (0..N) available for a well-timed overnight long-haul sleep opportunity. */
  sleepOpportunityMaxBonus: number;
  /** Segments at least this long are considered long-haul for sleep scoring. */
  longHaulMinMinutes: number;
  /** Weighting of the four timing curves. */
  timingDepartureWeight: number;
  timingArrivalWeight: number;
}

export interface SelfTransferPolicy {
  /** Minutes below which a self-transfer buffer counts as "tight". */
  tightBufferMinutes: number;
  /** Extra buffer assumed when baggage must be re-checked. */
  baggageRecheckExtraMinutes: number;
}

export interface DealThresholds {
  /** Percentage below reference fare required for each level (ascending). */
  good: number;
  excellent: number;
  exceptional: number;
  insane: number;
}

export interface AlertThresholds {
  /** Overall score thresholds (inclusive lower bounds). */
  digest: number;
  notification: number;
  immediate: number;
  urgent: number;
}

export interface TripProfile {
  id: string;
  name: string;
  isDefault: boolean;
  passengers: number;
  outboundEarliestDate: string; // YYYY-MM-DD
  outboundLatestDate: string;
  returnEarliestDate: string;
  returnLatestDate: string;
  minTripDays: number;
  preferredTripDaysMin: number;
  preferredTripDaysMax: number;
  maxTripDays: number;
  /** Cabins to search; each produces its own provider requests and is scored as its own "requested cabin". */
  cabins: Cabin[];
  /** Minimum acceptable cabin on feeder / short-haul segments (long-haul segments must always be in the requested cabin). */
  feederMinCabin: Cabin;
  mixedCabinAllowed: boolean;
  outboundConstraints: TransferConstraints;
  returnConstraints: TransferConstraints;
  timePreferences: TimePreferenceProfile;
  scoringWeights: ScoreWeights;
  scoringParams: ScoringParams;
  selfTransferPolicy: SelfTransferPolicy;
  enabledOrigins: string[];
  enabledArrivalGateways: string[];
  /** Origin used as the comparison baseline for "saving per extra hour". */
  baselineOrigin: string;
  /** Upper bound on live validation searches performed for this profile per run. */
  maxValidationCandidates: number;
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

export interface FlightSegment {
  origin: string;
  destination: string;
  departureUtc: string; // ISO 8601 with Z
  departureLocal: string; // ISO 8601 local, no offset: YYYY-MM-DDTHH:MM
  arrivalUtc: string;
  arrivalLocal: string;
  marketingCarrier: string; // IATA
  operatingCarrier: string;
  marketingCarrierName?: string;
  flightNumber: string;
  aircraft: string | null;
  cabin: Cabin;
  fareClass?: string | null;
  seatProduct?: string | null; // e.g. "full_flat"
  durationMinutes: number;
  /** Segments in the same ticket group are on one booking (protected). */
  ticketGroup: string;
  originTerminal?: string | null;
  destinationTerminal?: string | null;
}

export interface Connection {
  airport: string;
  /** For airport changes, the airport the next segment departs from. */
  nextAirport: string;
  type: ConnectionType;
  minutes: number;
  overnight: boolean;
  airportChange: boolean;
  terminalChange: boolean;
  baggageRecheckExpected: boolean;
  arrivalLocal: string;
  departureLocal: string;
}

export interface ItineraryLeg {
  direction: Direction;
  segments: FlightSegment[];
  connections: Connection[];
  departureUtc: string;
  departureLocal: string;
  arrivalUtc: string;
  arrivalLocal: string;
  /** First departure to final arrival. */
  totalMinutes: number;
  airMinutes: number;
  connectionMinutes: number;
  longestConnectionMinutes: number;
  transfers: number;
  protectedConnections: number;
  selfTransfers: number;
}

export interface CabinSummary {
  requestedCabin: Cabin;
  /** Percentage (0..100) of air minutes flown in the requested cabin or better. */
  premiumCabinPercent: number;
  /** Percentage of long-haul air minutes flown in the requested cabin or better. */
  longHaulPremiumPercent: number;
  lowestCabin: Cabin;
  highestCabin: Cabin;
  mixedCabin: boolean;
  /** True when a mixed-cabin itinerary might be mistaken for a fully premium one. */
  misleadingMixedCabin: boolean;
}

export interface ProviderFareAlternative {
  provider: string;
  providerOfferId: string;
  fare: number;
  currency: string;
  fareEur: number;
  providerExpiresAt: string | null;
}

/** Final price established by walking the booking flow up to (not through) payment, or by a pricing API. */
export interface VerifiedFare {
  amount: number;
  currency: string;
  amountEur: number;
  verifiedAt: string;
  /** e.g. "booking-flow:mock-airline", "api:duffel" */
  source: string;
  breakdown: Array<{ label: string; amount: number }>;
}

export interface NormalizedItinerary {
  id: string;
  provider: string;
  providerOfferId: string;
  fare: number;
  currency: string;
  /** Fare converted to EUR (the internal currency). */
  fareEur: number;
  /** Set once the booking flow / pricing API has confirmed the final price. */
  verifiedFare?: VerifiedFare | null;
  outbound: ItineraryLeg;
  inbound: ItineraryLeg;
  cabinSummary: CabinSummary;
  originAirport: string;
  arrivalGateway: string;
  segments: FlightSegment[];
  protectedConnections: number;
  selfTransfers: number;
  totalAirMinutes: number;
  totalConnectionMinutes: number;
  ticketGroups: string[];
  /** Airline that owns the itinerary (marketing carrier of the long-haul segment). */
  primaryAirline: string;
  primaryAirlineName?: string;
  providerExpiresAt: string | null;
  rawProviderReference: unknown;
  fingerprint: string;
  alternatives: ProviderFareAlternative[];
  firstSeen?: string;
  lastSeen?: string;
  lastValidated?: string;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface FlightSearchRequest {
  origin: string;
  destination: string; // gateway
  outboundDate: string; // YYYY-MM-DD
  returnDate: string;
  passengers: number;
  cabin: Cabin;
  /** Minimum cabin for feeder / short-haul segments. */
  feederCabin: Cabin;
  maxConnections: number;
}

export interface DateFareEstimate {
  origin: string;
  destination: string;
  outboundDate: string;
  returnDate: string;
  estimatedFareEur: number;
  provider: string;
}

export interface DiscoveryRequest {
  origin: string;
  destination: string;
  outboundDates: string[];
  returnDates: string[];
  passengers: number;
  cabin: Cabin;
}

// ---------------------------------------------------------------------------
// Enriched journeys
// ---------------------------------------------------------------------------

export interface HotelDecision {
  required: boolean;
  reason: string;
  cost: number;
  /** Rest time at the hotel that is excluded from the active travel burden. */
  restMinutes: number;
}

export interface OriginAccessResult {
  airportCode: string;
  mode: AccessMode;
  travelMinutes: number;
  /** Per direction monetary cost (access + train + fuel + toll). */
  costPerDirection: number;
  parkingCost: number;
  bufferMinutes: number;
  inconveniencePenalty: number;
}

export interface GroundTransferResult {
  required: boolean;
  fromCode: string;
  toPlace: string;
  mode: GroundMode | null;
  minutes: number;
  costPerDirection: number;
  inconveniencePenalty: number;
}

export interface CostBreakdown {
  /** Quoted airfare (EUR). */
  airfare: number;
  /** Difference between the verified final price and the quoted fare (0 while unverified). */
  bookingFees: number;
  /** True when `bookingFees` comes from a verified final price. */
  fareVerified: boolean;
  accessOutbound: number;
  accessReturn: number;
  hotelOutbound: number;
  hotelReturn: number;
  parking: number;
  groundOutbound: number;
  groundReturn: number;
  other: number;
  trueJourneyCost: number;
}

export interface JourneyTimeline {
  /** Local time (home timezone) of leaving home. */
  leaveHomeLocal: string;
  leaveHomeUtc: string;
  /** Local time in Krabi. */
  arriveKrabiLocal: string;
  arriveKrabiUtc: string;
  homeToAirportMinutes: number;
  airportBufferMinutes: number;
  flightJourneyMinutes: number;
  connectionMinutes: number;
  destinationExitMinutes: number;
  destinationGroundMinutes: number;
  hotelRestMinutes: number;
  /** Everything from leaving home to arriving in Krabi, including hotel rest. */
  totalElapsedMinutes: number;
  /** Elapsed minus hotel rest. */
  activeTravelBurdenMinutes: number;
}

export interface ReturnTimeline {
  leaveKrabiLocal: string;
  leaveKrabiUtc: string;
  arriveHomeLocal: string;
  arriveHomeUtc: string;
  groundMinutes: number;
  checkInBufferMinutes: number;
  flightJourneyMinutes: number;
  connectionMinutes: number;
  airportExitMinutes: number;
  airportToHomeMinutes: number;
  hotelRestMinutes: number;
  totalElapsedMinutes: number;
  activeTravelBurdenMinutes: number;
}

export interface EnrichedJourney {
  itinerary: NormalizedItinerary;
  originAccess: OriginAccessResult;
  hotelOutbound: HotelDecision;
  hotelReturn: HotelDecision;
  groundTransfer: GroundTransferResult;
  cost: CostBreakdown;
  outboundTimeline: JourneyTimeline;
  returnTimeline: ReturnTimeline;
  /** Outbound door-to-Krabi elapsed minutes. */
  doorToKrabiMinutes: number;
  krabiToDoorMinutes: number;
  totalDoorToDoorMinutes: number;
  totalElapsedJourneyMinutes: number;
  totalActiveTravelBurdenMinutes: number;
  tripDays: number;
}

export interface ScoreReason {
  sign: '+' | '-' | '=';
  text: string;
  category: ScoreCategory;
}

export interface BaselineComparison {
  baselineItineraryId: string | null;
  baselineOrigin: string | null;
  baselineStrategy: 'BASELINE_ORIGIN' | 'LOW_FRICTION' | 'NONE';
  savingVsBaseline: number | null;
  extraMinutesVsBaseline: number | null;
  savingPerExtraHour: number | null;
  dominant: boolean;
  isBaseline: boolean;
}

export interface DealAssessment {
  level: DealLevel;
  /** Reference "normal" fare in EUR. */
  referenceFare: number | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  percentBelowReference: number | null;
  source: 'HISTORY' | 'SEARCH_DISTRIBUTION' | 'NONE';
  comparableObservations: number;
  lowestObservedComparable: number | null;
}

export interface ScoredJourney extends EnrichedJourney {
  categoryScores: Record<ScoreCategory, number>;
  overallScore: number;
  reasons: ScoreReason[];
  labels: ResultLabel[];
  baseline: BaselineComparison;
  deal: DealAssessment;
  paretoDominated: boolean;
  dominatedBy: string | null;
  /** Combined convenience measure used by Pareto analysis (0..100). */
  convenienceScore: number;
  rank: number;
  sleepOpportunityScore: number;
}

export interface RejectedItinerary {
  itineraryId: string;
  fingerprint: string;
  originAirport: string;
  arrivalGateway: string;
  fareEur: number;
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Observations / history
// ---------------------------------------------------------------------------

export interface FareObservation {
  id?: string;
  observedAt: string;
  originAirport: string;
  arrivalGateway: string;
  outboundDate: string;
  inboundDate: string;
  airline: string;
  cabin: Cabin;
  fare: number;
  currency: string;
  fareEur: number;
  provider: string;
  itineraryFingerprint: string;
  searchRunId?: string | null;
}

// ---------------------------------------------------------------------------
// Pipeline configuration
// ---------------------------------------------------------------------------

export interface PipelineContext {
  profile: TripProfile;
  home: HomeSettings;
  airports: Record<string, Airport>;
  originProfiles: Record<string, OriginAccessProfile>;
  gateways: Record<string, DestinationGateway>;
  groundTransfers: GroundTransferProfile[];
  /** Comparable historic observations for deal intelligence. */
  history: FareObservation[];
  dealThresholds: DealThresholds;
  /** Fixed reference date used for deterministic output (ISO). Defaults to now. */
  now?: string;
}

export interface PipelineStats {
  received: number;
  afterDedup: number;
  rejected: number;
  scored: number;
  paretoDominated: number;
  dealCounts: Record<DealLevel, number>;
}

export interface PipelineResult {
  journeys: ScoredJourney[];
  rejected: RejectedItinerary[];
  stats: PipelineStats;
}
