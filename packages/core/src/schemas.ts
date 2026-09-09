import { z } from 'zod';

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const cabinSchema = z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);
export const accessModeSchema = z.enum(['CAR', 'TRAIN', 'POSITIONING_FLIGHT', 'OTHER']);
export const hotelRuleSchema = z.enum(['AUTO', 'ALWAYS', 'NEVER']);
export const groundModeSchema = z.enum(['PRIVATE_DRIVER', 'TAXI', 'SHUTTLE', 'BUS', 'FERRY', 'OTHER']);

export const transferConstraintsSchema = z.object({
  maxAirTransfers: z.number().int().min(0).max(4),
  maxIndividualLayoverMinutes: z.number().int().min(30).max(2880),
  maxTotalLayoverMinutes: z.number().int().min(30).max(4320),
  maxTotalJourneyMinutes: z.number().int().min(300).max(7200),
  minConnectionMinutes: z.number().int().min(20).max(600),
  maxSelfTransfers: z.number().int().min(0).max(3),
  minSelfTransferBufferMinutes: z.number().int().min(30).max(1440),
  airportChangesAllowed: z.boolean(),
  overnightLayoversAllowed: z.boolean(),
  selfTransferAllowed: z.boolean(),
  mixedTicketAllowed: z.boolean(),
  hktGroundTransferAllowed: z.boolean(),
});

export const timeBandSchema = z.object({ start: hhmm, end: hhmm, score: z.number().min(-100).max(100) });

export const timePreferenceProfileSchema = z.object({
  outboundDeparture: z.array(timeBandSchema),
  outboundArrival: z.array(timeBandSchema),
  returnDeparture: z.array(timeBandSchema),
  returnArrival: z.array(timeBandSchema),
});

export const scoreWeightsSchema = z.object({
  trueCost: z.number().min(0).max(100),
  journeyTime: z.number().min(0).max(100),
  flightTiming: z.number().min(0).max(100),
  transferQuality: z.number().min(0).max(100),
  fareAnomaly: z.number().min(0).max(100),
  cabinQuality: z.number().min(0).max(100),
  originInconvenience: z.number().min(0).max(100),
  selfTransferRisk: z.number().min(0).max(100),
  destinationTransfer: z.number().min(0).max(100),
});

export const scoringParamsSchema = z.object({
  journeyTimePointsPerExtraHour: z.number().min(0).max(50),
  hotelRestBurdenFactor: z.number().min(0).max(1),
  costPointsPerPercentAboveBest: z.number().min(0).max(20),
  idealConnectionMinMinutes: z.number().int().min(30).max(600),
  idealConnectionMaxMinutes: z.number().int().min(30).max(900),
  pointsPerTransfer: z.number().min(0).max(100),
  pointsPerHourOverIdealConnection: z.number().min(0).max(100),
  shortConnectionMaxPenalty: z.number().min(0).max(100),
  overnightLayoverPenalty: z.number().min(0).max(100),
  airportChangePenalty: z.number().min(0).max(100),
  hotelInconveniencePenalty: z.number().min(0).max(100),
  selfTransferRiskPenalty: z.number().min(0).max(100),
  selfTransferTightBufferPenalty: z.number().min(0).max(100),
  baggageRecheckPenalty: z.number().min(0).max(100),
  sleepOpportunityMaxBonus: z.number().min(0).max(50),
  longHaulMinMinutes: z.number().int().min(60).max(1200),
  timingDepartureWeight: z.number().min(0).max(10),
  timingArrivalWeight: z.number().min(0).max(10),
});

export const selfTransferPolicySchema = z.object({
  tightBufferMinutes: z.number().int().min(0).max(1440),
  baggageRecheckExtraMinutes: z.number().int().min(0).max(600),
});

export const tripProfileInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    isDefault: z.boolean().default(false),
    passengers: z.number().int().min(1).max(9),
    outboundEarliestDate: isoDate,
    outboundLatestDate: isoDate,
    returnEarliestDate: isoDate,
    returnLatestDate: isoDate,
    minTripDays: z.number().int().min(1).max(365),
    preferredTripDaysMin: z.number().int().min(1).max(365),
    preferredTripDaysMax: z.number().int().min(1).max(365),
    maxTripDays: z.number().int().min(1).max(365),
    longHaulCabin: cabinSchema,
    feederEconomyAllowed: z.boolean(),
    mixedCabinAllowed: z.boolean(),
    outboundConstraints: transferConstraintsSchema,
    returnConstraints: transferConstraintsSchema,
    timePreferences: timePreferenceProfileSchema,
    scoringWeights: scoreWeightsSchema,
    scoringParams: scoringParamsSchema,
    selfTransferPolicy: selfTransferPolicySchema,
    enabledOrigins: z.array(z.string().length(3)).min(1),
    enabledArrivalGateways: z.array(z.string().length(3)).min(1),
    baselineOrigin: z.string().length(3),
    maxValidationCandidates: z.number().int().min(1).max(500).default(48),
  })
  .refine((p) => p.outboundEarliestDate <= p.outboundLatestDate, { message: 'Outbound window is inverted', path: ['outboundLatestDate'] })
  .refine((p) => p.returnEarliestDate <= p.returnLatestDate, { message: 'Return window is inverted', path: ['returnLatestDate'] })
  .refine((p) => p.minTripDays <= p.preferredTripDaysMin && p.preferredTripDaysMin <= p.preferredTripDaysMax && p.preferredTripDaysMax <= p.maxTripDays, {
    message: 'Trip day bounds must satisfy min <= preferredMin <= preferredMax <= max',
    path: ['maxTripDays'],
  });

export const originAccessProfileSchema = z.object({
  airportCode: z.string().length(3),
  enabled: z.boolean(),
  preferredAccessMode: accessModeSchema,
  accessTravelMinutes: z.number().int().min(0).max(1440),
  accessMonetaryCost: z.number().min(0).max(5000),
  airportBufferMinutes: z.number().int().min(0).max(600),
  sameDayEarliestDepartureTime: hhmm,
  hotelCost: z.number().min(0).max(2000),
  hotelRequiredRule: hotelRuleSchema,
  returnHotelLatestArrivalTime: hhmm.nullable(),
  parkingCost: z.number().min(0).max(2000),
  trainCost: z.number().min(0).max(2000),
  fuelCost: z.number().min(0).max(2000),
  tollCost: z.number().min(0).max(2000),
  inconveniencePenalty: z.number().min(0).max(100),
  notes: z.string().max(1000).default(''),
});

export const destinationGatewaySchema = z.object({
  code: z.string().length(3),
  enabled: z.boolean(),
  exitBufferMinutes: z.number().int().min(0).max(300),
  checkInBufferMinutes: z.number().int().min(0).max(400),
  notes: z.string().max(1000).default(''),
});

export const groundTransferSchema = z.object({
  id: z.string().min(1).max(60),
  fromCode: z.string().length(3),
  toPlace: z.string().min(1).max(60),
  mode: groundModeSchema,
  enabled: z.boolean(),
  minutes: z.number().int().min(0).max(1440),
  monetaryCost: z.number().min(0).max(5000),
  inconveniencePenalty: z.number().min(0).max(100),
  notes: z.string().max(1000).default(''),
});

export const homeSettingsSchema = z.object({
  name: z.string().min(1).max(120),
  countryCode: z.string().length(2),
  timezone: z.string().min(1),
  hotelEveningDepartureTime: hhmm,
  minHotelRestMinutes: z.number().int().min(0).max(1440),
  airportExitMinutes: z.number().int().min(0).max(300),
  currency: z.literal('EUR'),
  fxRatesToEur: z.record(z.string(), z.number().positive()),
});

export const dealThresholdsSchema = z.object({
  good: z.number().min(0).max(100),
  excellent: z.number().min(0).max(100),
  exceptional: z.number().min(0).max(100),
  insane: z.number().min(0).max(100),
});

export const alertThresholdsSchema = z.object({
  digest: z.number().min(0).max(100),
  notification: z.number().min(0).max(100),
  immediate: z.number().min(0).max(100),
  urgent: z.number().min(0).max(100),
});

export const airportSchema = z.object({
  code: z.string().length(3),
  name: z.string().min(1),
  city: z.string().min(1),
  country: z.string().length(2),
  timezone: z.string().min(1),
  region: z.enum(['EUROPE', 'MIDDLE_EAST', 'ASIA', 'OTHER']),
});

export type TripProfileInput = z.infer<typeof tripProfileInputSchema>;
