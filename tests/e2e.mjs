// Proefdraai in een echte Chromium: laadt de extensie, opent nagebootste nieuwspagina's op www.nu.nl
// (omgeleid naar een lokale server) en controleert het zijpaneel. Feeds worden nagebootst.
// Gebruik: npm run test:e2e   (vereist Playwright met Chromium)
import http from 'node:http';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // require vindt ook een globaal geïnstalleerde Playwright

const root = fileURLToPath(new URL('..', import.meta.url));
const shots = process.env.KANTLIJN_SHOTS || null;
const sensatie = readFileSync(new URL('fixtures/sensatie.txt', import.meta.url), 'utf8');
const neutraal = readFileSync(new URL('fixtures/neutraal.txt', import.meta.url), 'utf8');
const paras = (t) => t.match(/[^.!?]+[.!?]+["”]?\s*/g).reduce((acc, s, i) => { (acc[Math.floor(i / 3)] ||= []).push(s); return acc; }, []).map((p) => `<p>${p.join('')}</p>`).join('\n');

const page = (title, body, type = 'NewsArticle') => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title} | NU.nl</title>
<meta property="og:type" content="article"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': type, headline: title, datePublished: new Date().toISOString() })}</script></head>
<body><nav><p>Menu met een lange regel tekst die niet bij het artikel hoort en dus genegeerd moet worden.</p></nav>
<article><h1>${title}</h1>${body}</article><footer><p>Voettekst die schokkend genoeg niet mag meetellen in de analyse van dit artikel.</p></footer></body></html>`;

const pages = {
  '/binnenland/1/den-haag.html': page('SCHOKKEND: dit moet je weten over Den Haag', paras(sensatie)),
  '/binnenland/2/woningen-overvecht.html': page('Utrechtse raad stemt in met 1.200 woningen in Overvecht', paras(neutraal)),
  '/': `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>NU.nl</title></head><body><main>
    <a id="a1" href="/binnenland/2/woningen-overvecht.html"><h2>Utrechtse raad stemt in met 1.200 woningen in Overvecht</h2></a>
    <a id="a2" href="/binnenland/1/den-haag.html"><h2>SCHOKKEND: dit moet je weten over Den Haag</h2></a>
    <a id="short" href="/sport">Sport</a></main></body></html>`,
};

const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link><description>${d}</description><pubDate>${new Date().toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
const ruis = [['Ajax wint van Feyenoord', 'https://x.nl/1', 'Voetbal'], ['Regen verwacht in het weekend', 'https://x.nl/2', 'Weer'], ['Minister bezoekt school in Groningen', 'https://x.nl/3', 'Onderwijs']];
const feeds = {
  'www.volkskrant.nl': rss([['Raad Utrecht akkoord met 1.200 woningen in Overvecht', 'https://www.volkskrant.nl/a', 'De gemeenteraad van Utrecht stemde in met de bouw van woningen in de wijk Overvecht.'], ...ruis]),
  'www.ad.nl': rss([['Utrechtse raad stemt in met 1.200 woningen in Overvecht', 'https://www.ad.nl/a', 'ANP'], ...ruis]),
  'www.telegraaf.nl': rss([['Parkeerchaos dreigt: Utrecht drukt 1.200 woningen in Overvecht door', 'https://www.telegraaf.nl/a', 'Gemeenteraad Utrecht stemt in met woningen, oppositie boos over parkeerplaatsen.'], ...ruis]),
  'www.nrc.nl': rss(ruis),
};

const server = http.createServer((req, res) => {
  const body = pages[req.url.split('?')[0]];
  res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body || 'niet gevonden');
}).listen(0);
const port = server.address().port;
const site = `http://www.nu.nl:${port}`;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'kantlijn-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 420, height: 900 },
  deviceScaleFactor: shots ? 2 : 1,
  colorScheme: process.env.KANTLIJN_DARK ? 'dark' : 'light',
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, `--host-resolver-rules=MAP www.nu.nl 127.0.0.1`, '--no-proxy-server'],
});
let failed = false;
try {
  await context.route(/^https:\/\//, (route) => {
    const host = new URL(route.request().url()).hostname;
    return feeds[host] ? route.fulfill({ status: 200, contentType: 'application/rss+xml', body: feeds[host] }) : route.abort();
  });

  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = new URL(worker.url()).hostname;
  const tabIdOf = (url) => worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  const openPanel = async (tabId) => {
    const p = await context.newPage();
    p.on('pageerror', (e) => { failed = true; console.error('Fout in paneel:', e.message); });
    await p.goto(`chrome-extension://${extId}/panel/panel.html?tabId=${tabId}`);
    await p.waitForSelector('#site p');
    return p;
  };
  const shot = async (p, name) => { if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: join(shots, name), fullPage: true }); } };

  // 1. Artikelpagina: herkenning, analyse en vergelijking.
  const art = await context.newPage();
  await art.goto(`${site}/binnenland/1/den-haag.html`);
  const artTab = await tabIdOf(art.url());
  await art.waitForTimeout(500);
  assert.equal(await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), artTab), 'art', 'icoon toont dat een artikel is herkend');

  let panel = await openPanel(artTab);
  assert.match(await panel.textContent('#site'), /Nieuwssite herkend.*NU\.nl.*centrum/s);
  await panel.click('#btn-article');
  await panel.waitForSelector('#result:not([hidden])');
  assert.equal((await panel.textContent('#band .label')).trim(), 'hoog');
  assert.equal(await panel.textContent('#art-title'), 'SCHOKKEND: dit moet je weten over Den Haag');
  assert.ok(await panel.locator('.finding').count() >= 8);
  assert.ok(await panel.locator('.finding mark').count() >= 8);
  const all = await panel.textContent('#findings');
  assert.ok(!/Voettekst|Menu met een lange regel/.test(all), 'menu en voettekst horen niet bij het artikel');
  await panel.waitForFunction(() => !document.querySelector('#coverage progress') && document.querySelector('#coverage strong'));
  await shot(panel, 'sensatie.png');
  await panel.close();

  // 2. Overzichtspagina: een artikel aanwijzen zonder het te openen.
  const front = await context.newPage();
  await front.goto(`${site}/`);
  const frontTab = await tabIdOf(front.url());
  await front.waitForTimeout(300);
  assert.equal(await worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), frontTab), 'nws');
  panel = await openPanel(frontTab);
  await panel.click('#btn-select');
  await panel.waitForFunction(() => /Klik nu op een artikel/.test(document.getElementById('status').textContent));
  await front.bringToFront();
  await front.hover('#a1');
  assert.match(await front.$eval('#a1', (a) => a.style.outline), /solid/);
  await front.click('#a1');
  await panel.waitForSelector('#result:not([hidden])');
  assert.equal(front.url(), `${site}/`, 'de pagina navigeert niet weg bij het kiezen');
  assert.equal(await panel.textContent('#art-title'), 'Utrechtse raad stemt in met 1.200 woningen in Overvecht');
  assert.equal((await panel.textContent('#band .label')).trim(), 'laag');
  await panel.waitForFunction(() => !document.querySelector('#coverage progress') && document.querySelector('#coverage strong'));
  const cov = await panel.textContent('#coverage');
  assert.match(cov, /3 van de 4 gecontroleerde titels/);
  assert.deepEqual(await panel.$$eval('.legend strong', (els) => els.map((e) => e.textContent)), ['1', '1', '1']);
  assert.match(cov, /vrijwel gelijk/);
  assert.match(cov, /DPG Media \(2\)/);
  assert.match(cov, /Niet te controleren: 27 titels/);
  assert.equal(await panel.$eval('.hits a', (a) => a.target), '_blank');
  await shot(panel, 'neutraal.png');

  // 3. Geselecteerde tekst.
  await front.bringToFront();
  await front.evaluate(() => getSelection().selectAllChildren(document.querySelector('#a2')));
  await panel.click('#btn-selection');
  await panel.waitForFunction(() => /geselecteerde tekst/.test(document.getElementById('art-source').textContent));
  assert.equal((await panel.textContent('#band .label')).trim(), 'onbepaald');
  await panel.close();

  // 4. Instellingen: eigen indeling werkt door in het paneel.
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extId}/options/options.html`);
  await opts.waitForSelector('#rows tr');
  assert.equal(await opts.locator('#rows tr').count(), 32);
  await opts.selectOption('select[aria-label="Indeling van NU.nl"]', 'centrum-rechts');
  await opts.waitForTimeout(200);
  await shot(opts, 'instellingen.png');
  panel = await openPanel(artTab);
  assert.match(await panel.textContent('#site'), /centrum-rechts \(jouw indeling\)/);

  // 5. Een pagina zonder toegang.
  const other = await context.newPage();
  await other.goto(`http://127.0.0.1:${port}/`);
  const otherPanel = await openPanel(await worker.evaluate(async () => (await chrome.tabs.query({})).find((t) => !t.url && !t.pendingUrl)?.id));
  assert.match(await otherPanel.textContent('#site'), /Geen toegang tot deze pagina/);
  assert.equal(await otherPanel.isHidden('#actions'), true);

  console.log(failed ? 'MISLUKT: fouten in het paneel' : 'Proefdraai geslaagd.');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await context.close();
  server.close();
}
process.exit(failed ? 1 : 0);
