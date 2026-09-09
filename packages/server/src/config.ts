import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from the repository root (and the package directory) without overriding real env vars.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });
dotenv.config({ path: path.resolve(here, '../.env') });

const bool = z
  .string()
  .optional()
  .transform((v) => v === undefined || v === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

const configSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_TEST: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  AUTO_SEED: bool.default('true'),
  FLIGHT_PROVIDERS: z.string().default('mock'),
  DUFFEL_ACCESS_TOKEN: z.string().optional(),
  DUFFEL_API_VERSION: z.string().default('v2'),
  DUFFEL_BASE_URL: z.string().default('https://api.duffel.com'),
  AMADEUS_CLIENT_ID: z.string().optional(),
  AMADEUS_CLIENT_SECRET: z.string().optional(),
  AMADEUS_BASE_URL: z.string().default('https://test.api.amadeus.com'),
  PROVIDER_MAX_CONCURRENCY: z.coerce.number().int().positive().default(3),
  PROVIDER_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(250),
  PROVIDER_CACHE_TTL_MINUTES: z.coerce.number().nonnegative().default(30),
  SEARCH_MAX_VALIDATION_CANDIDATES: z.coerce.number().int().positive().default(48),
  SEARCH_REPRICE_TOP_N: z.coerce.number().int().nonnegative().default(3),
  SCHEDULER_ENABLED: bool.default('false'),
  SCHEDULER_INTERVAL_HOURS: z.coerce.number().positive().default(6),
  NOTIFICATION_PROVIDER: z.enum(['log', 'none']).default('log'),
  STATIC_DIR: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema> & { providers: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(env);
  return {
    ...parsed,
    providers: parsed.FLIGHT_PROVIDERS.split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  };
}
