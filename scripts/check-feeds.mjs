// Controleert vanaf je eigen machine of de feeds in data/outlets.json nog werken.
// Gebruik: npm run feeds
import { readFileSync } from 'node:fs';
import { loadOutletFeed } from '../src/feeds.js';

const outlets = JSON.parse(readFileSync(new URL('../data/outlets.json', import.meta.url), 'utf8')).outlets;
let broken = 0;
for (const outlet of outlets) {
  const r = await loadOutletFeed(outlet, { timeoutMs: 10000 });
  if (!r.ok) broken++;
  const status = r.ok ? `ok   ${String(r.items.length).padStart(3)} berichten${r.discovered ? `  (gevonden via homepage: ${r.source})` : ''}` : `FOUT ${r.error}`;
  console.log(`${outlet.name.padEnd(28)} ${status}`);
}
console.log(`\n${outlets.length - broken} van ${outlets.length} feeds werken.`);
process.exit(broken ? 1 : 0);
