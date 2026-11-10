import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, LIMITS } from '../server/handler.js';
import { pickSponsor, requestServer } from '../src/membership.js';
import { shape } from '../src/ai.js';

const data = { band: 'laag', summary: 'Zakelijk bericht.', findings: [], missing: [] };
const client = (seen = {}) => ({ beta: { messages: { create: async (req) => { seen.req = req; return { stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(data) }] }; } } } });
const setup = (over = {}) => {
  const counts = new Map();
  return createHandler({
    client: client(over.seen),
    verifyMember: async (t) => (t === 'geldig' ? 'lid-1' : null),
    countUse: async (id, day) => { const k = `${id}:${day}`; counts.set(k, (counts.get(k) || 0) + 1); return counts.get(k); },
    ...over,
  });
};
const post = (token, body) => new Request('https://server.test/analyze', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) });
const article = { title: 'Kop', text: 'De gemeenteraad stemde dinsdag in met het plan voor de wijk.' };

test('alleen een geldig lid krijgt een beoordeling', async () => {
  const seen = {};
  const handle = setup({ seen });
  assert.equal((await handle(post('', { article }))).status, 401);
  assert.equal((await handle(post('vals', { article }))).status, 401);
  assert.equal(seen.req, undefined, 'zonder geldig lidmaatschap wordt het model niet aangeroepen');
  const res = await handle(post('geldig', { article }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data, model: 'claude-opus-5-5' });
  assert.match(seen.req.messages[0].content, /De gemeenteraad stemde/);
});

test('ongeldige verzoeken, te lange artikelen en de daglimiet worden geweigerd', async () => {
  const handle = setup();
  assert.equal((await handle(new Request('https://server.test/analyze'))).status, 405);
  assert.equal((await handle(post('geldig', 'geen json'))).status, 400);
  assert.equal((await handle(post('geldig', { article: { text: 'kort' } }))).status, 400);
  assert.equal((await handle(post('geldig', { article: { text: 'x'.repeat(LIMITS.maxChars + 1) } }))).status, 413);
  const limited = setup({ countUse: async () => LIMITS.perDay + 1 });
  assert.equal((await limited(post('geldig', { article }))).status, 429);
});

test('een fout van de API lekt geen details naar de gebruiker', async () => {
  const handle = setup({ client: { beta: { messages: { create: async () => { const e = new Error('invalid x-api-key sk-ant-geheim'); e.status = 401; throw e; } } } } });
  const res = await handle(post('geldig', { article }));
  assert.equal(res.status, 502);
  assert.ok(!/sk-ant|x-api-key/.test(JSON.stringify(await res.json())));
});

test('de extensie stuurt de lidcode mee en verwerkt antwoord en fouten', async () => {
  const handle = setup();
  const fetchImpl = (url, init) => handle(new Request(url, init));
  const ok = await requestServer(article, 'geldig', { fetchImpl, url: 'https://server.test/analyze' });
  assert.equal(shape(article, ok.data, ok.model).band, 'laag');
  await assert.rejects(requestServer(article, 'vals', { fetchImpl, url: 'https://server.test/analyze' }), { status: 401 });
});

test('sponsorberichten: alleen geldige met https-link, wisselend per vertoning', () => {
  const list = [{ title: 'A', url: 'https://a.nl' }, { title: 'B', url: 'javascript:alert(1)' }, { url: 'https://c.nl' }, { title: 'D', url: 'https://d.nl' }];
  assert.equal(pickSponsor(list, 0).title, 'A');
  assert.equal(pickSponsor(list, 1).title, 'D');
  assert.equal(pickSponsor(list, 2).title, 'A');
  assert.equal(pickSponsor([], 0), null);
  assert.equal(pickSponsor(null, 0), null);
});
