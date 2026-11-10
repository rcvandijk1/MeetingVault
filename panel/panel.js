import { analyze, bandSummary } from '../src/analyze.js';
import { analyzeWithAI, MODELS } from '../src/ai.js';
import { loadAiSettings, createClient, explainError } from './ai-client.js';
import { loadAllFeeds } from '../src/feeds.js';
import { findCoverage, sideOf } from '../src/match.js';
import { findOutlet, hostnameOf, applyOverrides } from '../src/outlets.js';

const $ = (id) => document.getElementById(id);
const forcedTabId = Number(new URLSearchParams(location.search).get('tabId')) || null; // alleen voor tests

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

const safeLink = (url) => (/^https?:\/\//i.test(url) ? url : null);

const state = { outlets: [], leans: [], tab: null, outlet: null, pageReady: false, run: 0, shownUrl: null };

const cache = {
  async get(key) { try { return (await chrome.storage.session.get(key))[key] || null; } catch { return null; } },
  async set(key, value) { try { await chrome.storage.session.set({ [key]: value }); } catch { /* cache is optioneel */ } },
};

async function loadOutlets() {
  const data = await (await fetch(chrome.runtime.getURL('data/outlets.json'))).json();
  const { leanOverrides = {} } = await chrome.storage.sync.get('leanOverrides');
  state.leans = data.leans;
  state.outlets = applyOverrides(data.outlets, leanOverrides, data.leans);
}

function setStatus(text, isError = false) {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('error', isError);
}

async function currentTab() {
  if (forcedTabId) return chrome.tabs.get(forcedTabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// Zorgt dat het paginascript aanwezig is. Lukt alleen op herkende nieuwssites of na een klik op het icoon.
async function ensurePage(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/page.js'] });
    return true;
  } catch {
    return false;
  }
}

async function refreshSite() {
  const tab = await currentTab();
  state.tab = tab;
  state.outlet = tab?.url ? findOutlet(state.outlets, hostnameOf(tab.url)) : null;
  const isWeb = /^https?:\/\//i.test(tab?.url || '');
  state.pageReady = !!tab && (isWeb || !tab.url) ? await ensurePage(tab.id) : false;

  const site = $('site');
  site.replaceChildren();
  if (state.outlet) {
    const o = state.outlet;
    site.append(
      h('p', { class: 'meta', text: 'Nieuwssite herkend' }),
      h('p', {}, h('strong', { text: o.name }), ' ', h('span', { class: 'chip', title: o.basis, text: `${o.lean}${o.overridden ? ' (jouw indeling)' : ' (indicatief)'}` })),
      h('p', { class: 'meta', text: `Eigenaar: ${o.owner}. ${o.basis}` }),
    );
  } else if (state.pageReady) {
    site.append(
      h('p', { class: 'meta', text: 'Onbekende site' }),
      h('p', { text: `${hostnameOf(tab.url) || 'Deze site'} staat niet in de lijst met nieuwstitels. Je kunt de pagina wel analyseren, maar zonder indeling van de bron.` }),
    );
  } else {
    site.append(
      h('p', { class: 'meta', text: 'Geen toegang tot deze pagina' }),
      h('p', { text: 'Kantlijn leest alleen mee op herkende nieuwssites. Wil je deze pagina analyseren, klik dan op het Kantlijn-icoon in de werkbalk terwijl de pagina open staat.' }),
    );
  }
  $('actions').hidden = !state.pageReady;

  // Een nieuw adres betekent een ander artikel: het oude resultaat hoort er niet meer bij.
  if (state.shownUrl && tab?.url && tab.url !== state.shownUrl && !state.keepResult) {
    $('result').hidden = true;
    state.shownUrl = null;
    setStatus('');
  }
}

function ask(type) {
  return chrome.tabs.sendMessage(state.tab.id, { type });
}

function renderExample(ex) {
  // Lange zinnen inkorten rond de treffer, zodat het citaat leesbaar blijft.
  const MAX = 260;
  let { sentence, matchStart, matchEnd } = ex;
  let before = sentence.slice(0, matchStart);
  let after = sentence.slice(matchEnd);
  if (sentence.length > MAX) {
    const room = Math.max(40, Math.floor((MAX - (matchEnd - matchStart)) / 2));
    if (before.length > room) before = `… ${before.slice(-room)}`;
    if (after.length > room) after = `${after.slice(0, room)} …`;
  }
  const where = ex.inTitle ? 'in de kop' : ex.inQuote ? 'in een citaat' : null;
  const quote = h('blockquote', {}, before, h('mark', { text: sentence.slice(matchStart, matchEnd) }), after, where ? h('span', { class: 'where', text: where }) : null);
  return ex.explanation ? h('div', { class: 'example' }, quote, h('p', { class: 'explain', text: ex.explanation })) : quote;
}

function renderAnalysis(article, result) {
  const outlet = findOutlet(state.outlets, hostnameOf(article.url));
  $('art-source').textContent = [outlet?.name || hostnameOf(article.url), article.isSelection ? 'geselecteerde tekst' : null, article.date ? new Date(article.date).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : null].filter(Boolean).join(' · ');
  $('art-title').textContent = article.title || '(zonder titel)';

  $('band').replaceChildren(
    h('span', { class: `label ${result.band}`, text: result.band }),
    h('p', { text: result.engine === 'ai' ? result.summary : bandSummary(result) }),
  );
  const modelName = MODELS.find((m) => m.id === result.model)?.label.split(' (')[0] || result.model;
  $('engine').textContent = result.engine === 'ai'
    ? `Beoordeeld door ${modelName}. Dit is het oordeel van een AI-model: het kan zich vergissen. Elk citaat is teruggezocht in het artikel.`
    : 'Basisanalyse op woordpatronen, zonder AI.';

  const missing = result.missing || [];
  $('missing-section').hidden = missing.length === 0;
  $('missing').replaceChildren(...missing.map((m) => h('li', { text: m })));

  const notes = [...result.notes];
  if (article.paywalled) notes.push('Dit artikel staat (deels) achter een betaalmuur. Mogelijk is niet de hele tekst meegenomen.');
  $('notes').replaceChildren(...notes.map((n) => h('li', { text: n })));

  const box = $('findings');
  box.replaceChildren();
  if (result.findings.length === 0) {
    box.append(h('p', { class: 'empty', text: result.engine === 'ai'
      ? 'Het model vond geen beïnvloedingstechnieken in deze tekst. Dat zegt niets over of de inhoud klopt.'
      : 'Geen van de bekende taalpatronen gevonden. Dat betekent niet dat het artikel klopt of volledig is: weglaten en selectief citeren zijn zo niet te zien.' }));
  }
  result.findings.forEach((f, i) => {
    const parts = [`${f.count}×`];
    if (f.inTitleCount) parts.push(`${f.inTitleCount} in kop`);
    if (f.inQuoteCount) parts.push(`${f.inQuoteCount} in citaat`);
    box.append(h('details', { class: 'finding', open: i < 2 },
      h('summary', {}, h('span', { text: f.name }), h('span', { class: 'count', text: parts.join(', ') })),
      h('div', { class: 'body' }, h('p', { class: 'why', text: f.why }), ...f.examples.map(renderExample)),
    ));
  });

  $('result').hidden = false;
  state.shownUrl = state.tab?.url || article.url;
}

const SIDE_LABEL = { links: 'Links van het midden', midden: 'Midden', rechts: 'Rechts van het midden' };

function renderCoverage(cov, checked) {
  const box = $('coverage');
  box.replaceChildren();
  const s = cov.summary;
  const reachable = checked - cov.failed.length;

  if (reachable === 0) {
    box.append(h('p', { class: 'empty', text: 'Geen enkele nieuwsfeed was bereikbaar. Controleer je internetverbinding of bekijk de feeds bij "Instellingen".' }));
    return;
  }

  box.append(h('p', {}, h('strong', { text: `${s.total} van de ${reachable}` }), ` gecontroleerde titels ${s.total === 1 ? 'heeft' : 'hebben'} dit nieuws in ${s.total === 1 ? 'zijn' : 'hun'} recente feed.`));

  if (s.total > 0) {
    box.append(
      h('div', { class: 'bar', role: 'img', 'aria-label': `Links van het midden ${s.sides.links}, midden ${s.sides.midden}, rechts van het midden ${s.sides.rechts}` },
        ...['links', 'midden', 'rechts'].filter((k) => s.sides[k] > 0).map((k) => h('span', { class: k, style: `flex:${s.sides[k]}` }))),
      h('ul', { class: 'legend' }, ...['links', 'midden', 'rechts'].map((k) => h('li', {}, h('strong', { text: String(s.sides[k]) }), h('i', { class: k, style: `background:var(--seg-${k === 'links' ? 1 : k === 'midden' ? 2 : 3})` }), SIDE_LABEL[k]))),
    );

    const ownerText = s.owners.map((o) => `${o.owner} (${o.count})`).join(', ');
    box.append(h('p', { class: 'meta', text: s.owners.length < s.total
      ? `Let op: die ${s.total} titels zijn van ${s.owners.length} ${s.owners.length === 1 ? 'eigenaar' : 'eigenaren'}: ${ownerText}. Titels van één uitgever delen vaak kopij.`
      : `Eigenaren: ${ownerText}.` }));
    if (s.nearDuplicates > 0) {
      box.append(h('p', { class: 'meta', text: `Bij ${s.nearDuplicates} ${s.nearDuplicates === 1 ? 'titel' : 'titels'} is de kop vrijwel gelijk. Dat wijst op hetzelfde persbericht (ANP, Belga), niet op onafhankelijke bevestiging.` }));
    }

    for (const side of ['links', 'midden', 'rechts']) {
      const hits = cov.matched.filter((m) => sideOf(m.outlet.lean) === side);
      if (hits.length === 0) continue;
      box.append(h('div', { class: 'group' },
        h('h4', { text: SIDE_LABEL[side] }),
        h('ul', { class: 'hits' }, ...hits.map((m) => h('li', {},
          h('div', { class: 'who' }, m.outlet.name, h('span', { class: 'chip', title: m.outlet.basis, text: m.outlet.lean }), m.nearDuplicate ? h('span', { class: 'chip', text: 'vrijwel gelijke kop' }) : null),
          safeLink(m.link) ? h('a', { href: m.link, target: '_blank', rel: 'noopener noreferrer', text: m.title }) : h('span', { text: m.title }),
        ))),
      ));
    }
  }

  if (cov.unmatched.length > 0) {
    box.append(h('details', { class: 'more' },
      h('summary', { text: `Niet gevonden bij ${cov.unmatched.length} ${cov.unmatched.length === 1 ? 'titel' : 'titels'}` }),
      h('p', { text: cov.unmatched.map((u) => u.outlet.name).join(', ') }),
      h('p', { class: 'meta', text: 'Een feed bevat alleen de nieuwste berichten. Niet gevonden betekent dus niet dat een titel er niet over heeft geschreven, en ouder nieuws valt er altijd buiten.' }),
    ));
  }
  if (cov.failed.length > 0) {
    box.append(h('details', { class: 'more' },
      h('summary', { text: `Niet te controleren: ${cov.failed.length} ${cov.failed.length === 1 ? 'titel' : 'titels'}` }),
      h('p', { text: cov.failed.map((f) => `${f.outlet.name} (${f.error})`).join(', ') }),
    ));
  }
  box.append(h('p', { class: 'meta', text: 'Veel media die hetzelfde melden maakt iets niet waar, en weinig media maakt het niet onwaar. Kijk vooral naar wie het níét brengt en hoe de koppen verschillen.' }));
}

async function report(article) {
  const run = ++state.run;
  setStatus('');
  if (!article || !article.text || article.words < 5) {
    setStatus(article?.isSelection ? 'Selecteer eerst een stuk tekst op de pagina.' : 'Op deze pagina is geen artikeltekst gevonden. Open een artikel of kies er een op de pagina.', true);
    return;
  }
  // Beide onderdelen lopen tegelijk: de vergelijking hoeft niet op het model te wachten.
  judge(article, run);

  const box = $('coverage');
  const bar = h('progress', { max: state.outlets.length, value: 0 });
  box.replaceChildren(h('p', { class: 'meta', text: 'Nieuwsfeeds ophalen…' }), bar);
  try {
    const feeds = await loadAllFeeds(state.outlets, { cache, onProgress: (done) => { if (run === state.run) bar.value = done; } });
    if (run !== state.run) return;
    const source = findOutlet(state.outlets, hostnameOf(article.url));
    const others = state.outlets.filter((o) => o.id !== source?.id);
    renderCoverage(findCoverage(article, feeds, state.outlets, source?.id || null), others.length);
  } catch (e) {
    if (run === state.run) box.replaceChildren(h('p', { class: 'empty', text: `De vergelijking is mislukt: ${e.message || e}` }));
  }
}

// Beoordeelt het artikel met het AI-model. Zonder sleutel, of als de API faalt, volgt de basisanalyse.
async function judge(article, run) {
  const ai = await loadAiSettings();
  if (!ai.key) {
    renderAnalysis(article, analyze(article));
    setStatus('Dit is de basisanalyse op woordpatronen. Voeg bij "Instellingen" een API-sleutel toe voor een beoordeling door een AI-model.');
    return;
  }
  $('result').hidden = true;
  setStatus('Het AI-model leest het artikel. Dit duurt meestal 10 tot 30 seconden.');
  try {
    const result = await analyzeWithAI(createClient(ai.key), article, { model: ai.model });
    if (run !== state.run) return;
    renderAnalysis(article, result);
    setStatus('');
  } catch (e) {
    if (run !== state.run) return;
    renderAnalysis(article, analyze(article));
    setStatus(`${explainError(e)} Hieronder staat de basisanalyse op woordpatronen.`, true);
  }
}

async function runPageAction(type) {
  await refreshSite();
  if (!state.pageReady) return;
  try {
    await report(await ask(type));
  } catch (e) {
    setStatus(`De pagina gaf geen antwoord (${e.message || e}). Herlaad de pagina en probeer het opnieuw.`, true);
  }
}

$('btn-article').addEventListener('click', () => runPageAction('kl:extract'));
$('btn-selection').addEventListener('click', () => runPageAction('kl:selection'));
$('btn-select').addEventListener('click', async () => {
  await refreshSite();
  if (!state.pageReady) return;
  try {
    await ask('kl:startSelect');
    setStatus('Klik nu op een artikel in de pagina. Druk daar op Esc om te stoppen.');
  } catch (e) {
    setStatus(`Kiezen lukt niet op deze pagina (${e.message || e}).`, true);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'kl:refresh') { refreshSite(); return; }
  if (!sender.tab || sender.tab.id !== state.tab?.id) return;
  if (msg.type === 'kl:selecting') {
    if (msg.state === 'loading') setStatus(`Artikel ophalen: ${msg.label}`);
    else if (msg.state === 'cancelled') setStatus('');
    else if (msg.state === 'error') setStatus(`Het artikel kon niet worden opgehaald (${msg.error}). Open het artikel en kies "Analyseer dit artikel".`, true);
  } else if (msg.type === 'kl:selected') {
    // Het gekozen artikel heeft een ander adres dan de overzichtspagina; het resultaat mag dan blijven staan.
    state.keepResult = true;
    if (msg.article.words < 120) msg.article.paywalled = true;
    report(msg.article);
  }
});

chrome.tabs.onActivated.addListener(() => { if (!forcedTabId) { state.keepResult = false; refreshSite(); } });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === state.tab?.id && change.status === 'complete') { state.keepResult = false; refreshSite(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.leanOverrides) loadOutlets().then(refreshSite);
});

async function showPrivacy() {
  const { key } = await loadAiSettings();
  $('privacy').textContent = key
    ? 'De tekst van een artikel dat je laat analyseren gaat naar de API van Anthropic, via je eigen sleutel. Je leesgedrag verder niet. Voor de vergelijking haalt Kantlijn alleen de openbare nieuwsfeeds op.'
    : 'Zonder API-sleutel gaat er geen artikeltekst naar een server. Voor de vergelijking haalt Kantlijn alleen de openbare nieuwsfeeds op.';
}
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.aiKey) showPrivacy(); });

await loadOutlets();
await showPrivacy();
await refreshSite();
