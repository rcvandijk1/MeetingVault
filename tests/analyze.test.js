import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, bandSummary } from '../src/analyze.js';
import { splitSentences, quoteSpans, tokenize, countWords } from '../src/text.js';

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

test('neutraal nieuwsbericht krijgt band laag', () => {
  const r = analyze({ title: 'Utrechtse raad stemt in met 1.200 woningen in Overvecht', text: fixture('neutraal.txt') });
  assert.equal(r.band, 'laag', JSON.stringify(r.findings.map((f) => [f.id, f.count])));
  assert.ok(r.density < 5);
});

test('sensationele tekst krijgt band hoog met meerdere technieken en citaten', () => {
  const r = analyze({ title: 'SCHOKKEND: dit moet je weten over Den Haag', text: fixture('sensatie.txt') });
  assert.equal(r.band, 'hoog');
  const ids = r.findings.map((f) => f.id);
  for (const id of ['geladen-taal', 'angstframing', 'absoluut', 'vage-bron', 'wij-zij', 'urgentie', 'stelligheid', 'suggestief', 'typografie']) {
    assert.ok(ids.includes(id), `mist techniek ${id}`);
  }
  for (const f of r.findings) {
    for (const ex of f.examples) {
      assert.equal(ex.sentence.slice(ex.matchStart, ex.matchEnd), ex.match, 'markering moet precies op de treffer vallen');
    }
  }
  assert.ok(r.findings.find((f) => f.id === 'urgentie').inTitleCount >= 1);
  assert.match(bandSummary(r), /Veel taalsignalen/);
});

test('geladen woord in een citaat telt minder en wordt als citaat gemeld', () => {
  const filler = 'De minister lichtte het besluit toe in de Tweede Kamer en beantwoordde vragen van de fracties. '.repeat(12);
  const own = analyze({ title: 'Debat', text: `${filler} Het besluit is een schande.` });
  const quoted = analyze({ title: 'Debat', text: `${filler} De oppositieleider noemde het besluit "een schande voor het land".` });
  const a = own.findings.find((f) => f.id === 'geladen-taal');
  const b = quoted.findings.find((f) => f.id === 'geladen-taal');
  assert.equal(a.inQuoteCount, 0);
  assert.equal(b.inQuoteCount, 1);
  assert.ok(b.score < a.score);
  assert.ok(quoted.notes.some((n) => /citaat/.test(n)));
});

test('woorden worden alleen als heel woord herkend', () => {
  const filler = 'De gemeente meldt dat de werkzaamheden volgens planning verlopen en dat de weg open blijft. '.repeat(12);
  const r = analyze({ title: 'Vliegtuig landt veilig', text: `${filler} Het vliegtuig landde in totaal drie keer. De KNMI en de NAVO gaven uitleg.` });
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings.map((f) => [f.id, f.examples.map((e) => e.match)])));
});

test('korte tekst geeft geen band, opiniestuk geeft een kanttekening', () => {
  const r = analyze({ title: 'Kort', text: 'Dit is een schande.', isOpinion: true });
  assert.equal(r.band, 'onbepaald');
  assert.ok(r.tooShort);
  assert.ok(r.notes.some((n) => /opiniestuk/.test(n)));
});

test('zinnen, citaten en tokens', () => {
  const s = splitSentences('Dat zei o.a. de minister. Het was laat! Waarom?');
  assert.deepEqual(s.map((x) => x.text), ['Dat zei o.a. de minister.', 'Het was laat!', 'Waarom?']);
  assert.equal(splitSentences('Iedereen weet dat. De rest volgt. Dr. Jansen kwam ca. 5 keer.').length, 3, 'een kort woord voor de punt is geen afkorting');
  const t = "Hij zei: 'Dit is zo'n slecht plan.' En 's ochtends was het stil. Zij: „Dat klopt niet.”";
  const spans = quoteSpans(t).map(([a, b]) => t.slice(a, b));
  assert.deepEqual(spans, ["'Dit is zo'n slecht plan.'", '„Dat klopt niet.”']);
  assert.deepEqual(tokenize('De ministers praten over de stakingen in 2026'), ['minister', 'praten', 'staking', '2026']);
  assert.equal(countWords("Zo'n e-mail is 3 woorden"), 5);
});
