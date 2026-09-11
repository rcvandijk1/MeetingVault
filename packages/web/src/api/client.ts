import type {
  Airport,
  AlertThresholds,
  CabinQualityLabel,
  DestinationGateway,
  FareConfidence,
  FareIntelligenceConfig,
  FareObservation,
  FareOpportunity,
  FareOpportunityType,
  FareTrend,
  RobustStats,
  TravelObjective,
  GroundTransferProfile,
  HomeSettings,
  OriginAccessProfile,
  OriginMatrix,
  MatrixMetric,
  PipelineStats,
  RejectedItinerary,
  ScoreWeights,
  ScoredJourney,
  TripProfile,
  ScoringParams,
  TimePreferenceProfile,
  TransferConstraints,
  SelfTransferPolicy,
  DealLevel,
} from '@kfr/core';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues?: Array<{ path: (string | number)[]; message: string }>,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) } });
  if (!res.ok) {
    let body: { error?: string; issues?: ApiError['issues'] } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* ignore */
    }
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.issues);
  }
  return (await res.json()) as T;
}

const get = <T>(url: string): Promise<T> => request<T>(url);
const post = <T>(url: string, body?: unknown): Promise<T> => request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(url: string, body: unknown): Promise<T> => request<T>(url, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(url: string): Promise<T> => request<T>(url, { method: 'DELETE' });

export interface Settings {
  home: HomeSettings;
  fareIntelligence: FareIntelligenceConfig;
  alertThresholds: AlertThresholds;
}

export interface Reference {
  airports: Airport[];
  airlines: Record<string, string>;
  cabins: string[];
  accessModes: string[];
  groundModes: string[];
  dealLevels: DealLevel[];
  dealLevelLabels: Record<DealLevel, string>;
  confidences: FareConfidence[];
  cabinQualities: CabinQualityLabel[];
  opportunityTypes: FareOpportunityType[];
  objective: TravelObjective;
  scoreCategories: Array<{ key: keyof ScoreWeights; label: string }>;
}

export type StoredOpportunity = FareOpportunity & { searchRunId: string; classification: DealLevel; dealScore: number | null };

export interface DealsResponse {
  run: SearchRunSummary | null;
  journeys: ScoredJourney[];
  summary: { byClassification: Record<DealLevel, number>; byConfidence: Record<string, number>; byCabinQuality: Record<string, number>; total: number };
  opportunities: StoredOpportunity[];
  observationCount: number;
}

export interface FingerprintHistory {
  fingerprint: string;
  observations: FareObservation[];
  count: number;
  stats: RobustStats | null;
  trend: FareTrend | null;
}

export interface SearchRunSummary {
  id: string;
  profileId: string | null;
  profileName: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  stats: (PipelineStats & { datePairs: number; discoveryCalls: number; searchCalls: number; cacheHits: number; providersUsed: string[]; durationMs: number }) | null;
  providerErrors: Array<{ provider: string; error: string; time: string; request: unknown }>;
  error: string | null;
  resultCount: number;
}

export interface SearchRunDetail extends SearchRunSummary {
  request: unknown;
  profileSnapshot: TripProfile;
  rejected: RejectedItinerary[];
}

export interface SearchResponse {
  run: SearchRunDetail;
  journeys: ScoredJourney[];
  rejected: RejectedItinerary[];
}

export interface RadarResponse {
  profile: TripProfile | null;
  run: SearchRunSummary | null;
  dealCounts: Record<DealLevel, number>;
  alertCounts: Record<string, number>;
  top: ScoredJourney[];
  journeys: ScoredJourney[];
  opportunities: StoredOpportunity[];
}

export interface ProviderStatus {
  configured: string[];
  health: Array<{ provider: string; ok: boolean; configured: boolean; message: string; checkedAt: string }>;
  usage24h: Array<{ provider: string; calls: number; liveCalls: number; errors: number; avgDurationMs: number; lastError: string | null; lastErrorAt: string | null }>;
  recentErrors: Array<{ provider: string; error: string | null; time: string; request: unknown; kind: string }>;
  limits: { maxConcurrency: number; minIntervalMs: number; cacheTtlMinutes: number };
}

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  runsCompleted: number;
  alertsSent: number;
}

export type VerificationStatus = 'QUEUED' | 'RUNNING' | 'VERIFIED' | 'FAILED' | 'UNSUPPORTED';

export interface Verification {
  id: string;
  itineraryId: string;
  searchRunId: string | null;
  status: VerificationStatus;
  driver: string | null;
  attempts: number;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  quotedFare: number;
  quotedCurrency: string;
  finalPrice: number | null;
  finalCurrency: string | null;
  finalPriceEur: number | null;
  breakdown: Array<{ label: string; amount: number }>;
  steps: Array<{ name: string; at: string; ok: boolean; url?: string | null; screenshot?: string | null; screenshotUrl: string | null; note?: string | null }>;
  error: string | null;
}

export interface VerificationWorkerStatus {
  enabled: boolean;
  running: number;
  queued: number;
  concurrency: number;
  drivers: Array<{ name: string; kind: 'BROWSER' | 'API' }>;
  browser: { running: boolean; executablePath: string | null; lastError: string | null };
  processed: number;
  verified: number;
  failed: number;
  lastError: string | null;
}

export interface ProfileDefaults extends Omit<TripProfile, 'id'> {
  defaults: {
    weights: ScoreWeights;
    scoringParams: ScoringParams;
    timePreferences: TimePreferenceProfile;
    outboundConstraints: TransferConstraints;
    returnConstraints: TransferConstraints;
    selfTransferPolicy: SelfTransferPolicy;
  };
}

export type TripProfileInput = Omit<TripProfile, 'id'>;

export interface HistorySummaryRow {
  originAirport: string;
  arrivalGateway: string;
  cabin: string;
  count: number;
  minFareEur: number;
  medianFareEur: number;
  lastObservedAt: string;
}

export const api = {
  reference: () => get<Reference>('/api/reference'),
  settings: () => get<Settings>('/api/settings'),
  updateSettings: (s: Partial<Settings>) => put<Settings>('/api/settings', s),
  origins: () => get<OriginAccessProfile[]>('/api/origins'),
  saveOrigin: (o: OriginAccessProfile) => put<OriginAccessProfile>(`/api/origins/${o.airportCode}`, o),
  deleteOrigin: (code: string) => del<{ deleted: string }>(`/api/origins/${code}`),
  saveAirport: (a: Airport) => put<Airport>(`/api/airports/${a.code}`, a),
  gateways: () => get<DestinationGateway[]>('/api/gateways'),
  saveGateway: (g: DestinationGateway) => put<DestinationGateway>(`/api/gateways/${g.code}`, g),
  groundTransfers: () => get<GroundTransferProfile[]>('/api/ground-transfers'),
  saveGroundTransfer: (g: GroundTransferProfile) => put<GroundTransferProfile>(`/api/ground-transfers/${g.id}`, g),
  deleteGroundTransfer: (id: string) => del<{ deleted: string }>(`/api/ground-transfers/${id}`),
  profiles: () => get<TripProfile[]>('/api/profiles'),
  profile: (id: string) => get<TripProfile>(`/api/profiles/${id}`),
  profileDefaults: () => get<ProfileDefaults>('/api/profiles/defaults'),
  createProfile: (p: TripProfileInput) => post<TripProfile>('/api/profiles', p),
  updateProfile: (id: string, p: TripProfileInput) => put<TripProfile>(`/api/profiles/${id}`, p),
  deleteProfile: (id: string) => del<{ deleted: string }>(`/api/profiles/${id}`),
  setDefaultProfile: (id: string) => post<TripProfile>(`/api/profiles/${id}/default`),
  runSearch: (body: { profileId?: string; overrides?: Partial<TripProfileInput> }) => post<SearchResponse & { stats: PipelineStats }>('/api/search', body),
  runs: (profileId?: string) => get<SearchRunSummary[]>(`/api/search?limit=50${profileId ? `&profileId=${profileId}` : ''}`),
  run: (id: string) => get<SearchResponse>(`/api/search/${id}`),
  matrix: (id: string, metric: MatrixMetric) => get<OriginMatrix>(`/api/search/${id}/matrix?metric=${metric}`),
  itinerary: (id: string) => get<ScoredJourney>(`/api/itineraries/${id}`),
  itineraries: (ids: string[]) => get<ScoredJourney[]>(`/api/itineraries?ids=${ids.join(',')}`),
  refreshItinerary: (id: string) => post<{ journey: ScoredJourney; refreshed: boolean; error: string | null }>(`/api/itineraries/${id}/refresh`),
  rescore: (runId: string, weights: ScoreWeights, persist = false) => post<{ journeys: ScoredJourney[] }>('/api/scoring/rescore', { runId, weights, persist }),
  radar: (profileId?: string) => get<RadarResponse>(`/api/radar${profileId ? `?profileId=${profileId}` : ''}`),
  history: (q: { origin?: string; gateway?: string; cabin?: string; days?: number }) => {
    const params = new URLSearchParams();
    if (q.origin) params.set('origin', q.origin);
    if (q.gateway) params.set('gateway', q.gateway);
    if (q.cabin) params.set('cabin', q.cabin);
    if (q.days) params.set('days', String(q.days));
    return get<{ observations: FareObservation[]; count: number }>(`/api/history?${params.toString()}`);
  },
  historySummary: () => get<HistorySummaryRow[]>('/api/history/summary'),
  fingerprintHistory: (fingerprint: string, currentFareEur?: number) => get<FingerprintHistory>(`/api/history/fingerprint/${fingerprint}${currentFareEur !== undefined ? `?currentFareEur=${currentFareEur}` : ''}`),
  deals: (q: { runId?: string; profileId?: string; cabin?: string }) => {
    const params = new URLSearchParams();
    if (q.runId) params.set('runId', q.runId);
    if (q.profileId) params.set('profileId', q.profileId);
    if (q.cabin) params.set('cabin', q.cabin);
    return get<DealsResponse>(`/api/deals?${params.toString()}`);
  },
  opportunities: (q: { runId?: string; days?: number; type?: string; cabin?: string }) => {
    const params = new URLSearchParams();
    if (q.runId) params.set('runId', q.runId);
    if (q.days) params.set('days', String(q.days));
    if (q.type) params.set('type', q.type);
    if (q.cabin) params.set('cabin', q.cabin);
    return get<StoredOpportunity[]>(`/api/opportunities?${params.toString()}`);
  },
  fareIntelligenceDefaults: () => get<FareIntelligenceConfig>('/api/settings/fare-intelligence/defaults'),
  providerStatus: () => get<ProviderStatus>('/api/providers/status'),
  scheduler: () => get<SchedulerStatus>('/api/scheduler'),
  verifications: (q: { runId?: string; ids?: string[] }) => {
    const params = new URLSearchParams();
    if (q.runId) params.set('runId', q.runId);
    if (q.ids?.length) params.set('ids', q.ids.join(','));
    return get<Verification[]>(`/api/verifications?${params.toString()}`);
  },
  verification: (id: string) => get<Verification>(`/api/verifications/${id}`),
  verifyItinerary: (itineraryId: string) => post<Verification>(`/api/itineraries/${itineraryId}/verify`),
  verificationStatus: () => get<VerificationWorkerStatus>('/api/verifications/status'),
  runScheduler: () => post<{ runId: string | null; alerts: number; status: SchedulerStatus }>('/api/scheduler/run'),
};
