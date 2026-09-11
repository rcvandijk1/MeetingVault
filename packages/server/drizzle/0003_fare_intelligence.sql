CREATE TABLE "fare_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"search_run_id" text NOT NULL,
	"itinerary_id" text NOT NULL,
	"fingerprint" varchar(32) NOT NULL,
	"type" varchar(40) NOT NULL,
	"severity" varchar(12) NOT NULL,
	"confidence" varchar(8) NOT NULL,
	"reason" text NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"origin_airport" varchar(3) NOT NULL,
	"arrival_gateway" varchar(3) NOT NULL,
	"cabin" varchar(16) NOT NULL,
	"fare_eur" real NOT NULL,
	"deal_score" real,
	"classification" varchar(16) NOT NULL,
	"detected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "score_results" ALTER COLUMN "deal_level" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "fare_intelligence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "trip_days" integer;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "days_to_departure" integer;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "stops_outbound" integer;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "stops_inbound" integer;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "connection_airports" jsonb;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "outbound_departure_local" varchar(16);--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "outbound_arrival_local" varchar(16);--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "inbound_departure_local" varchar(16);--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "inbound_arrival_local" varchar(16);--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "total_duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "taxes_eur" real;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "provider_offer_id" text;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "premium_cabin_percent" real;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "long_haul_premium_percent" real;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "cabin_quality" varchar(8);--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "route_family" varchar(32);--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD COLUMN "fare_verified_eur" real;--> statement-breakpoint
ALTER TABLE "fare_opportunities" ADD CONSTRAINT "fare_opportunities_search_run_id_search_runs_id_fk" FOREIGN KEY ("search_run_id") REFERENCES "public"."search_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_opportunities" ADD CONSTRAINT "fare_opportunities_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fare_opportunities_run_idx" ON "fare_opportunities" USING btree ("search_run_id");--> statement-breakpoint
CREATE INDEX "fare_opportunities_time_idx" ON "fare_opportunities" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "fare_opportunities_fp_idx" ON "fare_opportunities" USING btree ("fingerprint","type");--> statement-breakpoint
CREATE UNIQUE INDEX "fare_observations_offer_run_idx" ON "fare_observations" USING btree ("search_run_id","provider","provider_offer_id","observed_at") WHERE provider_offer_id is not null;--> statement-breakpoint
UPDATE "fare_observations" o SET
	"trip_days" = (o."inbound_date"::date - o."outbound_date"::date),
	"days_to_departure" = (o."outbound_date"::date - (o."observed_at" at time zone 'UTC')::date),
	"route_family" = CASE WHEN o."arrival_gateway" IN ('KBV', 'HKT', 'BKK') THEN 'KRABI_REGION' ELSE NULL END
WHERE o."trip_days" IS NULL;--> statement-breakpoint
UPDATE "fare_observations" o SET
	"stops_outbound" = (i."normalized"->'outbound'->>'transfers')::int,
	"stops_inbound" = (i."normalized"->'inbound'->>'transfers')::int,
	"outbound_departure_local" = i."normalized"->'outbound'->>'departureLocal',
	"outbound_arrival_local" = i."normalized"->'outbound'->>'arrivalLocal',
	"inbound_departure_local" = i."normalized"->'inbound'->>'departureLocal',
	"inbound_arrival_local" = i."normalized"->'inbound'->>'arrivalLocal',
	"total_duration_minutes" = (i."normalized"->'outbound'->>'totalMinutes')::int + (i."normalized"->'inbound'->>'totalMinutes')::int,
	"premium_cabin_percent" = (i."normalized"->'cabinSummary'->>'premiumCabinPercent')::real,
	"long_haul_premium_percent" = (i."normalized"->'cabinSummary'->>'longHaulPremiumPercent')::real,
	"cabin_quality" = CASE
		WHEN (i."normalized"->'cabinSummary'->>'premiumCabinPercent')::real >= 99.5 THEN 'FULL'
		WHEN (i."normalized"->'cabinSummary'->>'longHaulPremiumPercent')::real >= 99.5 AND (i."normalized"->'cabinSummary'->>'premiumCabinPercent')::real >= 60 THEN 'MOSTLY'
		ELSE 'MIXED' END,
	"connection_airports" = (SELECT coalesce(jsonb_agg(c->>'airport'), '[]'::jsonb) FROM jsonb_array_elements((i."normalized"->'outbound'->'connections') || (i."normalized"->'inbound'->'connections')) c)
FROM (SELECT DISTINCT ON ("fingerprint") "fingerprint", "normalized" FROM "itineraries" ORDER BY "fingerprint", "last_seen" DESC) i
WHERE i."fingerprint" = o."itinerary_fingerprint" AND o."cabin_quality" IS NULL;
