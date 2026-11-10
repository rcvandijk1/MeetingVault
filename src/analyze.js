import { TECHNIQUES, CAPS_ALLOW } from './techniques.js';
import { splitSentences, quoteSpans, inSpans, countWords } from './text.js';

const MIN_WORDS = 120;
const QUOTE_FACTOR = 0.4; // een geladen woord in een citaat is van de spreker, niet van de redactie
const TITLE_FACTOR = 2; // de kop bepaalt de eerste indruk en wordt het meest gedeeld
const MAX_EXAMPLES = 4;

// Drempels voor de band, in gewogen signalen per 1000 woorden. Een inschatting, niet gekalibreerd.
export const BANDS = { middel: { density: 5, techniques: 2 }, hoog: { density: 12, techniques: 3 } };

const compiled = TECHNIQUES.map((t) => ({
  ...t,
  re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${t.patterns.join('|')})(?![\\p{L}\\p{N}])`, 'giu'),
}));

function findMatches(re, text) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push({ start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  return out;
}

function typographyMatches(text) {
  const out = [];
  const caps = /(?<![\p{L}\p{N}])[\p{Lu}]{5,}(?![\p{L}\p{N}])/gu;
  let m;
  while ((m = caps.exec(text)) !== null) {
    if (CAPS_ALLOW.has(m[0])) continue;
    out.push({ start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  const punct = /[!?]*![!?]+|\?{2,}/g;
  while ((m = punct.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  return out.sort((a, b) => a.start - b.start);
}

function sentenceAt(sentences, pos) {
  for (const s of sentences) if (pos >= s.start && pos < s.end) return s;
  return null;
}

function collect(def, matches, source, text, sentences, quotes) {
  return matches.map((hit) => {
    const inTitle = source === 'title';
    const inQuote = !inTitle && inSpans(quotes, hit.start);
    const s = inTitle ? { text, start: 0 } : sentenceAt(sentences, hit.start) || { text: text.slice(Math.max(0, hit.start - 80), hit.end + 80), start: Math.max(0, hit.start - 80) };
    return {
      technique: def.id,
      match: hit.match,
      sentence: s.text,
      matchStart: hit.start - s.start,
      matchEnd: hit.end - s.start,
      inTitle,
      inQuote,
      score: def.weight * (inTitle ? TITLE_FACTOR : 1) * (inQuote ? QUOTE_FACTOR : 1),
    };
  });
}

/**
 * Analyseert een artikel op taalsignalen van beïnvloeding.
 * @param {{title?: string, text: string, isOpinion?: boolean}} article
 */
export function analyze(article) {
  const title = (article.title || '').trim();
  const text = (article.text || '').trim();
  const words = countWords(text);
  const sentences = splitSentences(text);
  const quotes = quoteSpans(text);

  const defs = [
    ...compiled.map((t) => ({ def: t, find: (s) => findMatches(t.re, s) })),
    {
      def: {
        id: 'typografie',
        name: 'Nadruk met hoofdletters en leestekens',
        why: 'Hoofdletters en opeengestapelde uitroeptekens schreeuwen om aandacht en vervangen argumenten door volume.',
        weight: 1,
      },
      find: typographyMatches,
    },
  ];

  const findings = [];
  let total = 0;
  for (const { def, find } of defs) {
    const hits = [
      ...collect(def, find(title), 'title', title, sentences, quotes),
      ...collect(def, find(text), 'text', text, sentences, quotes),
    ];
    if (hits.length === 0) continue;
    const score = hits.reduce((a, h) => a + h.score, 0);
    total += score;
    // Toon eerst de zwaarst wegende voorbeelden, en nooit twee keer dezelfde zin.
    const seen = new Set();
    const examples = [];
    for (const h of [...hits].sort((a, b) => b.score - a.score)) {
      if (seen.has(h.sentence)) continue;
      seen.add(h.sentence);
      examples.push(h);
      if (examples.length >= MAX_EXAMPLES) break;
    }
    findings.push({
      id: def.id,
      name: def.name,
      why: def.why,
      count: hits.length,
      inQuoteCount: hits.filter((h) => h.inQuote).length,
      inTitleCount: hits.filter((h) => h.inTitle).length,
      score,
      examples,
    });
  }
  findings.sort((a, b) => b.score - a.score);

  const tooShort = words < MIN_WORDS;
  const density = words > 0 ? (total / Math.max(words, MIN_WORDS)) * 1000 : 0;
  // Een techniek telt pas mee voor de band als hij buiten citaten of in de kop voorkomt.
  const ownVoice = findings.filter((f) => f.count > f.inQuoteCount).length;

  let band = 'laag';
  if (density >= BANDS.hoog.density && ownVoice >= BANDS.hoog.techniques) band = 'hoog';
  else if (density >= BANDS.middel.density && ownVoice >= BANDS.middel.techniques) band = 'middel';
  if (tooShort) band = 'onbepaald';

  const notes = [];
  if (tooShort) notes.push(`De tekst is te kort (${words} woorden) voor een betrouwbaar beeld. Staat het artikel achter een betaalmuur?`);
  if (article.isOpinion) notes.push('Dit lijkt een opiniestuk of column. Daar is stellige en geladen taal gebruikelijk en geen teken van misleiding.');
  const quoted = findings.reduce((a, f) => a + f.inQuoteCount, 0);
  if (quoted > 0) notes.push(`${quoted} ${quoted === 1 ? 'signaal staat' : 'signalen staan'} in een citaat en ${quoted === 1 ? 'telt' : 'tellen'} minder zwaar: dat zijn de woorden van de geciteerde.`);

  return {
    band,
    density: Math.round(density * 10) / 10,
    words,
    signalCount: findings.reduce((a, f) => a + f.count, 0),
    techniqueCount: findings.length,
    findings,
    notes,
    tooShort,
  };
}

export function bandSummary(result) {
  if (result.band === 'onbepaald') return 'Te weinig tekst om iets over te zeggen.';
  const base = `${result.signalCount} ${result.signalCount === 1 ? 'signaal' : 'signalen'} in ${result.techniqueCount} ${result.techniqueCount === 1 ? 'techniek' : 'technieken'}, op ${result.words} woorden.`;
  if (result.band === 'laag') return result.signalCount === 0 ? 'Geen taalsignalen van beïnvloeding gevonden.' : `Weinig taalsignalen: ${base}`;
  if (result.band === 'middel') return `Meerdere taalsignalen: ${base}`;
  return `Veel taalsignalen: ${base}`;
}
