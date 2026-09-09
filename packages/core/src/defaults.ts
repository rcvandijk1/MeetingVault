import type {
  AlertThresholds,
  DealThresholds,
  DestinationGateway,
  GroundTransferProfile,
  HomeSettings,
  OriginAccessProfile,
  ScoreWeights,
  ScoringParams,
  SelfTransferPolicy,
  TimePreferenceProfile,
  TransferConstraints,
  TripProfile,
} from './types.js';

/**
 * Seed defaults. Everything here is editable through the API/UI and stored
 * in PostgreSQL; nothing in the scoring logic reads these constants directly.
 */

export const DEFAULT_HOME: HomeSettings = {
  name: 'Alphen aan den Rijn',
  countryCode: 'NL',
  timezone: 'Europe/Amsterdam',
  hotelEveningDepartureTime: '18:00',
  minHotelRestMinutes: 480,
  airportExitMinutes: 40,
  currency: 'EUR',
  fxRatesToEur: { EUR: 1, USD: 0.92, GBP: 1.17, THB: 0.026, CHF: 1.05, DKK: 0.134, SEK: 0.088, NOK: 0.087, PLN: 0.23, CZK: 0.04, HUF: 0.0025, AED: 0.25, QAR: 0.25, SGD: 0.69 },
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  trueCost: 30,
  journeyTime: 20,
  flightTiming: 15,
  transferQuality: 10,
  fareAnomaly: 10,
  cabinQuality: 5,
  originInconvenience: 5,
  selfTransferRisk: 3,
  destinationTransfer: 2,
};

export const DEFAULT_SCORING_PARAMS: ScoringParams = {
  journeyTimePointsPerExtraHour: 4,
  hotelRestBurdenFactor: 0.3,
  costPointsPerPercentAboveBest: 1.5,
  idealConnectionMinMinutes: 90,
  idealConnectionMaxMinutes: 150,
  pointsPerTransfer: 12,
  pointsPerHourOverIdealConnection: 8,
  shortConnectionMaxPenalty: 30,
  overnightLayoverPenalty: 20,
  airportChangePenalty: 25,
  hotelInconveniencePenalty: 25,
  selfTransferRiskPenalty: 40,
  selfTransferTightBufferPenalty: 20,
  baggageRecheckPenalty: 10,
  sleepOpportunityMaxBonus: 10,
  longHaulMinMinutes: 300,
  timingDepartureWeight: 1,
  timingArrivalWeight: 1,
};

export const DEFAULT_SELF_TRANSFER_POLICY: SelfTransferPolicy = {
  tightBufferMinutes: 240,
  baggageRecheckExtraMinutes: 60,
};

export const DEFAULT_OUTBOUND_CONSTRAINTS: TransferConstraints = {
  maxAirTransfers: 2,
  maxIndividualLayoverMinutes: 300,
  maxTotalLayoverMinutes: 420,
  maxTotalJourneyMinutes: 1500,
  minConnectionMinutes: 60,
  maxSelfTransfers: 1,
  minSelfTransferBufferMinutes: 180,
  airportChangesAllowed: false,
  overnightLayoversAllowed: false,
  selfTransferAllowed: true,
  mixedTicketAllowed: true,
  hktGroundTransferAllowed: true,
};

export const DEFAULT_RETURN_CONSTRAINTS: TransferConstraints = {
  ...DEFAULT_OUTBOUND_CONSTRAINTS,
  maxIndividualLayoverMinutes: 300,
  maxTotalLayoverMinutes: 420,
};

/** Example desirability bands; editable in the UI. */
export const DEFAULT_TIME_PREFERENCES: TimePreferenceProfile = {
  outboundDeparture: [
    { start: '19:00', end: '23:00', score: 20 },
    { start: '15:00', end: '19:00', score: 15 },
    { start: '10:00', end: '15:00', score: 5 },
    { start: '07:00', end: '10:00', score: -10 },
    { start: '23:00', end: '07:00', score: -30 },
  ],
  outboundArrival: [
    { start: '09:00', end: '13:00', score: 20 },
    { start: '13:00', end: '17:00', score: 15 },
    { start: '17:00', end: '20:00', score: 5 },
    { start: '20:00', end: '23:00', score: -10 },
    { start: '23:00', end: '09:00', score: -30 },
  ],
  returnDeparture: [
    { start: '17:00', end: '22:00', score: 20 },
    { start: '13:00', end: '17:00', score: 10 },
    { start: '22:00', end: '01:00', score: 5 },
    { start: '08:00', end: '13:00', score: -5 },
    { start: '01:00', end: '08:00', score: -30 },
  ],
  returnArrival: [
    { start: '08:00', end: '13:00', score: 20 },
    { start: '13:00', end: '18:00', score: 10 },
    { start: '18:00', end: '22:00', score: 0 },
    { start: '06:00', end: '08:00', score: -10 },
    { start: '22:00', end: '06:00', score: -30 },
  ],
};

export const DEFAULT_DEAL_THRESHOLDS: DealThresholds = {
  good: 8,
  excellent: 16,
  exceptional: 25,
  insane: 40,
};

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  digest: 70,
  notification: 80,
  immediate: 90,
  urgent: 95,
};

export const DEFAULT_GATEWAYS: DestinationGateway[] = [
  { code: 'KBV', enabled: true, exitBufferMinutes: 35, checkInBufferMinutes: 120, notes: 'Krabi International — closest gateway.' },
  { code: 'HKT', enabled: true, exitBufferMinutes: 45, checkInBufferMinutes: 150, notes: 'Phuket — private driver to Krabi available.' },
];

export const DEFAULT_GROUND_TRANSFERS: GroundTransferProfile[] = [
  { id: 'KBV-KRABI', fromCode: 'KBV', toPlace: 'KRABI', mode: 'TAXI', enabled: true, minutes: 35, monetaryCost: 20, inconveniencePenalty: 5, notes: 'Airport taxi to Ao Nang / Krabi town.' },
  { id: 'HKT-KRABI', fromCode: 'HKT', toPlace: 'KRABI', mode: 'PRIVATE_DRIVER', enabled: true, minutes: 180, monetaryCost: 95, inconveniencePenalty: 30, notes: 'Private driver Phuket → Krabi, approx. 3 hours.' },
];

interface OriginSeed {
  code: string;
  enabled: boolean;
  mode: OriginAccessProfile['preferredAccessMode'];
  travel: number;
  access?: number;
  buffer?: number;
  earliest: string;
  hotel: number;
  parking?: number;
  train?: number;
  fuel?: number;
  toll?: number;
  returnLatest?: string | null;
  penalty: number;
  notes?: string;
}

const ORIGIN_SEEDS: OriginSeed[] = [
  { code: 'AMS', enabled: true, mode: 'CAR', travel: 45, buffer: 150, earliest: '06:00', hotel: 110, parking: 90, fuel: 10, penalty: 0, notes: 'Home airport. Long-term parking P3 or train via Leiden.' },
  { code: 'RTM', enabled: true, mode: 'CAR', travel: 35, buffer: 120, earliest: '06:00', hotel: 95, parking: 80, fuel: 8, penalty: 5, notes: 'Small airport, few long-haul feeders.' },
  { code: 'EIN', enabled: true, mode: 'CAR', travel: 80, buffer: 120, earliest: '07:00', hotel: 90, parking: 70, fuel: 20, penalty: 15 },
  { code: 'BRU', enabled: true, mode: 'CAR', travel: 120, buffer: 150, earliest: '08:00', hotel: 110, parking: 110, fuel: 30, penalty: 20 },
  { code: 'DUS', enabled: true, mode: 'CAR', travel: 135, buffer: 150, earliest: '08:30', hotel: 100, parking: 120, fuel: 35, penalty: 20, notes: 'Motorway all the way; ~2h15 without traffic.' },
  { code: 'CGN', enabled: true, mode: 'CAR', travel: 165, buffer: 150, earliest: '09:00', hotel: 100, parking: 110, fuel: 40, penalty: 25 },
  { code: 'FRA', enabled: true, mode: 'TRAIN', travel: 270, buffer: 150, earliest: '11:30', hotel: 130, train: 75, penalty: 35, notes: 'ICE from Utrecht; earlier departures need a hotel.' },
  { code: 'LUX', enabled: false, mode: 'CAR', travel: 240, buffer: 150, earliest: '11:00', hotel: 120, parking: 100, fuel: 55, penalty: 40 },
  { code: 'CDG', enabled: true, mode: 'TRAIN', travel: 240, buffer: 150, earliest: '11:00', hotel: 140, train: 95, penalty: 35, notes: 'Thalys/Eurostar to Paris Nord + RER.' },
  { code: 'LHR', enabled: true, mode: 'POSITIONING_FLIGHT', travel: 300, buffer: 180, earliest: '13:00', hotel: 150, access: 110, penalty: 45 },
  { code: 'DUB', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 330, buffer: 180, earliest: '14:00', hotel: 140, access: 120, penalty: 50 },
  { code: 'CPH', enabled: true, mode: 'POSITIONING_FLIGHT', travel: 300, buffer: 180, earliest: '13:00', hotel: 140, access: 140, parking: 90, fuel: 10, penalty: 45, returnLatest: '18:00', notes: 'Drive to AMS, KLM/SAS positioning flight to CPH; early departures need a hotel.' },
  { code: 'OSL', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 330, buffer: 180, earliest: '14:00', hotel: 160, access: 150, penalty: 50, returnLatest: '18:00' },
  { code: 'ARN', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 330, buffer: 180, earliest: '14:00', hotel: 150, access: 150, penalty: 50, returnLatest: '18:00' },
  { code: 'HEL', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 360, buffer: 180, earliest: '15:00', hotel: 150, access: 160, penalty: 55, returnLatest: '17:00' },
  { code: 'BER', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 300, buffer: 180, earliest: '13:00', hotel: 110, access: 120, penalty: 45, returnLatest: '18:00' },
  { code: 'HAM', enabled: false, mode: 'TRAIN', travel: 330, buffer: 150, earliest: '13:00', hotel: 110, train: 90, penalty: 40 },
  { code: 'MUC', enabled: true, mode: 'POSITIONING_FLIGHT', travel: 300, buffer: 180, earliest: '13:00', hotel: 130, access: 130, penalty: 45, returnLatest: '18:00' },
  { code: 'ZRH', enabled: true, mode: 'POSITIONING_FLIGHT', travel: 300, buffer: 180, earliest: '13:00', hotel: 170, access: 140, penalty: 45, returnLatest: '18:00' },
  { code: 'VIE', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 330, buffer: 180, earliest: '14:00', hotel: 120, access: 140, penalty: 50, returnLatest: '18:00' },
  { code: 'PRG', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 330, buffer: 180, earliest: '14:00', hotel: 100, access: 130, penalty: 50, returnLatest: '18:00' },
  { code: 'WAW', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 360, buffer: 180, earliest: '15:00', hotel: 90, access: 140, penalty: 55, returnLatest: '17:00' },
  { code: 'BUD', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 360, buffer: 180, earliest: '15:00', hotel: 90, access: 140, penalty: 55, returnLatest: '17:00' },
  { code: 'MXP', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 330, buffer: 180, earliest: '14:00', hotel: 120, access: 130, penalty: 50, returnLatest: '18:00' },
  { code: 'FCO', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 360, buffer: 180, earliest: '15:00', hotel: 120, access: 140, penalty: 55, returnLatest: '17:00' },
  { code: 'MAD', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 360, buffer: 180, earliest: '15:00', hotel: 110, access: 150, penalty: 55, returnLatest: '17:00' },
  { code: 'BCN', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 360, buffer: 180, earliest: '15:00', hotel: 120, access: 150, penalty: 55, returnLatest: '17:00' },
  { code: 'LIS', enabled: false, mode: 'POSITIONING_FLIGHT', travel: 390, buffer: 180, earliest: '16:00', hotel: 110, access: 170, penalty: 60, returnLatest: '17:00' },
];

export const DEFAULT_ORIGIN_PROFILES: OriginAccessProfile[] = ORIGIN_SEEDS.map((s) => ({
  airportCode: s.code,
  enabled: s.enabled,
  preferredAccessMode: s.mode,
  accessTravelMinutes: s.travel,
  accessMonetaryCost: s.access ?? 0,
  airportBufferMinutes: s.buffer ?? 150,
  sameDayEarliestDepartureTime: s.earliest,
  hotelCost: s.hotel,
  hotelRequiredRule: 'AUTO',
  returnHotelLatestArrivalTime: s.returnLatest ?? null,
  parkingCost: s.parking ?? 0,
  trainCost: s.train ?? 0,
  fuelCost: s.fuel ?? 0,
  tollCost: s.toll ?? 0,
  inconveniencePenalty: s.penalty,
  notes: s.notes ?? '',
}));

export function buildDefaultProfile(overrides: Partial<TripProfile> = {}): TripProfile {
  return {
    id: 'default',
    name: 'Krabi — winter escape',
    isDefault: true,
    passengers: 2,
    outboundEarliestDate: '2027-01-15',
    outboundLatestDate: '2027-02-05',
    returnEarliestDate: '2027-01-30',
    returnLatestDate: '2027-02-28',
    minTripDays: 14,
    preferredTripDaysMin: 16,
    preferredTripDaysMax: 21,
    maxTripDays: 24,
    longHaulCabin: 'BUSINESS',
    feederEconomyAllowed: true,
    mixedCabinAllowed: true,
    outboundConstraints: { ...DEFAULT_OUTBOUND_CONSTRAINTS },
    returnConstraints: { ...DEFAULT_RETURN_CONSTRAINTS },
    timePreferences: JSON.parse(JSON.stringify(DEFAULT_TIME_PREFERENCES)) as TimePreferenceProfile,
    scoringWeights: { ...DEFAULT_WEIGHTS },
    scoringParams: { ...DEFAULT_SCORING_PARAMS },
    selfTransferPolicy: { ...DEFAULT_SELF_TRANSFER_POLICY },
    enabledOrigins: ['AMS', 'RTM', 'BRU', 'DUS', 'FRA', 'CDG', 'CPH', 'MUC', 'ZRH', 'LHR'],
    enabledArrivalGateways: ['KBV', 'HKT'],
    baselineOrigin: 'AMS',
    maxValidationCandidates: 48,
    ...overrides,
  };
}
