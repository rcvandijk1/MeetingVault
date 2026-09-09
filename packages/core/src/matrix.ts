import type { ScoredJourney } from './types.js';

export type MatrixMetric = 'airfare' | 'trueCost' | 'score' | 'doorToDoor';

export interface MatrixCell {
  itineraryId: string;
  airfare: number;
  trueCost: number;
  score: number;
  doorToDoor: number;
  dealLevel: ScoredJourney['deal']['level'];
}

export interface MatrixRow {
  origin: string;
  cells: Record<string, MatrixCell | null>;
  /** Gateway with the best cell for the given metric. */
  best: string | null;
  bestScore: number | null;
}

export interface OriginMatrix {
  gateways: string[];
  metric: MatrixMetric;
  rows: MatrixRow[];
}

function better(metric: MatrixMetric, a: MatrixCell, b: MatrixCell): boolean {
  switch (metric) {
    case 'airfare':
      return a.airfare < b.airfare;
    case 'trueCost':
      return a.trueCost < b.trueCost;
    case 'score':
      return a.score > b.score;
    case 'doorToDoor':
      return a.doorToDoor < b.doorToDoor;
  }
}

/** Departure airports × gateways, showing the best journey per cell for the chosen metric. */
export function buildOriginMatrix(journeys: ScoredJourney[], metric: MatrixMetric, gateways?: string[]): OriginMatrix {
  const gws = gateways ?? [...new Set(journeys.map((j) => j.itinerary.arrivalGateway))].sort();
  const origins = [...new Set(journeys.map((j) => j.itinerary.originAirport))].sort();
  const rows: MatrixRow[] = origins.map((origin) => {
    const cells: Record<string, MatrixCell | null> = {};
    let best: string | null = null;
    let bestCell: MatrixCell | null = null;
    let bestScore: number | null = null;
    for (const gw of gws) {
      let cell: MatrixCell | null = null;
      for (const j of journeys) {
        if (j.itinerary.originAirport !== origin || j.itinerary.arrivalGateway !== gw) continue;
        const c: MatrixCell = { itineraryId: j.itinerary.id, airfare: j.itinerary.fareEur, trueCost: j.cost.trueJourneyCost, score: j.overallScore, doorToDoor: j.totalDoorToDoorMinutes, dealLevel: j.deal.level };
        if (!cell || better(metric, c, cell)) cell = c;
        if (bestScore === null || j.overallScore > bestScore) bestScore = j.overallScore;
      }
      cells[gw] = cell;
      if (cell && (!bestCell || better(metric, cell, bestCell))) {
        bestCell = cell;
        best = gw;
      }
    }
    return { origin, cells, best, bestScore };
  });
  rows.sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1));
  return { gateways: gws, metric, rows };
}
