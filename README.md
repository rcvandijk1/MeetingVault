# Krabi Flight Radar

Personal flight intelligence engine for one journey: **home in Alphen aan den Rijn → Krabi, Thailand**.

It does not optimise airport → airport. It optimises **door → Krabi**: airfare **plus** getting to the departure
airport, airport hotels when a flight leaves too early, parking/train/fuel, the Phuket → Krabi driver when HKT is the
gateway, and the time and inconvenience of all of that — scored with transparent, configurable, deterministic rules.

```
Airfare                          €1,395
Travel to departure airport        €145
Airport hotel                      €120
Parking                             €55
HKT → Krabi driver                 €190
---------------------------------------
True journey cost                €1,905
```

## Stack

| Layer | Technology |
| --- | --- |
| `packages/core` | TypeScript domain engine (no framework): normalisation, hard constraints, enrichment, scoring, Pareto, deal intelligence, providers, orchestrator. Runs in Node **and** the browser. |
| `packages/server` | Node 20+, Fastify 5, Drizzle ORM, PostgreSQL 14+, Zod |
| `packages/web` | React 18, Vite, TanStack Query, React Router, Zustand (compare selection only), Recharts, Lucide |
| Tests | Vitest (unit + integration), Playwright (e2e) |

## Quick start

Requirements: Node ≥ 20, npm ≥ 10, PostgreSQL ≥ 14.

```bash
cp .env.example .env            # edit DATABASE_URL if needed
createdb krabi_flight_radar     # and krabi_flight_radar_test for the server tests
npm install
npm run dev                     # API on :4000, web on :5173 (proxies /api)
```

Open http://localhost:5173. The default configuration uses the **mock flight provider**, which needs no credentials
and returns deterministic, realistic itineraries (see *Mock data* below). Press **Run search now** on the Radar.

On first start the server applies the migrations and seeds reference data (airports, origin access profiles,
gateways, the HKT → Krabi driver, a default trip profile). Seeding never overwrites rows you have edited.

### Production build

```bash
npm run build      # typecheck core, bundle server (packages/server/dist), build web (packages/web/dist)
npm start          # serves API + the built web app on PORT (default 4000)
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` for all packages |
| `npm run lint` | ESLint over `packages` and `e2e` |
| `npm run test:unit` | core unit + pipeline integration tests (73) |
| `npm run test:server` | server API integration tests against `DATABASE_URL_TEST` (22) |
| `npm run test:e2e` | Playwright flows; starts its own API (port 4100) and web (5174) against `DATABASE_URL_TEST` |
| `npm run db:migrate` / `db:seed` / `db:generate` | migrations, seed, generate a new migration from the schema |

Playwright: the repo pins `@playwright/test` 1.56. Run `npx playwright install chromium` once, or point
`PLAYWRIGHT_CHROMIUM_PATH` at an existing Chromium.

## Real flight providers

Set `FLIGHT_PROVIDERS=mock,duffel,amadeus` (any combination) and the credentials in `.env`. Secrets stay on the
server; the browser only ever sees provider *names* and health.

| Provider | Endpoints used | Notes |
| --- | --- | --- |
| Duffel (v2) | `POST /air/offer_requests?return_offers=true`, `GET /air/offers/{id}` | Header `Duffel-Version: v2`. Local departure times + airport time zones from the response. |
| Amadeus Self-Service | `POST /v1/security/oauth2/token`, `GET /v2/shopping/flight-offers`, `POST /v1/shopping/flight-offers/pricing`, `GET /v1/shopping/flight-dates` (Stage A discovery) | `AMADEUS_BASE_URL` selects sandbox (`test.api.amadeus.com`) or production. |

The adapters were written against the official SDK contracts (`@duffel/api` 4.28, `amadeus` 11) because the
documentation sites were not reachable from the build environment. Both adapters are covered by unit tests with
recorded-shape fixtures; validate against the sandbox before relying on them in production.

Every provider call is logged (`provider_events`) with duration, result count and error, so future API cost is
visible on **Settings → Providers**. Concurrency, minimum interval between live calls and cache TTL are configured in
`.env`. One failing provider never fails the search: results from healthy providers are returned and the failure is
recorded on the run and shown in the UI.

## How a search works

```
TRIP PROFILE ─▶ ORIGIN CANDIDATES ─▶ Stage A discovery (cheap-date estimates per origin × gateway)
            ─▶ Stage B validation (bounded number of live searches, cached, rate limited;
                                   the top SEARCH_REPRICE_TOP_N journeys are re-priced before presentation)
            ─▶ NORMALIZATION (provider → NormalizedItinerary, UTC + local times, EUR)
            ─▶ DEDUPLICATION (fingerprint = flights + times + route + cabin; other providers kept as alternatives)
            ─▶ HARD CONSTRAINTS (per direction; violations eliminate, never merely lower a score)
            ─▶ HOME ACCESS ─▶ HOTEL RULE ─▶ DESTINATION GROUND ─▶ TRUE COST ─▶ DOOR-TO-DOOR
            ─▶ SOFT SCORING (9 categories, 0–100 each) ─▶ PARETO ─▶ DEAL INTELLIGENCE ─▶ RANKED JOURNEYS
```

Every stage is a pure function in `packages/core/src/pipeline` with its own tests.

### Scoring

| Category | Default weight | Deterministic rule |
| --- | --- | --- |
| True journey cost | 30 | 100 at the cheapest true cost in the set; `costPointsPerPercentAboveBest` per % above it |
| Door-to-door journey time | 20 | 100 at the lowest active travel burden; `journeyTimePointsPerExtraHour` per extra hour. Hotel rest counts at `hotelRestBurdenFactor` (default 0.3). |
| Flight timing | 15 | Four editable time-of-day band curves (outbound dep/arr, return dep/arr), normalised so the best band = 100; plus an optional long-haul sleep-opportunity bonus |
| Transfer quality | 10 | Points per transfer; too-short and too-long connections both lose points (ideal window configurable); overnight and airport changes penalised |
| Fare anomaly | 10 | % below the reference fare (history of the same route/cabin when ≥ 5 observations, else this search's distribution) |
| Cabin quality | 5 | % of air time in the requested cabin; misleading mixed cabins flagged |
| Origin inconvenience | 5 | Per-airport inconvenience penalty plus a penalty when a hotel is needed |
| Self-transfer risk | 3 | Penalty per self-transfer, extra for tight buffers and baggage re-check; protected connections score 100 |
| Destination transfer | 2 | 100 − ground-transfer inconvenience (KBV taxi vs HKT driver) |

Weights, curve parameters, bands and thresholds are all stored per trip profile and editable in the UI. Changing
weights re-scores loaded results **in the browser** (the same core code runs there) without touching providers.
Click any score for the full breakdown (`score × weight` per row) and the human-readable reasons.

### Economics

* **True journey cost** = airfare + access × 2 + hotel(s) + parking + destination ground transfer × 2.
* **Saving per extra hour** compares each journey with a baseline: the best low-friction (no hotel, no self-transfer)
  itinerary from the baseline origin (AMS by default), falling back to any baseline-origin itinerary, then to the best
  low-friction itinerary overall. A journey that is both cheaper and faster is marked **dominant**.
* **Pareto**: a journey is dominated when another is at least as cheap, as fast and as convenient (convenience =
  mean of transfer, origin, self-transfer and destination scores). Filter *Only non-dominated options* hides them.
* **Deal levels** NORMAL → INSANE come from the % below reference (thresholds editable in Settings). Airline "was/now"
  prices are never used. Every fare seen is appended to `fare_observations`; nothing is overwritten.

### Hotel logic

`hotelRequired = departureLocal < sameDayEarliestDepartureTime` (rule `AUTO`), overridable per airport with
`ALWAYS` / `NEVER`. When a hotel is required the timeline starts the previous evening (`hotelEveningDepartureTime`,
Settings → Home); the hotel night is included in *total elapsed* time but excluded from *active travel burden*. A
separate `returnHotelLatestArrivalTime` per airport handles late arrivals back in Europe.

## Data model (PostgreSQL)

`airports`, `app_settings` (home, FX rates, deal/alert thresholds), `origin_access_profiles`, `destination_gateways`,
`ground_transfer_profiles`, `trip_profiles` (constraints, time preferences, weights and parameters as JSONB — one
profile is a self-contained search configuration), `search_runs` (request, profile snapshot, stats, provider
errors, rejected itineraries), `itineraries`, `flight_segments`, `score_results`, `fare_observations` (append-only),
`known_itineraries` (first seen / last seen / last validated per fingerprint), `provider_offer_references`,
`provider_events`. Migrations live in `packages/server/drizzle`.

Timestamps are stored in UTC; local times are stored alongside per airport. Connections are computed from UTC
instants, never from local clock differences.

## API

`GET/PUT /api/settings` · `GET /api/reference` · `GET/PUT/DELETE /api/origins/:code` · `GET/PUT /api/gateways/:code` ·
`GET/PUT/DELETE /api/ground-transfers/:id` · `GET/POST /api/profiles`, `GET/PUT/DELETE /api/profiles/:id`,
`POST /api/profiles/:id/default`, `GET /api/profiles/defaults` · `POST /api/search`, `GET /api/search`,
`GET /api/search/:id`, `GET /api/search/:id/matrix?metric=` · `GET /api/itineraries?runId=|ids=`,
`GET /api/itineraries/:id`, `POST /api/itineraries/:id/refresh` · `POST /api/scoring/rescore`,
`POST /api/scoring/explain`, `GET /api/scoring/defaults` · `GET /api/time-preferences/defaults` ·
`GET /api/history`, `GET /api/history/summary` · `GET /api/radar` · `GET /api/providers/status` ·
`GET /api/scheduler`, `POST /api/scheduler/run` · `GET /api/health`.

## Background searching & alerts

`SCHEDULER_ENABLED=true` runs the default profile every `SCHEDULER_INTERVAL_HOURS`, stores observations and sends a
`DealAlert` through the configured `NotificationProvider` (`log` writes to the server log; Telegram/e-mail/push can
implement the same interface) for journeys that are new or cheaper than previously seen and above the alert
thresholds (`digest` / `notification` / `immediate` / `urgent`, editable in Settings).

## Mock data

`packages/core/src/providers/mock/templates.ts` contains deterministic fixtures: the great AMS → DOH → KBV Qatar
result, the cheap DUS → DOH → HKT (private driver) result, the cheap-but-bad FRA → BKK → KBV (hotel + 4h30
connection), the very cheap CPH → BKK → KBV (positioning flight + hotel), a KLM/Bangkok Airways self-transfer, an
Istanbul itinerary with a 7h layover (rejected by the default 5h maximum), an Emirates itinerary that is
Pareto-dominated, and discovery routes via SIN, KUL and other hubs. Fares vary deterministically by date.

## Assumptions

* Access costs (`accessMonetaryCost`, train, fuel, toll) are **per direction** for the travelling party; parking is
  per trip; hotel cost is per night; ground transfer cost is per direction. All editable in Settings.
* The mock provider prices per passenger × passengers; the seeded profile uses 2 passengers.
* `ALWAYS` hotel rule applies to the outbound; return hotels only follow the latest-arrival rule.
* FX rates are static and configurable (Settings → Home); a live FX service can replace them behind `convertToEur`.
* Overnight layover = a connection of ≥ 5 h that spans 03:00 local time at the connecting airport.
* The spec's illustrative breakdown (91 × 30% … = "91.1") actually sums to 89.95; the engine reports the true weighted
  sum (90.0).

## Completion checklist (spec §61)

All headings of the specification are **implemented**; the items below note where the implementation deviates in
form (not in function) or depends on external services:

| Spec | Status | Notes |
| --- | --- | --- |
| 1–5 Core principle, destination model, route families | implemented | KBV and HKT compete as gateways; hubs are not hard-coded (mock synthesises other hubs, live providers return whatever exists) |
| 6–8 Departure airports, origin access profile, hotel logic | implemented | data driven; add airports in Settings |
| 9–11 True journey cost, door-to-Krabi time, elapsed vs active burden | implemented | |
| 12–14 Transfer model, hard constraints, hard vs soft | implemented | outbound/return independent |
| 15–16 Time preferences, sleep value | implemented | 4 editable band curves + deterministic sleep bonus |
| 17–19 Trip profile, cabin model, product data | implemented | aircraft, seat product, fare class stored when providers expose them |
| 20–22 Provider abstraction, normalized model, segments | implemented | mock + Duffel + Amadeus adapters; docs read via official SDK typings |
| 23–25 Two-stage search, price history, deal intelligence | implemented | |
| 26–31 Scoring engine, weights, timing, transfers, saving/hour, Pareto | implemented | |
| 32–42 UI | implemented | Radar, Search (+ save as profile), Compare (2–5), History, Profiles, Settings, score explanation, origin matrix |
| 43–45 Storage, stack, API | implemented | constraint/time/weight profiles are JSONB inside `trip_profiles` (self-contained profiles); the search request is stored on the run |
| 46–47 Scheduler, alerts | implemented | notification delivery = log provider; Telegram/e-mail/push not implemented (interface ready) |
| 48–53 Security, provider failure, dedupe, currency, time zones, performance | implemented | |
| 54–55 Mock data, tests | implemented | 73 core, 22 server, 7 Playwright flows |
| 56–60 UX rules, acceptance criteria | implemented | default sort = overall score; labels; similar dates collapsed with explanation |
| Live provider validation | requires credentials | adapters implemented and unit-tested; not exercised against live APIs |
