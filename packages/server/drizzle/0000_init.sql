CREATE TABLE "airports" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" varchar(2) NOT NULL,
	"timezone" text NOT NULL,
	"region" varchar(16) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"home_name" text NOT NULL,
	"home_country_code" varchar(2) NOT NULL,
	"home_timezone" text NOT NULL,
	"hotel_evening_departure_time" varchar(5) NOT NULL,
	"min_hotel_rest_minutes" integer NOT NULL,
	"airport_exit_minutes" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fx_rates_to_eur" jsonb NOT NULL,
	"deal_thresholds" jsonb NOT NULL,
	"alert_thresholds" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination_gateways" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"exit_buffer_minutes" integer NOT NULL,
	"check_in_buffer_minutes" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fare_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"origin_airport" varchar(3) NOT NULL,
	"arrival_gateway" varchar(3) NOT NULL,
	"outbound_date" varchar(10) NOT NULL,
	"inbound_date" varchar(10) NOT NULL,
	"airline" varchar(3) NOT NULL,
	"cabin" varchar(16) NOT NULL,
	"fare" real NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fare_eur" real NOT NULL,
	"provider" varchar(32) NOT NULL,
	"itinerary_fingerprint" varchar(32) NOT NULL,
	"search_run_id" text
);
--> statement-breakpoint
CREATE TABLE "flight_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"itinerary_id" text NOT NULL,
	"direction" varchar(8) NOT NULL,
	"seq" integer NOT NULL,
	"origin" varchar(3) NOT NULL,
	"destination" varchar(3) NOT NULL,
	"departure_utc" timestamp with time zone NOT NULL,
	"departure_local" varchar(16) NOT NULL,
	"arrival_utc" timestamp with time zone NOT NULL,
	"arrival_local" varchar(16) NOT NULL,
	"marketing_carrier" varchar(3) NOT NULL,
	"operating_carrier" varchar(3) NOT NULL,
	"flight_number" varchar(10) NOT NULL,
	"aircraft" text,
	"cabin" varchar(16) NOT NULL,
	"fare_class" varchar(16),
	"seat_product" varchar(32),
	"duration_minutes" integer NOT NULL,
	"ticket_group" varchar(16) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ground_transfer_profiles" (
	"id" varchar(60) PRIMARY KEY NOT NULL,
	"from_code" varchar(3) NOT NULL,
	"to_place" text NOT NULL,
	"mode" varchar(24) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"minutes" integer NOT NULL,
	"monetary_cost" real NOT NULL,
	"inconvenience_penalty" real DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itineraries" (
	"id" text PRIMARY KEY NOT NULL,
	"search_run_id" text NOT NULL,
	"fingerprint" varchar(32) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_offer_id" text NOT NULL,
	"fare" real NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fare_eur" real NOT NULL,
	"origin_airport" varchar(3) NOT NULL,
	"arrival_gateway" varchar(3) NOT NULL,
	"outbound_date" varchar(10) NOT NULL,
	"inbound_date" varchar(10) NOT NULL,
	"airline" varchar(3) NOT NULL,
	"cabin" varchar(16) NOT NULL,
	"normalized" jsonb NOT NULL,
	"enriched" jsonb NOT NULL,
	"provider_expires_at" timestamp with time zone,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"last_validated" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "known_itineraries" (
	"fingerprint" varchar(32) PRIMARY KEY NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"last_validated" timestamp with time zone NOT NULL,
	"lowest_fare_eur" real NOT NULL,
	"latest_fare_eur" real NOT NULL,
	"times_seen" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "origin_access_profiles" (
	"airport_code" varchar(3) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"preferred_access_mode" varchar(24) NOT NULL,
	"access_travel_minutes" integer NOT NULL,
	"access_monetary_cost" real DEFAULT 0 NOT NULL,
	"airport_buffer_minutes" integer NOT NULL,
	"same_day_earliest_departure_time" varchar(5) NOT NULL,
	"hotel_cost" real DEFAULT 0 NOT NULL,
	"hotel_required_rule" varchar(8) DEFAULT 'AUTO' NOT NULL,
	"return_hotel_latest_arrival_time" varchar(5),
	"parking_cost" real DEFAULT 0 NOT NULL,
	"train_cost" real DEFAULT 0 NOT NULL,
	"fuel_cost" real DEFAULT 0 NOT NULL,
	"toll_cost" real DEFAULT 0 NOT NULL,
	"inconvenience_penalty" real DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"search_run_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"request" jsonb
);
--> statement-breakpoint
CREATE TABLE "provider_offer_references" (
	"id" text PRIMARY KEY NOT NULL,
	"itinerary_id" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_offer_id" text NOT NULL,
	"fare" real NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fare_eur" real NOT NULL,
	"expires_at" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "score_results" (
	"id" text PRIMARY KEY NOT NULL,
	"itinerary_id" text NOT NULL,
	"search_run_id" text NOT NULL,
	"overall_score" real NOT NULL,
	"rank" integer NOT NULL,
	"category_scores" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"labels" jsonb NOT NULL,
	"deal_level" varchar(12) NOT NULL,
	"deal" jsonb NOT NULL,
	"pareto_dominated" boolean NOT NULL,
	"dominated_by" text,
	"convenience_score" real NOT NULL,
	"sleep_opportunity_score" real NOT NULL,
	"baseline" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text,
	"trigger" varchar(16) DEFAULT 'MANUAL' NOT NULL,
	"status" varchar(16) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"request" jsonb NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"stats" jsonb,
	"provider_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "trip_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"passengers" integer NOT NULL,
	"outbound_earliest_date" varchar(10) NOT NULL,
	"outbound_latest_date" varchar(10) NOT NULL,
	"return_earliest_date" varchar(10) NOT NULL,
	"return_latest_date" varchar(10) NOT NULL,
	"min_trip_days" integer NOT NULL,
	"preferred_trip_days_min" integer NOT NULL,
	"preferred_trip_days_max" integer NOT NULL,
	"max_trip_days" integer NOT NULL,
	"long_haul_cabin" varchar(16) NOT NULL,
	"feeder_economy_allowed" boolean NOT NULL,
	"mixed_cabin_allowed" boolean NOT NULL,
	"outbound_constraints" jsonb NOT NULL,
	"return_constraints" jsonb NOT NULL,
	"time_preferences" jsonb NOT NULL,
	"scoring_weights" jsonb NOT NULL,
	"scoring_params" jsonb NOT NULL,
	"self_transfer_policy" jsonb NOT NULL,
	"enabled_origins" jsonb NOT NULL,
	"enabled_arrival_gateways" jsonb NOT NULL,
	"baseline_origin" varchar(3) NOT NULL,
	"max_validation_candidates" integer DEFAULT 48 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "destination_gateways" ADD CONSTRAINT "destination_gateways_code_airports_code_fk" FOREIGN KEY ("code") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_observations" ADD CONSTRAINT "fare_observations_search_run_id_search_runs_id_fk" FOREIGN KEY ("search_run_id") REFERENCES "public"."search_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_segments" ADD CONSTRAINT "flight_segments_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ground_transfer_profiles" ADD CONSTRAINT "ground_transfer_profiles_from_code_airports_code_fk" FOREIGN KEY ("from_code") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itineraries" ADD CONSTRAINT "itineraries_search_run_id_search_runs_id_fk" FOREIGN KEY ("search_run_id") REFERENCES "public"."search_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "origin_access_profiles" ADD CONSTRAINT "origin_access_profiles_airport_code_airports_code_fk" FOREIGN KEY ("airport_code") REFERENCES "public"."airports"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_search_run_id_search_runs_id_fk" FOREIGN KEY ("search_run_id") REFERENCES "public"."search_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_offer_references" ADD CONSTRAINT "provider_offer_references_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_results" ADD CONSTRAINT "score_results_search_run_id_search_runs_id_fk" FOREIGN KEY ("search_run_id") REFERENCES "public"."search_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_profile_id_trip_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."trip_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fare_observations_route_idx" ON "fare_observations" USING btree ("origin_airport","arrival_gateway","cabin","observed_at");--> statement-breakpoint
CREATE INDEX "fare_observations_fp_idx" ON "fare_observations" USING btree ("itinerary_fingerprint","observed_at");--> statement-breakpoint
CREATE INDEX "flight_segments_itinerary_idx" ON "flight_segments" USING btree ("itinerary_id");--> statement-breakpoint
CREATE INDEX "itineraries_run_idx" ON "itineraries" USING btree ("search_run_id");--> statement-breakpoint
CREATE INDEX "itineraries_fingerprint_idx" ON "itineraries" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "provider_events_provider_idx" ON "provider_events" USING btree ("provider","started_at");--> statement-breakpoint
CREATE INDEX "provider_offer_refs_itinerary_idx" ON "provider_offer_references" USING btree ("itinerary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_results_itinerary_idx" ON "score_results" USING btree ("itinerary_id");--> statement-breakpoint
CREATE INDEX "score_results_run_idx" ON "score_results" USING btree ("search_run_id","overall_score");--> statement-breakpoint
CREATE INDEX "search_runs_profile_idx" ON "search_runs" USING btree ("profile_id","started_at");