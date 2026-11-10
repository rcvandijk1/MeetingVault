// Bouwt docs/SPEC.md uit docs/SPEC.template.md en de broncode, zodat de bijlagen nooit afwijken van wat er gebouwd is.
// Gebruik: npm run spec
import { readFileSync, writeFileSync } from 'node:fs';
import { TECHNIQUES, CAPS_ALLOW } from '../src/techniques.js';
import { BANDS } from '../src/analyze.js';
import { MATCH } from '../src/match.js';
import { SYSTEM, SCHEMA, MODELS } from '../src/ai.js';
import { STOPWORDS } from '../src/text.js';
import { LIMITS } from '../server/handler.js';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const data = JSON.parse(read('data/outlets.json'));
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');

// Kleurtokens uit de stylesheet: eerste :root is licht, het blok binnen de media query is donker.
const css = read('panel/panel.css');
const tokens = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = tokens(css.match(/:root\s*\{([\s\S]*?)\}/)[1]);
const dark = tokens(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/)[1]);

const values = {
  MODELS: MODELS.map((m) => `| \`${m.id}\` | ${cell(m.label)} | ${m.fallbacks ? 'ja' : 'nee'} |`).join('\n'),
  HOOG_D: BANDS.hoog.density, HOOG_T: BANDS.hoog.techniques,
  MIDDEL_D: BANDS.middel.density, MIDDEL_T: BANDS.middel.techniques,
  LEANS: data.leans.map((l) => `\`${l}\``).join(', '),
  MAXDAYS: MATCH.maxDays, MINSHARED: MATCH.minShared, STRONG: MATCH.strongShared,
  MINSCORE: MATCH.minScore, MINSCORE15: Math.round(MATCH.minScore * 1.5 * 100) / 100, DUP: MATCH.duplicateTitle,
  MAXCHARS: LIMITS.maxChars, PERDAY: LIMITS.perDay,
  COLORS: Object.keys(light).map((k) => `| \`${k}\` | \`${light[k]}\` | \`${dark[k] ?? light[k]}\` |`).join('\n'),
  DISCLAIMER: data.disclaimer,
  OUTLETS: data.outlets.map((o) => `| ${o.id} | ${cell(o.name)} | ${o.country} | ${o.domains.join(', ')} | ${o.lean} | ${cell(o.owner)} | ${o.feeds[0] || ''} | ${cell(o.basis)} |`).join('\n'),
  TECHNIQUES: TECHNIQUES.map((t) => `### \`${t.id}\`: ${t.name}\n\nGewicht ${t.weight}. ${t.why}\n\n\`\`\`\n${t.patterns.join('\n')}\n\`\`\``).join('\n\n')
    + '\n\n### `typografie`: Nadruk met hoofdletters en leestekens\n\nGewicht 1. Hoofdletters en opeengestapelde uitroeptekens schreeuwen om aandacht en vervangen argumenten door volume.\n\nGeen woordenlijst; zie 9.2, stap 2.',
  SYSTEM,
  SCHEMA: JSON.stringify(SCHEMA, null, 2),
  CAPS: [...CAPS_ALLOW].join(' '),
  STOPWORDS: [...STOPWORDS].join(' '),
};

let out = read('docs/SPEC.template.md').replace(/\{\{(\w+)\}\}/g, (all, key) => {
  if (!(key in values)) throw new Error(`Onbekende plek in sjabloon: ${all}`);
  return String(values[key]);
});
writeFileSync(new URL('docs/SPEC.md', root), out);
console.log(`docs/SPEC.md geschreven (${out.length} tekens).`);
