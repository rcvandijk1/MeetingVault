import type { RobustStats } from '../types.js';

/** Linear-interpolated percentile of an ascending array; p in 0..1. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

/** Fraction (0..1) of values strictly below x. 0 = x is the minimum. */
export function percentileRank(sorted: number[], x: number): number {
  if (sorted.length === 0) return 0;
  let below = 0;
  for (const v of sorted) {
    if (v < x) below++;
    else break;
  }
  return below / sorted.length;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Median-centred descriptive statistics. Returns null for an empty sample. */
export function robustStats(values: number[]): RobustStats | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    median: round2(percentile(sorted, 0.5)),
    mean: round2(mean),
    p10: round2(percentile(sorted, 0.1)),
    p25: round2(percentile(sorted, 0.25)),
    p75: round2(percentile(sorted, 0.75)),
    p90: round2(percentile(sorted, 0.9)),
    stdev: round2(Math.sqrt(variance)),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
