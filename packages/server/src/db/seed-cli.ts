import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';
import { runMigrations } from './migrate.js';
import { seedDatabase } from './seed.js';

const cfg = loadConfig();
await runMigrations(cfg.DATABASE_URL);
const { db, close } = createDatabase(cfg.DATABASE_URL);
try {
  const result = await seedDatabase(db);
  console.log('Seed complete:', result.inserted);
} finally {
  await close();
}
