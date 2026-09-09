import { loadConfig } from '../config.js';
import { runMigrations } from './migrate.js';

const cfg = loadConfig();
await runMigrations(cfg.DATABASE_URL);
console.log('Migrations applied to', cfg.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
