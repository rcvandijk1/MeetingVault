import type { BaselineComparison, ResultLabel, ScoreCategory, ScoreWeights, ScoredJourney } from '../types.js';
import { SCORE_CATEGORIES, SCORE_CATEGORY_LABELS } from '../types.js';

export function computeOverall(scores: Record<ScoreCategory, number>, weights: ScoreWeights): number {
  const total = SCORE_CATEGORIES.reduce((s, c) => s + Math.max(0, weights[c]), 0);
  if (total === 0) return 0;
  const sum = SCORE_CATEGORIES.reduce((s, c) => s + scores[c] * Math.max(0, weights[c]), 0);
  return Math.round((sum / total) * 10) / 10;
}

export interface ScoreBreakdownRow {
  category: ScoreCategory;
  label: string;
  score: number;
  weight: number;
  weightPercent: number;
  contribution: number;
}

export function explainScore(scores: Record<ScoreCategory, number>, weights: ScoreWeights): { rows: ScoreBreakdownRow[]; final: number } {
  const total = SCORE_CATEGORIES.reduce((s, c) => s + Math.max(0, weights[c]), 0);
  const rows = SCORE_CATEGORIES.map((c) => {
    const w = Math.max(0, weights[c]);
    const pct = total === 0 ? 0 : (w / total) * 100;
    return {
      category: c,
      label: SCORE_CATEGORY_LABELS[c],
      score: scores[c],
      weight: w,
      weightPercent: Math.round(pct * 10) / 10,
      contribution: Math.round(((scores[c] * pct) / 100) * 100) / 100,
    };
  });
  return { rows, final: computeOverall(scores, weights) };
}

export interface RankOptions {
  weights: ScoreWeights;
  baselineOrigin: string;
}

/**
 * Recomputes everything that depends on the weights: overall score, ranking,
 * labels and the baseline comparison. Category scores, Pareto status and deal
 * levels are weight-independent and left untouched, which is what makes
 * instant re-scoring in the UI possible without a new search.
 */
export function rankJourneys(input: ScoredJourney[], opts: RankOptions): ScoredJourney[] {
  const journeys = input.map((j) => ({ ...j, overallScore: computeOverall(j.categoryScores, opts.weights), labels: [] as ResultLabel[] }));
  journeys.sort((a, b) => b.overallScore - a.overallScore || a.cost.trueJourneyCost - b.cost.trueJourneyCost || a.itinerary.id.localeCompare(b.itinerary.id));
  journeys.forEach((j, i) => (j.rank = i + 1));
  if (journeys.length === 0) return journeys;

  // Baseline comparison and labels are computed per requested cabin: comparing a
  // business fare with an economy baseline would be meaningless.
  for (const cabin of new Set(journeys.map((j) => j.itinerary.cabinSummary.requestedCabin))) {
    applyBaselineAndLabels(
      journeys.filter((j) => j.itinerary.cabinSummary.requestedCabin === cabin),
      opts,
    );
  }
  return journeys;
}

function applyBaselineAndLabels(journeys: ScoredJourney[], opts: RankOptions): void {
  // Baseline selection: best low-friction itinerary from the baseline origin
  // (no hotel, no self-transfer), then any baseline-origin itinerary, then the
  // best low-friction itinerary overall, then simply the best overall.
  const isLowFriction = (j: ScoredJourney): boolean => !j.hotelOutbound.required && j.itinerary.selfTransfers === 0;
  const baselineCandidates = journeys.filter((j) => j.itinerary.originAirport === opts.baselineOrigin);
  let baseline: ScoredJourney | undefined = baselineCandidates.find(isLowFriction) ?? baselineCandidates[0];
  let strategy: BaselineComparison['baselineStrategy'] = 'BASELINE_ORIGIN';
  if (!baseline) {
    baseline = journeys.find(isLowFriction) ?? journeys[0];
    strategy = 'LOW_FRICTION';
  }

  for (const j of journeys) {
    if (!baseline) {
      j.baseline = { baselineItineraryId: null, baselineOrigin: null, baselineStrategy: 'NONE', savingVsBaseline: null, extraMinutesVsBaseline: null, savingPerExtraHour: null, dominant: false, isBaseline: false };
      continue;
    }
    const isBaseline = j.itinerary.id === baseline.itinerary.id;
    const saving = Math.round((baseline.cost.trueJourneyCost - j.cost.trueJourneyCost) * 100) / 100;
    const extra = j.totalActiveTravelBurdenMinutes - baseline.totalActiveTravelBurdenMinutes;
    const savingPerExtraHour = !isBaseline && saving > 0 && extra > 0 ? Math.round((saving / (extra / 60)) * 100) / 100 : null;
    j.baseline = {
      baselineItineraryId: baseline.itinerary.id,
      baselineOrigin: baseline.itinerary.originAirport,
      baselineStrategy: strategy,
      savingVsBaseline: isBaseline ? null : saving,
      extraMinutesVsBaseline: isBaseline ? null : extra,
      savingPerExtraHour,
      dominant: !isBaseline && saving > 0 && extra <= 0,
      isBaseline,
    };
  }

  // Labels
  const push = (j: ScoredJourney | undefined, l: ResultLabel): void => {
    if (j && !j.labels.includes(l)) j.labels.push(l);
  };
  push(journeys[0], 'BEST_OVERALL');
  push([...journeys].sort((a, b) => a.itinerary.fareEur - b.itinerary.fareEur)[0], 'CHEAPEST');
  push([...journeys].sort((a, b) => a.totalDoorToDoorMinutes - b.totalDoorToDoorMinutes)[0], 'FASTEST');
  push([...journeys].sort((a, b) => b.categoryScores.flightTiming - a.categoryScores.flightTiming)[0], 'BEST_TIMING');
  push(baselineCandidates[0], 'BEST_BASELINE_ORIGIN');
  push(journeys.find((j) => j.itinerary.originAirport !== opts.baselineOrigin), 'BEST_ALTERNATIVE_ORIGIN');
  for (const j of journeys) if (j.baseline.dominant) push(j, 'DOMINANT');
}
