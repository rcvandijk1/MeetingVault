import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

export async function runMigrations(url: string, migrationsFolder?: string): Promise<void> {
  const folder = migrationsFolder ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await close();
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const { loadConfig } = await import('../config.js');
  const cfg = loadConfig();
  await runMigrations(cfg.DATABASE_URL);
  console.log('Migrations applied to', cfg.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
}
