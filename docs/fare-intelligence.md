# Historical Fare Intelligence & Business-Class Deal Detection

This document is the living reference for the fare-intelligence engine of Krabi
Flight Radar. Part 1 is the pre-implementation inspection that shaped the design;
Part 2 documents the implemented engine (methodology, scoring model, database and
UI changes, tests, self-audit, assumptions and limitations).

---

## Part 1 — Pre-implementation inspection

### Existing architecture (before this engine)

- **Monorepo**: `packages/core` (pure TypeScript domain engine, shared by browser and
  Node), `packages/server` (Fastify + Drizzle/PostgreSQL), `packages/web` (React +
  TanStack Query + Recharts).
- **Pipeline** (`core/src/pipeline/index.ts`): normalize → dedupe by physical
  fingerprint → hard constraints per direction → enrich (origin access, hotel, ground
  transfer, true journey cost, door-to-door timelines) → nine category scores → Pareto →
  deal assessment → rank (weighted overall score, baseline comparison, labels).
- **Fare observations**: append-only `fare_observations` rows written for every
  itinerary of every run (plus provider alternatives) with route, dates, airline,
  cabin, fare, provider, fingerprint and run id. `known_itineraries` tracks first/last
  seen, lowest and latest fare per fingerprint.
- **Deal intelligence** (`pipeline/deal.ts`): reference = median/p25/p75 of history of
  the same cabin (same origin+gateway first, then any route, ≥ 5 observations) or of
  the current search distribution; levels NORMAL/GOOD/EXCELLENT/EXCEPTIONAL/INSANE by
  percent below reference; `fareAnomalyScore = 50 + 2 × percentBelow`.
- **Verification**: booking-flow drivers establish a final price which feeds
  `CostBreakdown.bookingFees` and the true journey cost.
- **UI**: Radar (deal counts + results), Search, Compare, History (Recharts line per
  origin→gateway), Profiles, Settings (deal thresholds card).

### Reusable components

- Fingerprint (`itineraryFingerprint`) — stable physical identity for price-drop
  tracking; already indexed on `fare_observations`.
- `CabinSummary` — `premiumCabinPercent` and `longHaulPremiumPercent` are exactly the
  duration-weighted inputs the mixed-cabin protection needs.
- `CostBreakdown.trueJourneyCost` — already the "True Trip Cost" (financial); the engine
  only adds an optional, separately reported value of time.
- `BaselineComparison` — saving per extra hour versus the baseline origin; the
  alternative-airport break-even fare is a one-line extension of it.
- `PipelineContext.history`, `Repositories.queryObservations`, the History page chart,
  `DealBadge`, result filters and the settings thresholds card.
- Deterministic pipeline + `rescoreJourneys` (weight-only re-ranking) stay untouched.

### Required changes

1. **Domain model**: six-level classification (+ UNKNOWN), confidence, cohort summary,
   robust statistics, market position, fare trend, cabin-quality assessment,
   opportunities, trip-cost view, richer `FareObservation`, `FareIntelligenceConfig`,
   `TravelObjective`, break-even fields on the baseline comparison, Journey Value Score.
2. **Core engine** (`core/src/intelligence/`): statistics, objective/route family,
   season and advance-purchase bands, cohort selection with four fallback levels and
   dynamic windows, classification and Deal Score, market position, trend detection,
   opportunity detection, explanations.
3. **Pipeline**: the deal step uses the engine; `fareAnomaly` category fed by the Deal
   Score; opportunities detected after ranking (they need baseline/cross-journey data).
4. **Persistence**: new observation columns (backfilled from stored itineraries),
   dedupe index, `fare_opportunities` table, `app_settings.fare_intelligence` config,
   wider `deal_level` column, drop `deal_thresholds`.
5. **Server**: history loaded for the whole objective (all cabins, two years) so
   cohorts and trends see everything; opportunities persisted per run; new endpoints
   (deal explorer, opportunities, fingerprint history, config).
6. **Web**: Deal Explorer page (Business Class view by default), richer badges, deal
   explanation drawer with fare-history chart (current / median / low), market panel,
   break-even, opportunities feed on the Radar, settings card.
7. **Tests + docs**: unit, acceptance scenarios A–H, self-audit checks, server API,
   end-to-end; this document and the README.

### Risks / unknowns

- **Cold start**: the mock provider produces little variance; history-based cohorts
  only become meaningful after repeated scheduled runs. Handled by honest confidence
  (`NONE`/`LOW`) and score dampening, never by inventing baselines.
- **Legacy observations** lack cabin-quality fields; a SQL backfill from stored
  itineraries covers rows written by search runs. Rows that cannot be backfilled are
  excluded from cohorts (documented limitation).
- **Level widening bias**: comparing DUS fares with AMS history (level 3) mixes airport
  price levels; confidence is capped at MEDIUM for level 3 and LOW for level 4.
- **Deal-level renaming** touches persisted `score_results.deal_level` (varchar width)
  and the UI vocabulary; the migration widens the column, old rows keep their legacy
  labels and are only re-labelled when a run is re-scored.
- **Business-vs-economy anomaly** needs an economy cohort; it only fires when economy
  history for the same route exists.

---

## Part 2 — Implemented engine

### Implemented

- Historical fare baseline persistence with enriched, append-only observations (trip length,
  days to departure, stops, connection airports, leg times, total duration, taxes when
  itemised, provider offer id, duration-weighted cabin quality, route family, verified
  flag) and a per-run/per-offer dedupe index.
- Normalized cohort comparison with four fallback levels, dynamic observation windows,
  season and advance-purchase bands, robust statistics, HIGH/MEDIUM/LOW/NONE confidence,
  and the cohort level, window, sample count and relaxations recorded on every verdict.
- Six-band configurable classification (plus UNKNOWN), Deal Score 0–100, explicit-baseline
  savings, current-market position kept separate from history, price trend per fingerprint,
  six FareOpportunity event types, mixed-cabin protection, alternative-airport break-even,
  Journey Value Score alias, optional value of time (disabled by default), explanations.
- Server: migration 0003/0004, repositories, history loading for the whole objective, deal
  explorer / opportunities / fingerprint-history / config endpoints, opportunities persisted
  per run and refreshed on re-scoring.
- Web: Deals page (Deal Explorer, Business Class view by default), richer badges, "Fare deal"
  tab in the journey drawer with explanations, statistics, market position, price movement,
  fare-history chart (current / median / low), cost-vs-burden and break-even panels,
  opportunity feed on the Radar, fare-intelligence settings editor.
- Tests: 48 core unit/acceptance/self-audit tests, 4 new server API tests, 1 new end-to-end
  flow; lint, typecheck and build green.

### Architecture

```
packages/core/src/intelligence/
  stats.ts          percentile, median, robustStats, percentileRank
  objective.ts      TravelObjective (KRABI_REGION), route family, origin regions, seasons,
                    advance-purchase bands, duration-weighted cabin quality
  cohort.ts         data-quality gate, cohort levels 1–4, window widening, outlier fence
  trend.ts          per-fingerprint price movement (first/last/lowest/highest, 7d/30d medians)
  assess.ts         classification, confidence, deal score, market position, cost view,
                    assessFare (the verdict), explainDeal
  opportunities.ts  FareOpportunity detection on the ranked set
```

`pipeline/deal.ts` calls `assessFare` for every accepted itinerary; the resulting Deal Score
feeds the existing `fareAnomaly` category, so the nine-category Journey Value Score and the
instant client-side re-scoring are unchanged. After ranking, `detectOpportunities` runs once
over the ranked journeys (it needs the baseline comparison and the other journeys). The
`FareIntelligenceConfig` lives in `app_settings.fare_intelligence` and is merged with the core
defaults on read, so new keys never require a migration. The `TravelObjective` abstraction
carries the gateways of the route family (KBV direct, HKT with ground onward, BKK with an
onward flight — an extension point, not searched by default) and the origin regions used by
cohort level 3.

### Scoring model

**Classification** = fare ÷ normalized cohort median × 100, mapped onto configurable
upper bounds: ≤60% Exceptional, ≤72% Excellent, ≤85% Good, ≤115% Normal, ≤135% Expensive,
above Very expensive. One documented extra rule ("below the floor"): a fare at least 15%
(configurable) below the lowest comparable fare ever observed lies outside the whole
observed distribution and is Exceptional regardless of the median band. UNKNOWN when no
reference at all exists.

**Deal Score (0–100)** — explicitly *not* a percentage discount:

```
position = clamp(50 + (1 − fare/median) × 133)          fare at the median = 50
rank     = (1 − percentileRank) × 100                   cheapest of the cohort = 100
vsLow    = 100 if fare ≤ cohort low, else clamp(100 − (fare/low − 1) × 250)
raw      = 0.6·position + 0.2·rank + 0.2·vsLow
score    = clamp(50 + (raw − 50) × confidenceMultiplier − cabinPenalty)
           confidenceMultiplier HIGH 1.0 · MEDIUM 0.85 · LOW 0.6 · NONE 0
           cabinPenalty FULL 0 · MOSTLY 5 · MIXED 15 (configurable)
```

Low confidence therefore pulls the score towards neutral instead of inventing certainty; a
40% discount on two observations scores lower than on fifty. The score is monotone in the
fare for a fixed cohort (tested), and only fare-related inputs enter it — journey quality
lives in the Journey Value Score.

**Journey Value Score** = the existing weighted nine-category overall score (`journeyValueScore`
is an explicit alias of `overallScore`). Fare deal is one category (default weight 10).

**Savings** are always stated against an explicit baseline: the cohort median
(`savingVsMedianEur`), the cohort p25, and the lowest comparable fare (`aboveLowestEur`).

**Confidence**: HIGH needs ≥ 20 comparable fares on ≥ 5 distinct days; MEDIUM ≥ 8 fares on
≥ 2 days; else LOW. Level 3 (same region) caps at MEDIUM, level 4 (any origin/gateway) at
LOW, a search-distribution reference is always LOW, and every downgrade carries a reason.

### Historical baseline methodology

1. **Data-quality gate**: fare > 0 and finite, same requested cabin, same cabin-quality tier
   (FULL / MOSTLY / MIXED — a mixed-cabin fare is never compared with full business fares),
   gateway inside the route family; observations without a cabin-quality label are excluded
   (counted as `excludedInvalid`).
2. **Cohort levels**: 1 = same origin + gateway + trip length (±3 days) + season + advance-
   purchase band; 2 = same origin + gateway; 3 = same origin region + gateway; 4 = any origin
   → any Krabi-region gateway. The most specific level with ≥ `minCohortSamples` (5) wins.
3. **Windows**: within a level the preferred window (90 days) is tried first, then 180, 365,
   all history; the window is widened before the level is dropped.
4. **Outliers**: values outside 0.2×median … 5×median or beyond the Tukey fence
   p25 − 3·IQR … p75 + 3·IQR (fence at least 15% of the median wide) are excluded, iterated
   up to three passes so multiple outliers cannot shelter each other. Excluded counts are
   reported. Nothing is winsorized; the reference is always the median of what remains.
5. **Statistics**: count, median, mean, p10/p25/p75/p90, stdev, min, max, recent (7-day)
   median, rolling (30-day) median, same-season median, percentile rank of the current fare.
6. **Fallback**: without a historical cohort the current search distribution (same cabin and
   quality tier: route → gateway → all, ≥ 3 fares) is used, labelled level 0 / "this search
   only", confidence LOW. With nothing comparable the verdict is UNKNOWN / NONE.
7. **Anti-manipulation**: only the application's own observed fares are ever used; maxima,
   list prices and marketing "was" prices have no code path into the reference.

### Current market methodology

Independently of history, each fare is placed among the comparable options of the current
search (same requested cabin and cabin-quality tier; scope route → gateway → cabin, ≥ 3
options): comparable count, cheapest, median, rank (1 = cheapest), difference and percent
above the cheapest. The UI shows both verdicts side by side ("historically cheap, but
4th of 5 today").

**Price movement** uses the stable itinerary fingerprint only: first/last/lowest/highest seen,
change versus the previous observation, 7-day and 30-day medians, new-low flag. A different
itinerary at a lower price is never reported as a drop.

**Opportunities** (severity INFO / NOTABLE / STRONG, own confidence, metrics, reason):
NEW_LOW (strictly below every earlier observation, ≥ 3 prior observations), SIGNIFICANT_DROP
(≥ 10% versus the previous observation or the 30-day median), HISTORICAL_OUTLIER
(Exceptional/Excellent with ≥ MEDIUM confidence from history), ALTERNATIVE_AIRPORT_OPPORTUNITY
(non-baseline origin saving ≥ €100 true cost and either dominant or ≥ €40 per extra hour;
the reason states the airfare saving, the true-cost saving and the break-even fare),
PREMIUM_CABIN_ANOMALY (full business/first at ≤ 2× the economy median of the route, or
Exceptional with ≥ MEDIUM confidence), ROUTING_OPPORTUNITY (secondary gateway beating every
primary-gateway option from the same origin by ≥ €150 true cost, never for Pareto-dominated
journeys).

### Database changes

- `fare_observations`: 18 new nullable columns (see Implemented), backfilled from stored
  itineraries by fingerprint; partial unique index on (run, provider, offer id, observed at).
- New table `fare_opportunities` (per run, cascade on run/itinerary delete).
- `app_settings.fare_intelligence` JSONB (partial config merged with defaults);
  `deal_thresholds` dropped (0004).
- `score_results.deal_level` widened to 16 characters; the `deal` JSONB now holds the full
  assessment. Rows scored before the engine are lifted to the new shape on read
  (`upgradeLegacyDeal`) with confidence NONE until the run is re-scored.

### UI changes

- New **Deals** screen: classification counters, best deal / coverage / confidence /
  opportunity stats, filters (classification, confidence, cabin quality, origin, minimum deal
  score, opportunities only, non-dominated), sorting (deal score, % of median, saving vs
  median, airfare, true cost, journey value, door-to-door), Business Class view by default.
- Journey drawer: badges now show classification + deal score + confidence dot and cabin
  quality; a **Fare deal** tab explains the verdict (why, historical baseline statistics,
  current market, price movement, fare-history chart with current/median/low lines, cost vs
  burden with the value-of-time state, alternative-airport break-even with the airfare-vs-
  true-cost narrative).
- Results table "Fare deal" column, new sort keys, classification/confidence/quality/
  opportunity filters; Compare rows for fare deal, % of median, saving vs median, journey
  value, airfare vs baseline, true cost vs baseline, break-even.
- Radar: seven-class counters and an opportunity feed. Settings: full fare-intelligence
  editor (thresholds, cohorts/confidence, windows, bands, outliers, drops, opportunity
  thresholds, cabin penalties, value of time). Wording uses "Deal score", "Fare
  classification", "% of median" and "percentile rank" — never "% discount".

### Tests

Core (`packages/core/test/intelligence.test.ts`, 48 tests): statistics; objective/season/
band/cabin-quality; cohort levels 1–4, most-specific-first, window widening, tier
isolation, invalid exclusion, outlier fence; classification bands and floor rule;
confidence (3/7/15/50/200 observations, time coverage, cohort quality); deal-score
monotonicity, non-discount semantics, confidence dampening, cabin penalty, clamping;
assessment details, silent-widening protection, cold start, market independence, tier
isolation of the market, determinism, wording; reference-price integrity with one and
several outliers and a marketing price; trend and fingerprint integrity; all six
opportunity types; value of time off/on; acceptance scenarios A, B, C, D, E, G, H;
journey-value sanity pair; pipeline plumbing. Scenario F is covered inside the market-
independence test. Existing suites (scoring, cabin, enrich, providers, pipeline
integration, constraints, time, normalize) still pass: 127 core tests in total.

Server (`packages/server/test/api.test.ts`, 31 tests): config round trip with threshold
validation, enriched observations and provider traceability, per-run dedupe, deal explorer
contract, opportunities and fingerprint history, plus the pre-existing search/persistence/
verification flows.

End-to-end (`e2e/flows.spec.ts`, 9 tests): Deal Explorer with sorting, filtering, drawer
"Fare deal" tab, non-discount wording, value-of-time disabled label, settings round trip.

### Self-audit results

| # | Audit | Result |
| --- | --- | --- |
| 1 | Reference price integrity | Every verdict carries cohort description, level, window, sample count, distinct days, median, p10–p90, min/max, percentile rank and confidence. Automated test: €11,800 among €2,900–€3,200 leaves the €3,050 reference, class, score and saving untouched; "78%" never appears. |
| 2 | Outlier resilience | Median + iterated IQR/ratio fence; one, three or a marketing outlier cannot move the median-based verdict (tests). No winsorization. |
| 3 | Cohort fallback | Level, relaxations and window are recorded; the explanation states "widened to … because more specific comparisons lacked samples"; confidence is capped by level. |
| 4 | Score monotonicity | Tested across €1,500–€4,500 for a fixed cohort; only fare inputs enter the Deal Score. |
| 5 | Journey value sanity | Cheap mixed-cabin FRA journey with positioning + hotel + two stops gets the higher Deal Score; the local full-business AMS journey gets the higher Journey Value (test). |
| 6 | Alternative airport break-even | `breakEvenFareEur` and `airfareSavingVsBaseline` on every non-baseline journey; scenario H: airfare €250 cheaper, true cost €5 dearer, break-even €1,945. |
| 7 | Time cost | Value of time disabled by default; when enabled it is a separate figure and never changes `trueJourneyCost` (tests). |
| 8 | Mixed cabin | Duration-weighted FULL/MOSTLY/MIXED; the two adversarial orderings are both MIXED with different percentages; tiers are never mixed in cohorts or market position; penalties apply. |
| 9 | Price-drop validity | Fingerprint-only trend; a cheaper different itinerary produces no NEW_LOW/SIGNIFICANT_DROP (test). |
| 10 | Current market vs historical | Independent `market` block; scenario F: historically cheap, 4th of 5 today. |
| 11 | Confidence honesty | Sample count, distinct days and cohort level all matter; 100 broad observations rank below 35 exact ones (test). |
| 12 | Data source conflicts | Dedupe by physical fingerprint keeps the cheapest offer and the other providers as alternatives; every provider fare is its own observation with provider and offer id; verified final prices are separate, flagged observations. Taxes/baggage/fare conditions are stored only when a provider itemises them (see limitations). |

### Assumptions

- The specification's worked examples and its starting thresholds disagree in two places
  (scenario A: 69% of the median called "exceptional"; scenario F: 75% called "excellent").
  The stated thresholds are kept as defaults; scenario A is satisfied through the documented
  below-the-floor rule; scenario F is asserted as "historically cheap" (one of Exceptional /
  Excellent / Good) with the market rank as the decisive contrast.
- Seasons are meteorological quarters of the outbound date; Thailand high season is not
  modelled separately (extension point: `seasonOf`).
- Advance-purchase bands use the observation date versus the outbound date.
- Trip-length tolerance ±3 days.
- Cohorts require the same cabin-quality tier; legacy observations that could not be
  backfilled are excluded rather than assumed FULL.
- Value of time, when enabled, is linear per active hour plus optional per-night and
  per-transfer amounts.

### Known biases

- **Self-reinforcing history**: observations come only from this application's searches, so
  the baseline reflects the profile's own date windows and origins. Rarely searched routes
  fall to wider cohorts (capped confidence, but still a bias towards busy routes).
- **Window preference**: 90 days first means a fare is judged against recent conditions; a
  slow multi-month decline makes yesterday's high fares the reference and flatters today's.
- **Search-distribution fallback**: the cheapest option in a thin search can be "Exceptional"
  relative to three expensive siblings (confidence LOW, but the label is still shown).
- **Below-the-floor rule** rewards being outside a *tight* distribution; with few,
  clustered observations it fires more easily than with a wide one.
- **Percentile rank** at cohort level 4 mixes airports with structurally different price
  levels.
- **Deal Score smoothing**: the vsLow component still awards points a few percent above the
  low, so a fare exactly at the median scores slightly above 50.

### Remaining limitations

- Taxes/fees, baggage inclusions and fare conditions are not delivered by the mock provider
  and only partially by Duffel; self-audit 12 is therefore limited to itinerary equivalence,
  cabin and provider traceability.
- No live provider is configured, so real history has to be built by the scheduler over
  weeks; until then most verdicts are search-distribution based (LOW) or UNKNOWN.
- Seasonality is coarse; the "Thailand peak season" cohort in the specification's example is
  approximated by meteorological winter.
- BKK-with-onward-flight is part of the route family but not searched or enriched as a
  gateway (no onward-flight model yet).
- Opportunities are not de-duplicated across runs: the same itinerary can raise NEW_LOW on
  consecutive runs if it keeps falling (intended for alerts, noisy for the feed).
- The fare-history chart draws the itinerary's own observations plus cohort median/low
  lines; it does not yet overlay the whole cohort's time series.

### Recommended next step

Wire a real fare source and let the scheduler run for a few weeks so cohorts reach MEDIUM/
HIGH confidence, then tune the classification thresholds and the below-the-floor margin
against observed distributions; in parallel de-duplicate repeated opportunities across runs
(suppress a NEW_LOW/SIGNIFICANT_DROP already reported for the same fingerprint within N
days) before connecting notifications to them.
