import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { ConsoleNotificationProvider, NoopNotificationProvider, SearchOrchestrator, type FlightSearchProvider, type NotificationProvider } from '@kfr/core';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { Repositories } from './repositories/index.js';
import { SearchService } from './services/searchService.js';
import { Scheduler } from './services/scheduler.js';
import { buildProviders } from './services/providers.js';
import { registerRoutes } from './routes.js';

export interface AppDeps {
  config: AppConfig;
  repos: Repositories;
  orchestrator: SearchOrchestrator;
  searchService: SearchService;
  scheduler: Scheduler;
  notifier: NotificationProvider;
}

export interface BuildAppOptions {
  config: AppConfig;
  db: Database;
  providers?: FlightSearchProvider[];
  notifier?: NotificationProvider;
  now?: () => Date;
  logger?: boolean | object;
}

export async function buildApp(opts: BuildAppOptions): Promise<{ app: FastifyInstance; deps: AppDeps }> {
  const { config, db } = opts;
  const app = Fastify({ logger: opts.logger ?? { level: config.LOG_LEVEL } });
  await app.register(cors, { origin: true });

  const repos = new Repositories(db);
  const airports = await repos.listAirports();
  const providers = opts.providers ?? buildProviders(config, airports);
  const orchestrator = new SearchOrchestrator(providers, {
    maxConcurrency: config.PROVIDER_MAX_CONCURRENCY,
    minIntervalMs: config.PROVIDER_MIN_INTERVAL_MS,
    cacheTtlMs: config.PROVIDER_CACHE_TTL_MINUTES * 60000,
    now: opts.now,
  });
  const searchService = new SearchService({ repos, orchestrator, now: opts.now, log: app.log });
  const notifier = opts.notifier ?? (config.NOTIFICATION_PROVIDER === 'log' ? new ConsoleNotificationProvider((m) => app.log.info(m)) : new NoopNotificationProvider());
  const scheduler = new Scheduler({ repos, searchService, notifier, intervalHours: config.SCHEDULER_INTERVAL_HOURS, enabled: config.SCHEDULER_ENABLED, now: opts.now, log: app.log });
  const deps: AppDeps = { config, repos, orchestrator, searchService, scheduler, notifier };

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: err.message });
  });

  registerRoutes(app, deps);

  // Serve the built web app in production when a static directory is available
  // (packages/web/dist, resolved relative to this file so it works from dist/ and src/).
  const staticDir = config.STATIC_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: staticDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => scheduler.stop());
  return { app, deps };
}
