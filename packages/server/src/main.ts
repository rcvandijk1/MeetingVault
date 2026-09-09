import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { ensureDatabase } from './db/ensure.js';
import { seedDatabase } from './db/seed.js';
import { buildApp } from './app.js';

const config = loadConfig();
try {
  if ((await ensureDatabase(config.DATABASE_URL)) === 'created') console.log('Created database', config.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
} catch (err) {
  console.error(`Cannot reach PostgreSQL at ${config.DATABASE_URL.replace(/\/\/.*@/, '//***@')}: ${err instanceof Error ? err.message : String(err)}`);
  console.error('Start PostgreSQL (for example `docker compose up -d db`) or fix DATABASE_URL in .env, then try again.');
  process.exit(1);
}
await runMigrations(config.DATABASE_URL);
const { db, close } = createDatabase(config.DATABASE_URL);
if (config.AUTO_SEED) {
  const seeded = await seedDatabase(db);
  const total = Object.values(seeded.inserted).reduce((a, b) => a + b, 0);
  if (total > 0) console.log('Seeded reference data:', seeded.inserted);
}

const { app, deps } = await buildApp({ config, db });
deps.scheduler.start();

const shutdown = async (): Promise<void> => {
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ port: config.PORT, host: config.HOST });
await deps.verifier.recover();
app.log.info({ providers: config.providers, scheduler: config.SCHEDULER_ENABLED, verification: config.VERIFY_ENABLED }, 'Krabi Flight Radar API ready');
