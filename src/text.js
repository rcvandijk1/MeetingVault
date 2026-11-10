// Tekstgereedschap zonder browser-afhankelijkheden, zodat het ook in Node getest kan worden.

export const STOPWORDS = new Set(`
aan aangaande aangezien achter af al aldus alhoewel alle allebei alleen als alsnog altijd ander andere anders
ben bent bij bijna binnen boven bovendien buiten daar daarna daarom daarop dan dat de deze den der des deze die
dit doch doen door dus een eens eer eerst elk elke en enige enkele er erg even gaan gaat geen geweest had hadden
heb hebben hebt heeft hem hen het hier hij hoe hun iemand iets ik in is ja je jij jou jouw juist kan kon konden
kunnen laat later maar mag me meer men met mij mijn moet moeten na naar nadat net niet niets nog nu of om omdat
ons onder ook op over pas per reeds sinds sommige staat steeds te tegen ten ter terwijl tijdens toch toen tot
tussen uit uw van vanaf veel via volgens voor vooral vooraf voordat vorig vorige waar waarom wanneer want waren
was wat weer wel welk welke werd werden wie wij wil willen word worden wordt zal ze zei zeggen zegt zelf zich zij
zijn zo zoals zodat zonder zou zouden zullen nieuws live video update vandaag gisteren morgen jaar jaren week
uur dag dagen maand procent euro volgt blijkt nieuwe nieuw gaat komt komen krijgt krijgen maakt maken ziet zien
`.split(/\s+/).filter(Boolean));

export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Grove stemmer: genoeg om "ministers/minister" en "stakingen/staking" samen te laten vallen.
export function stem(token) {
  if (token.length > 6 && token.endsWith('en')) return token.slice(0, -2);
  if (token.length > 5 && (token.endsWith('s') || token.endsWith('e'))) return token.slice(0, -1);
  return token;
}

export function tokenize(s) {
  const out = [];
  for (const raw of normalize(s).split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (/^\d+$/.test(raw)) {
      if (raw.length >= 2) out.push(raw);
      continue;
    }
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export function countWords(s) {
  const m = String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

// Een zin die hierop eindigt is niet af: "o.a.", "dr.", "ca.".
const ABBREVIATION = /(?:^|[\s(])(?:(?:\p{L}\.)+|(?:dr|mr|drs|ir|ing|prof|bv|nv|nr|ca|jl|resp|incl|excl|max|min|vs|blz|st)\.)$/iu;

// Geeft zinnen terug met hun positie in de oorspronkelijke tekst.
export function splitSentences(text) {
  const out = [];
  const re = /[^.!?…\n]+(?:[.!?…]+["”’')\]]*|\n+|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length < 2) continue;
    const prev = out[out.length - 1];
    // Plak korte afkortingsfragmenten ("o.a.", "dr.") aan de vorige zin in plaats van ze los te tonen.
    if (prev && ABBREVIATION.test(prev.text) && prev.end >= m.index - 1) {
      prev.text = text.slice(prev.start, m.index + lead + trimmed.length);
      prev.end = prev.start + prev.text.length;
      continue;
    }
    out.push({ text: trimmed, start: m.index + lead, end: m.index + lead + trimmed.length });
  }
  return out;
}

const OPENERS = '„“"‘\'';
const CLOSERS = { '„': '”“"', '“': '”"', '"': '"', '‘': '’', "'": "'’" };
const isWord = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

// Posities van geciteerde passages. Woorden binnen een citaat zijn van de geciteerde, niet van de redactie.
export function quoteSpans(text) {
  const spans = [];
  let open = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const prev = text[i - 1];
    const next = text[i + 1];
    if (!open) {
      if (!OPENERS.includes(c) || isWord(prev) || !next || /\s/.test(next)) continue;
      // 's ochtends, 't huis, 'n beetje: weglatingsteken, geen citaat.
      if ((c === "'" || c === '‘') && /^[stn][\s-]/i.test(text.slice(i + 1, i + 3))) continue;
      open = { i, c };
    } else if (CLOSERS[open.c].includes(c) && !isWord(next) && !/\s/.test(prev || ' ')) {
      if (i - open.i >= 8) spans.push([open.i, i + 1]);
      open = null;
    } else if (i - open.i > 600 || c === '\n') {
      open = null;
    }
  }
  return spans;
}

export function inSpans(spans, pos) {
  for (const [a, b] of spans) if (pos >= a && pos < b) return true;
  return false;
}
