CREATE TABLE "price_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"itinerary_id" text NOT NULL,
	"search_run_id" text,
	"status" varchar(16) NOT NULL,
	"driver" varchar(48),
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"quoted_fare" real NOT NULL,
	"quoted_currency" varchar(3) NOT NULL,
	"final_price" real,
	"final_currency" varchar(3),
	"final_price_eur" real,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "trip_profiles" ADD COLUMN "cabins" jsonb;--> statement-breakpoint
ALTER TABLE "trip_profiles" ADD COLUMN "feeder_min_cabin" varchar(16);--> statement-breakpoint
UPDATE "trip_profiles" SET "cabins" = jsonb_build_array("long_haul_cabin"), "feeder_min_cabin" = CASE WHEN "feeder_economy_allowed" THEN 'ECONOMY' ELSE "long_haul_cabin" END;--> statement-breakpoint
ALTER TABLE "trip_profiles" ALTER COLUMN "cabins" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_profiles" ALTER COLUMN "feeder_min_cabin" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "price_verifications" ADD CONSTRAINT "price_verifications_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_verifications" ADD CONSTRAINT "price_verifications_search_run_id_search_runs_id_fk" FOREIGN KEY ("search_run_id") REFERENCES "public"."search_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_verifications_run_idx" ON "price_verifications" USING btree ("search_run_id");--> statement-breakpoint
CREATE INDEX "price_verifications_itinerary_idx" ON "price_verifications" USING btree ("itinerary_id");--> statement-breakpoint
CREATE INDEX "price_verifications_status_idx" ON "price_verifications" USING btree ("status","priority");