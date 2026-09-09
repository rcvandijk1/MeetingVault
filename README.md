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
| `packages/server` | Node 20+, Fastify 5, Drizzle ORM, PostgreSQL 14+, Zod, Playwright (headless Chromium for booking-flow price checks) |
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
| `npm run test:unit` | core unit + pipeline integration tests (79) |
| `npm run test:server` | server API integration tests against `DATABASE_URL_TEST` (27, includes a real headless-browser booking flow) |
| `npm run test:e2e` | Playwright flows (8); starts its own API (port 4100) and web (5174) against `DATABASE_URL_TEST` |
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

## Flight class for every flight

A profile has **cabins to search** (any combination of Economy, Premium economy, Business, First — each is searched,
scored, Pareto-analysed and baselined separately so an economy fare never "dominates" a business one) and a
**minimum feeder cabin** for short-haul segments. Long-haul segments must always be in the searched cabin; set the
minimum feeder cabin equal to it to require that class on every flight. Both are hard constraints: violations are
rejected with an explicit reason, never silently down-scored.

## Final price verification (booking flow up to payment)

Quoted fares are not what you pay. After every search the top `VERIFY_TOP_N` journeys are queued for an
**asynchronous booking-flow check**: a driver walks the selling channel's booking process — fare selection,
passenger details, extras, payment page — reads the total shown at the payment step and stops there. Nothing is
ever booked or paid.

* `price_verifications` holds the queue (`QUEUED → RUNNING → VERIFIED | FAILED | UNSUPPORTED`), the final price,
  the fee breakdown and every step with a screenshot (`packages/server/data/verifications/<id>/`).
* The verified price becomes `verifiedFare` on the itinerary; `bookingFees = final − quoted` is added to the true
  journey cost and the run is re-scored, so the ranking follows the real price. It is also appended to the price
  history as a `booking-flow:<driver>` observation.
* The UI shows a **Final price** column (queued / checking / verified / failed / no flow), the breakdown and the
  step screenshots in the journey drawer, and a **Check final price** button for any journey.
* Drivers implement `BookingFlowDriver` (`packages/server/src/verification`). Shipped: `mock-airline` (a headless
  Chromium via Playwright walking the self-hosted mock airline site at `/mock-airline/…`, the reference for real
  airline drivers) and `api-pricing` (Duffel / Amadeus pricing endpoint, which *is* the pre-payment total for API
  channels). Real airline websites need a driver each with their own selectors; expect bot detection, captchas and
  DOM changes — treat those drivers as maintained scrapers, not fire-and-forget code.
* Configuration: `VERIFY_ENABLED`, `VERIFY_TOP_N`, `VERIFY_CONCURRENCY`, `VERIFY_DATA_DIR`,
  `PLAYWRIGHT_CHROMIUM_PATH` (empty = the browser installed by `npx playwright install chromium`),
  `PUBLIC_BASE_URL`. Status on **Settings → Providers & scheduler**; API: `GET /api/verifications?runId=`,
  `GET /api/verifications/:id`, `POST /api/itineraries/:id/verify`, `GET /api/verifications/status`.

## Flight class for every flight

A profile has **classes to search** (any of Economy, Premium economy, Business, First; each is searched, scored and
ranked as its own requested class, with its own baseline and Pareto set) and a **minimum class for feeder /
short-haul flights**. Long-haul flights must always be in the searched class; feeder flights may be lower, down to
the minimum, and anything below is rejected as a hard constraint. Set the minimum equal to the searched class to
require it on every flight.

## Booking-flow price verification

Quoted fares are not final prices. After every search the top `VERIFY_TOP_N` journeys are handed to an asynchronous
worker that walks the selling channel's booking process **up to the payment page and stops there** — nothing is
ever booked or paid — and records the total it sees, with a screenshot of every step. The verified price feeds
straight back into the true journey cost (`bookingFees` = final − quoted), the run is re-scored, and because that
can promote an unchecked journey into the top N, verification follows the ranking until the top N are all verified.

| Channel | Driver | Mechanism |
| --- | --- | --- |
| Mock provider | `mock-airline` | Playwright walks the self-hosted mock airline site (`/mock-airline/book/:id` → passengers → extras → payment). This is the reference implementation of a browser driver and is exercised by the tests. |
| Duffel, Amadeus | `api-pricing` | The pricing endpoint *is* the pre-payment step for API channels; its total is the final price. |
| Real airline websites | *per airline* | Implement `BookingFlowDriver` (`packages/server/src/verification/types.ts`) with that site's selectors. Expect bot detection, captchas and frequent DOM changes; keep concurrency at 1 and treat failures as data (they are shown as `FAILED` with the step that broke). |

Results are visible as the **Final price** column, in the journey drawer (breakdown, steps, screenshots, "Check
final price" for any journey) and on Settings → Providers (queue, browser, drivers). A verification of the same
flights within `VERIFY_CACHE_MINUTES` is reused instead of walking the flow again. Screenshots live in
`VERIFY_DATA_DIR` (default `packages/server/data/verifications`). Chromium comes from `PLAYWRIGHT_CHROMIUM_PATH` or
`npx playwright install chromium`.

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
| 17–19 Trip profile, cabin model, product data | implemented | cabins to search + minimum feeder cabin per profile; aircraft, seat product, fare class stored when providers expose them |
| Final price via booking flow (up to payment) | implemented | async Playwright worker, driver per channel; `mock-airline` reference driver + `api-pricing`; real airline drivers to be authored per website |
| 20–22 Provider abstraction, normalized model, segments | implemented | mock + Duffel + Amadeus adapters; docs read via official SDK typings |
| 23–25 Two-stage search, price history, deal intelligence | implemented | |
| 26–31 Scoring engine, weights, timing, transfers, saving/hour, Pareto | implemented | |
| 32–42 UI | implemented | Radar, Search (+ save as profile), Compare (2–5), History, Profiles, Settings, score explanation, origin matrix |
| 43–45 Storage, stack, API | implemented | constraint/time/weight profiles are JSONB inside `trip_profiles` (self-contained profiles); the search request is stored on the run |
| 46–47 Scheduler, alerts | implemented | notification delivery = log provider; Telegram/e-mail/push not implemented (interface ready) |
| 48–53 Security, provider failure, dedupe, currency, time zones, performance | implemented | |
| 54–55 Mock data, tests | implemented | 79 core, 27 server, 8 Playwright flows |
| Class selection for all flights | implemented | classes to search + minimum feeder class per profile |
| Booking-flow final price verification | implemented | async Playwright worker, mock airline reference driver, API pricing driver; real airline drivers are per-site work |
| 56–60 UX rules, acceptance criteria | implemented | default sort = overall score; labels; similar dates collapsed with explanation |
| Live provider validation | requires credentials | adapters implemented and unit-tested; not exercised against live APIs |
