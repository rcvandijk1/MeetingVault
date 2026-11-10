import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithAI, locate, shape, SCHEMA, SYSTEM, MODELS } from '../src/ai.js';

const article = {
  title: 'Kabinet laat gewone Nederlander vallen',
  text: 'Het kabinet presenteerde dinsdag de begroting. Volgens ingewijden is de chaos compleet. De oppositieleider noemde het plan ‘een schande voor het land’. De minister reageerde niet.',
};
const answer = {
  band: 'middel',
  summary: 'De kop kiest partij en een zware bewering heeft geen bron.',
  findings: [
    { technique: 'wij-zij', quote: 'gewone Nederlander', explanation: 'De kop zet kabinet tegenover volk.', in_quote: false },
    { technique: 'vage-bron', quote: 'Volgens  ingewijden is de chaos compleet', explanation: 'Niemand staat voor deze bewering in.', in_quote: false },
    { technique: 'geladen-taal', quote: "'een schande voor het land'", explanation: 'Zonder weerwoord overgenomen.', in_quote: true },
    { technique: 'angstframing', quote: 'het land staat op instorten', explanation: 'Verzonnen citaat.', in_quote: false },
    { technique: 'bestaat-niet', quote: 'begroting', explanation: 'Onbekende techniek.', in_quote: false },
  ],
  missing: ['De minister komt niet inhoudelijk aan het woord.', ' '],
};
const fakeClient = (response, seen = {}) => ({ beta: { messages: { create: async (req) => { seen.req = req; return response; } } } });
const ok = (data) => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(data) }] });

test('het verzoek gebruikt het gekozen model, een vast schema en de fallback', async () => {
  const seen = {};
  await analyzeWithAI(fakeClient(ok(answer), seen), article);
  assert.equal(seen.req.model, 'claude-opus-5-5');
  assert.deepEqual(seen.req.output_config, { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } });
  assert.deepEqual(seen.req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(seen.req.fallbacks, 'default');
  assert.equal(seen.req.system, SYSTEM);
  assert.ok(!('thinking' in seen.req) && !('temperature' in seen.req), 'Opus 5.5 accepteert geen uitgeschakeld denken of temperatuur');
  assert.match(seen.req.messages[0].content, /<kop>Kabinet laat gewone Nederlander vallen<\/kop>/);

  await analyzeWithAI(fakeClient(ok(answer), seen), article, { model: 'claude-haiku-5-5' });
  assert.equal(seen.req.model, 'claude-haiku-5-5');
  assert.ok(!('fallbacks' in seen.req), 'Haiku 5.5 kent geen fallback aan de serverkant');
  assert.equal(MODELS.length, 3);
});

test('citaten worden teruggezocht; verzonnen citaten en onbekende technieken vallen af', async () => {
  const r = await analyzeWithAI(fakeClient(ok(answer)), article);
  assert.equal(r.engine, 'ai');
  assert.equal(r.band, 'middel');
  assert.equal(r.dropped, 2);
  assert.deepEqual(r.findings.map((f) => f.id).sort(), ['geladen-taal', 'vage-bron', 'wij-zij']);
  assert.ok(r.notes.some((n) => /2 vondsten zijn weggelaten/.test(n)));
  assert.deepEqual(r.missing, ['De minister komt niet inhoudelijk aan het woord.']);
  for (const f of r.findings) for (const ex of f.examples) {
    assert.equal(ex.sentence.slice(ex.matchStart, ex.matchEnd), ex.match, 'markering valt precies op het citaat');
  }
  const kop = r.findings.find((f) => f.id === 'wij-zij');
  assert.equal(kop.inTitleCount, 1);
  const citaat = r.findings.find((f) => f.id === 'geladen-taal');
  assert.equal(citaat.inQuoteCount, 1);
  assert.equal(citaat.examples[0].match, '‘een schande voor het land’', 'andere aanhalingstekens zijn geen reden om een citaat af te keuren');
  assert.equal(citaat.examples[0].explanation, 'Zonder weerwoord overgenomen.');
});

test('weigering, afgebroken en onleesbaar antwoord geven een herkenbare fout', async () => {
  await assert.rejects(analyzeWithAI(fakeClient({ stop_reason: 'refusal', content: [] }), article), { code: 'refusal' });
  await assert.rejects(analyzeWithAI(fakeClient({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"band":' }] }), article), { code: 'truncated' });
  await assert.rejects(analyzeWithAI(fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'geen json' }] }), article), { code: 'invalid' });
});

test('locate en shape zijn bestand tegen rommel', () => {
  assert.deepEqual(locate('Een  korte\nzin hier.', 'korte zin'), { start: 5, end: 14 });
  assert.equal(locate('Een korte zin.', 'lange zin'), null);
  assert.equal(locate('Een korte zin.', ' '), null);
  const r = shape(article, { band: 'paars', findings: 'nee', missing: null }, 'x');
  assert.equal(r.band, 'onbepaald');
  assert.equal(r.findings.length, 0);
  assert.deepEqual(r.missing, []);
});

test('het schema voldoet aan de eisen voor gestructureerde uitvoer', () => {
  const check = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(check);
    } else if (s.type === 'array') check(s.items);
  };
  check(SCHEMA);
});
