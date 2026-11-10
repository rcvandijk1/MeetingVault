// Werkt de sitelijst in manifest.json bij vanuit data/outlets.json.
// Gebruik: node scripts/sync-manifest.mjs          (schrijft)
//          node scripts/sync-manifest.mjs --check  (faalt als het manifest achterloopt)
import { readFileSync, writeFileSync } from 'node:fs';
import { matchPatterns } from '../src/outlets.js';
import { CONFIG } from '../config.js';

const root = new URL('..', import.meta.url);
const outlets = JSON.parse(readFileSync(new URL('data/outlets.json', root), 'utf8')).outlets;
const manifestUrl = new URL('manifest.json', root);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

const patterns = matchPatterns(outlets);
// De AI-analyse praat rechtstreeks met de API van Anthropic.
const hosts = [...patterns, 'https://api.anthropic.com/*'];
// De eigen server voor leden, als die is ingesteld in config.js.
if (CONFIG.serverUrl) hosts.push(`${new URL(CONFIG.serverUrl).origin}/*`);
const before = JSON.stringify([manifest.host_permissions, manifest.content_scripts[0].matches]);
manifest.host_permissions = hosts;
manifest.content_scripts[0].matches = patterns;
const changed = before !== JSON.stringify([hosts, patterns]);

if (process.argv.includes('--check')) {
  if (changed) { console.error('manifest.json loopt achter op data/outlets.json. Draai: npm run sync'); process.exit(1); }
  console.log(`manifest.json is actueel (${patterns.length} domeinen).`);
} else {
  writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${changed ? 'Bijgewerkt' : 'Ongewijzigd'}: ${patterns.length} domeinen.`);
}
