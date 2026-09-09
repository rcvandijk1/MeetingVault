import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

/**
 * Finds the `drizzle/` migrations folder by walking up from this file. Works
 * both from the TypeScript sources (src/db) and from the bundled dist/main.js.
 */
export function findMigrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate the drizzle migrations folder');
}

export async function runMigrations(url: string, migrationsFolder?: string): Promise<void> {
  const folder = migrationsFolder ?? findMigrationsFolder();
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await close();
  }
}
