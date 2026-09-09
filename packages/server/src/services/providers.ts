import { AmadeusFlightSearchProvider, DuffelFlightSearchProvider, MockFlightSearchProvider, type Airport, type FlightSearchProvider } from '@kfr/core';
import type { AppConfig } from '../config.js';

/** Builds the configured providers. Credentials stay server side. */
export function buildProviders(config: AppConfig, airports: Airport[]): FlightSearchProvider[] {
  const tz = Object.fromEntries(airports.map((a) => [a.code, a.timezone]));
  const providers: FlightSearchProvider[] = [];
  for (const name of config.providers) {
    switch (name) {
      case 'mock':
        providers.push(new MockFlightSearchProvider());
        break;
      case 'duffel':
        providers.push(new DuffelFlightSearchProvider({ accessToken: config.DUFFEL_ACCESS_TOKEN, baseUrl: config.DUFFEL_BASE_URL, apiVersion: config.DUFFEL_API_VERSION, airportTimezones: tz }));
        break;
      case 'amadeus':
        providers.push(new AmadeusFlightSearchProvider({ clientId: config.AMADEUS_CLIENT_ID, clientSecret: config.AMADEUS_CLIENT_SECRET, baseUrl: config.AMADEUS_BASE_URL, airportTimezones: tz }));
        break;
      default:
        throw new Error(`Unknown flight provider "${name}" in FLIGHT_PROVIDERS`);
    }
  }
  if (providers.length === 0) throw new Error('No flight providers configured');
  return providers;
}
