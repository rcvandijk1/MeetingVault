export interface ParetoPoint {
  id: string;
  cost: number;
  minutes: number;
  convenience: number;
}

/**
 * An option is Pareto-dominated when another option is at least as cheap, at
 * least as fast and at least as convenient, and strictly better in at least
 * one of the three.
 */
export function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  const geq = a.cost <= b.cost && a.minutes <= b.minutes && a.convenience >= b.convenience;
  const strict = a.cost < b.cost || a.minutes < b.minutes || a.convenience > b.convenience;
  return geq && strict;
}

export function paretoAnalysis(points: ParetoPoint[]): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const p of points) {
    let dominatedBy: string | null = null;
    for (const q of points) {
      if (q.id === p.id) continue;
      if (dominates(q, p)) {
        dominatedBy = q.id;
        break;
      }
    }
    result.set(p.id, dominatedBy);
  }
  return result;
}
