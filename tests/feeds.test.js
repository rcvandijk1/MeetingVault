import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, discoverFeed, loadOutletFeed, loadAllFeeds, cleanText } from '../src/feeds.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>Kanaal</title><link>https://voorbeeld.nl/</link>
<item><title><![CDATA[Kabinet &amp; Kamer eens over begroting]]></title><link>https://voorbeeld.nl/a/1</link>
<description><![CDATA[<p>Na <b>weken</b> overleg is er een akkoord.</p>]]></description><pubDate>Tue, 10 Nov 2026 08:00:00 +0100</pubDate></item>
<item><title>Tweede &quot;bericht&quot;</title><guid isPermaLink="true">https://voorbeeld.nl/a/2</guid><description>&lt;p&gt;Ge-escapete HTML&lt;/p&gt;</description></item>
<item><title>Zonder link</title></item></channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><link href="https://blog.nl/"/>
<entry><title>Eerste stuk</title><link rel="self" href="https://blog.nl/api/1"/><link rel="alternate" href="https://blog.nl/stuk/1?a=1&amp;b=2"/>
<summary>Samenvatting</summary><updated>2026-11-10T07:00:00Z</updated></entry></feed>`;

test('RSS wordt ontleed, inclusief CDATA, entiteiten en ontbrekende links', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { title: 'Kabinet & Kamer eens over begroting', link: 'https://voorbeeld.nl/a/1', description: 'Na weken overleg is er een akkoord.', date: Date.parse('2026-11-10T07:00:00Z') });
  assert.equal(items[1].title, 'Tweede "bericht"');
  assert.equal(items[1].link, 'https://voorbeeld.nl/a/2');
  assert.equal(items[1].description, 'Ge-escapete HTML');
  assert.equal(items[1].date, null);
});

test('Atom kiest de alternate-link', () => {
  const [item] = parseFeed(ATOM);
  assert.equal(item.link, 'https://blog.nl/stuk/1?a=1&b=2');
  assert.equal(item.date, Date.parse('2026-11-10T07:00:00Z'));
});

test('scripts en gevaarlijke links komen er niet door', () => {
  assert.equal(cleanText('<script>alert(1)</script>Tekst'), 'Tekst');
  assert.equal(parseFeed('<rss><item><title>x</title><link>javascript:alert(1)</link></item></rss>').length, 0);
});

test('feed wordt via de homepage gevonden als de ingestelde feed faalt', async () => {
  const pages = {
    'https://www.voorbeeld.nl/': '<html><head><link rel="alternate" type="application/rss+xml" href="/nieuw.xml"></head></html>',
    'https://www.voorbeeld.nl/nieuw.xml': RSS,
  };
  const fetchImpl = async (url) => (pages[url] ? { ok: true, text: async () => pages[url] } : { ok: false, status: 404 });
  const r = await loadOutletFeed({ id: 'v', domains: ['voorbeeld.nl'], feeds: ['https://www.voorbeeld.nl/oud.xml'] }, { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.discovered, true);
  assert.equal(r.items.length, 2);
  assert.equal(discoverFeed('<link type="application/atom+xml" href="javascript:1">', 'https://a.nl/'), null);
});

test('mislukte feed geeft een foutmelding en de cache voorkomt dubbel ophalen', async () => {
  let calls = 0;
  const fetchImpl = async (url) => { calls++; return url.includes('goed') ? { ok: true, text: async () => RSS } : { ok: false, status: 500 }; };
  const store = new Map();
  const cache = { get: async (k) => store.get(k) || null, set: async (k, v) => { store.set(k, v); } };
  const outlets = [{ id: 'a', domains: ['goed.nl'], feeds: ['https://goed.nl/rss'] }, { id: 'b', domains: ['stuk.nl'], feeds: ['https://stuk.nl/rss'] }];
  const first = await loadAllFeeds(outlets, { fetchImpl, cache });
  assert.equal(first.a.ok, true);
  assert.equal(first.b.ok, false);
  assert.equal(first.b.error, 'HTTP 500');
  const before = calls;
  const second = await loadAllFeeds(outlets, { fetchImpl, cache });
  assert.equal(second.a.items.length, 2);
  assert.equal(calls, before, 'binnen de cachetijd wordt niets opnieuw opgehaald');
});
