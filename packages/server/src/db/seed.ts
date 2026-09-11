import { sql } from 'drizzle-orm';
import { AIRPORTS, DEFAULT_ALERT_THRESHOLDS, DEFAULT_FARE_INTELLIGENCE, DEFAULT_GATEWAYS, DEFAULT_GROUND_TRANSFERS, DEFAULT_HOME, DEFAULT_ORIGIN_PROFILES, buildDefaultProfile } from '@kfr/core';
import type { Database } from './client.js';
import { airports, appSettings, destinationGateways, groundTransferProfiles, originAccessProfiles, tripProfiles } from './schema.js';

/**
 * Idempotent seed of reference data and the default profile. Existing rows are
 * kept (a user's edits are never overwritten); only missing rows are inserted.
 */
export async function seedDatabase(db: Database): Promise<{ inserted: Record<string, number> }> {
  const inserted: Record<string, number> = {};

  const a = await db.insert(airports).values(AIRPORTS).onConflictDoNothing().returning({ code: airports.code });
  inserted.airports = a.length;

  const s = await db
    .insert(appSettings)
    .values({
      id: 1,
      homeName: DEFAULT_HOME.name,
      homeCountryCode: DEFAULT_HOME.countryCode,
      homeTimezone: DEFAULT_HOME.timezone,
      hotelEveningDepartureTime: DEFAULT_HOME.hotelEveningDepartureTime,
      minHotelRestMinutes: DEFAULT_HOME.minHotelRestMinutes,
      airportExitMinutes: DEFAULT_HOME.airportExitMinutes,
      currency: DEFAULT_HOME.currency,
      fxRatesToEur: DEFAULT_HOME.fxRatesToEur,
      fareIntelligence: DEFAULT_FARE_INTELLIGENCE,
      alertThresholds: DEFAULT_ALERT_THRESHOLDS,
    })
    .onConflictDoNothing()
    .returning({ id: appSettings.id });
  inserted.appSettings = s.length;

  const o = await db
    .insert(originAccessProfiles)
    .values(DEFAULT_ORIGIN_PROFILES.map((p) => ({ ...p })))
    .onConflictDoNothing()
    .returning({ code: originAccessProfiles.airportCode });
  inserted.originAccessProfiles = o.length;

  const g = await db.insert(destinationGateways).values(DEFAULT_GATEWAYS).onConflictDoNothing().returning({ code: destinationGateways.code });
  inserted.destinationGateways = g.length;

  const t = await db.insert(groundTransferProfiles).values(DEFAULT_GROUND_TRANSFERS).onConflictDoNothing().returning({ id: groundTransferProfiles.id });
  inserted.groundTransfers = t.length;

  const existingProfiles = await db.select({ n: sql<number>`count(*)` }).from(tripProfiles);
  if (Number(existingProfiles[0]?.n ?? 0) === 0) {
    const p = buildDefaultProfile();
    await db.insert(tripProfiles).values({ ...p });
    inserted.tripProfiles = 1;
  } else {
    inserted.tripProfiles = 0;
  }
  return { inserted };
}
