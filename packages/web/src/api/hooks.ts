import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatrixMetric } from '@kfr/core';
import { api } from './client';

export const keys = {
  reference: ['reference'] as const,
  settings: ['settings'] as const,
  origins: ['origins'] as const,
  gateways: ['gateways'] as const,
  ground: ['ground'] as const,
  profiles: ['profiles'] as const,
  profile: (id: string) => ['profiles', id] as const,
  profileDefaults: ['profiles', 'defaults'] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  matrix: (id: string, metric: MatrixMetric) => ['runs', id, 'matrix', metric] as const,
  itineraries: (ids: string[]) => ['itineraries', ids.join(',')] as const,
  radar: (profileId?: string) => ['radar', profileId ?? 'default'] as const,
  history: (q: object) => ['history', q] as const,
  historySummary: ['history', 'summary'] as const,
  providers: ['providers'] as const,
  scheduler: ['scheduler'] as const,
};

export const useReference = () => useQuery({ queryKey: keys.reference, queryFn: api.reference, staleTime: Infinity });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useOrigins = () => useQuery({ queryKey: keys.origins, queryFn: api.origins });
export const useGateways = () => useQuery({ queryKey: keys.gateways, queryFn: api.gateways });
export const useGroundTransfers = () => useQuery({ queryKey: keys.ground, queryFn: api.groundTransfers });
export const useProfiles = () => useQuery({ queryKey: keys.profiles, queryFn: api.profiles });
export const useProfile = (id: string | undefined) => useQuery({ queryKey: keys.profile(id ?? ''), queryFn: () => api.profile(id!), enabled: Boolean(id) });
export const useProfileDefaults = () => useQuery({ queryKey: keys.profileDefaults, queryFn: api.profileDefaults, staleTime: Infinity });
export const useRuns = () => useQuery({ queryKey: keys.runs, queryFn: () => api.runs() });
export const useRun = (id: string | undefined) => useQuery({ queryKey: keys.run(id ?? ''), queryFn: () => api.run(id!), enabled: Boolean(id) });
export const useMatrix = (id: string | undefined, metric: MatrixMetric) => useQuery({ queryKey: keys.matrix(id ?? '', metric), queryFn: () => api.matrix(id!, metric), enabled: Boolean(id) });
export const useItineraries = (ids: string[]) => useQuery({ queryKey: keys.itineraries(ids), queryFn: () => api.itineraries(ids), enabled: ids.length > 0 });
export const useRadar = (profileId?: string) => useQuery({ queryKey: keys.radar(profileId), queryFn: () => api.radar(profileId) });
export const useHistory = (q: { origin?: string; gateway?: string; cabin?: string; days?: number }) => useQuery({ queryKey: keys.history(q), queryFn: () => api.history(q) });
export const useHistorySummary = () => useQuery({ queryKey: keys.historySummary, queryFn: api.historySummary });
export const useProviderStatus = () => useQuery({ queryKey: keys.providers, queryFn: api.providerStatus, refetchInterval: 30000 });
export const useScheduler = () => useQuery({ queryKey: keys.scheduler, queryFn: api.scheduler, refetchInterval: 30000 });

export function useInvalidate() {
  const qc = useQueryClient();
  return (...groups: Array<readonly unknown[]>) => Promise.all(groups.map((g) => qc.invalidateQueries({ queryKey: g })));
}

export function useRunSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.runSearch,
    onSuccess: (res) => {
      qc.setQueryData(keys.run(res.run.id), res);
      void qc.invalidateQueries({ queryKey: keys.runs });
      void qc.invalidateQueries({ queryKey: ['radar'] });
      void qc.invalidateQueries({ queryKey: ['history'] });
      void qc.invalidateQueries({ queryKey: keys.providers });
    },
  });
}
