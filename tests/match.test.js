import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findCoverage } from '../src/match.js';
import { findOutlet, applyOverrides, matchPatterns } from '../src/outlets.js';

const data = JSON.parse(readFileSync(new URL('../data/outlets.json', import.meta.url), 'utf8'));
const pick = (...ids) => data.outlets.filter((o) => ids.includes(o.id));
const now = Date.parse('2026-11-10T09:00:00Z');
const item = (title, description, link, date = now) => ({ title, description, link, date });

const noise = [
  item('Ajax wint met ruime cijfers van Feyenoord', 'De Amsterdammers waren in de Arena veel te sterk.', 'https://x.nl/1'),
  item('Kabinet presenteert nieuwe plannen voor de zorg', 'De minister wil de wachtlijsten verkorten.', 'https://x.nl/2'),
  item('Regen en wind verwacht in het weekend', 'Het KNMI geeft code geel af voor de kust.', 'https://x.nl/3'),
  item('Staking bij de bakkers in Rotterdam', 'Personeel van drie bakkerijen legt het werk neer.', 'https://x.nl/4'),
  item('Minister bezoekt school in Groningen', 'Het bezoek stond in het teken van het lerarentekort.', 'https://x.nl/5'),
];

const article = {
  title: 'Machinisten NS staken donderdag: geen treinen in de Randstad',
  text: 'Machinisten van de NS leggen donderdag het werk neer. Vakbond FNV eist een hoger loon. Door de staking rijden er de hele dag geen treinen in de Randstad.',
  url: 'https://www.nu.nl/binnenland/123/machinisten-staken.html',
  date: now,
};

const feeds = {
  nu: { ok: true, items: [item(article.title, 'Zelfde bericht', article.url), ...noise] },
  volkskrant: { ok: true, items: [item('Treinstaking donderdag: machinisten NS leggen werk neer', 'De FNV roept machinisten op om donderdag te staken. In de Randstad rijden geen treinen.', 'https://www.volkskrant.nl/a'), ...noise] },
  ad: { ok: true, items: [item('Machinisten NS staken donderdag: geen treinen in de Randstad', 'ANP', 'https://www.ad.nl/a'), ...noise] },
  telegraaf: { ok: true, items: [item('Reizigers de dupe: NS-machinisten gooien donderdag de Randstad plat met staking', 'Vakbond FNV zet treinen stil.', 'https://www.telegraaf.nl/a'), ...noise] },
  nrc: { ok: true, items: noise },
  geenstijl: { ok: false, items: [], error: 'HTTP 403' },
  trouw: { ok: true, items: [item('Machinisten NS staakten in 2019 ook al in de Randstad', 'Terugblik op de treinstaking van toen.', 'https://www.trouw.nl/oud', now - 30 * 86400000), ...noise] },
};

test('vindt dezelfde berichtgeving, slaat de eigen titel over en telt per kant', () => {
  const outlets = pick('nu', 'volkskrant', 'ad', 'telegraaf', 'nrc', 'geenstijl', 'trouw');
  const cov = findCoverage(article, feeds, outlets, 'nu');
  assert.deepEqual(cov.matched.map((m) => m.outlet.id).sort(), ['ad', 'telegraaf', 'volkskrant']);
  assert.deepEqual(cov.unmatched.map((u) => u.outlet.id).sort(), ['nrc', 'trouw'], 'ruis en een bericht van een maand oud tellen niet');
  assert.deepEqual(cov.failed.map((f) => [f.outlet.id, f.error]), [['geenstijl', 'HTTP 403']]);
  assert.deepEqual(cov.summary.sides, { links: 1, midden: 1, rechts: 1 });
  assert.equal(cov.summary.nearDuplicates, 1);
  assert.equal(cov.matched.find((m) => m.outlet.id === 'ad').nearDuplicate, true);
  assert.deepEqual(cov.summary.owners, [{ owner: 'DPG Media', count: 2 }, { owner: 'Mediahuis', count: 1 }]);
});

test('een ander onderwerp met één gedeeld woord is geen match', () => {
  const other = { title: 'Staking bij vuilophalers in Antwerpen duurt voort', text: 'De vuilnis blijft liggen in de stad.', url: 'https://www.hln.be/x', date: now };
  const cov = findCoverage(other, feeds, pick('volkskrant', 'ad', 'telegraaf', 'nrc'), null);
  assert.equal(cov.matched.length, 0, JSON.stringify(cov.matched));
});

test('titels opzoeken op hostnaam en eigen indeling toepassen', () => {
  assert.equal(findOutlet(data.outlets, 'www.nos.nl').id, 'nos');
  assert.equal(findOutlet(data.outlets, 'feeds.nos.nl').id, 'nos');
  assert.equal(findOutlet(data.outlets, 'nietnos.nl'), null);
  assert.equal(findOutlet(data.outlets, 'example.com'), null);
  const changed = applyOverrides(data.outlets, { nrc: 'centrum-rechts', nos: 'onzin' }, data.leans);
  assert.equal(changed.find((o) => o.id === 'nrc').lean, 'centrum-rechts');
  assert.equal(changed.find((o) => o.id === 'nrc').overridden, true);
  assert.equal(changed.find((o) => o.id === 'nos').lean, 'centrum');
});

test('de medialijst is intern consistent', () => {
  const ids = new Set(), domains = new Set();
  for (const o of data.outlets) {
    assert.ok(!ids.has(o.id), `dubbele id ${o.id}`); ids.add(o.id);
    assert.ok(data.leans.includes(o.lean), `onbekende indeling bij ${o.id}`);
    assert.ok(o.basis && o.owner && ['NL', 'BE'].includes(o.country), `onvolledig: ${o.id}`);
    for (const d of o.domains) { assert.ok(!domains.has(d), `dubbel domein ${d}`); domains.add(d); }
    for (const f of o.feeds) assert.ok(findOutlet([o], new URL(f).hostname), `feed van ${o.id} valt buiten de eigen domeinen en heeft dus geen toestemming`);
  }
  assert.equal(matchPatterns(data.outlets).length, domains.size);
});
