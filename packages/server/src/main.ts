import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { buildApp } from './app.js';

const config = loadConfig();
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
app.log.info({ providers: config.providers, scheduler: config.SCHEDULER_ENABLED }, 'Krabi Flight Radar API ready');
