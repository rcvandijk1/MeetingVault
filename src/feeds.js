// RSS/Atom ophalen en ontleden. Bewust zonder DOMParser, zodat dit ook in Node en in een service worker werkt.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', eacute: 'é', egrave: 'è', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

export function cleanText(s) {
  let t = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t); // feeds bevatten vaak ge-escapete HTML
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}

function tag(block, names) {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    if (m) return m[1];
  }
  return '';
}

function linkOf(block) {
  const atom = [...block.matchAll(/<link\b([^>]*)\/?>(?!\s*[^<\s])/gi)];
  let fallback = '';
  for (const [, attrs] of atom) {
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    const rel = attrs.match(/rel\s*=\s*["']([^"']+)["']/i);
    if (!rel || rel[1] === 'alternate') return decodeEntities(href[1]);
    fallback = fallback || decodeEntities(href[1]);
  }
  const rss = tag(block, ['link']);
  if (rss.trim()) return cleanText(rss);
  if (fallback) return fallback;
  const guid = tag(block, ['guid', 'id']);
  return /^https?:\/\//i.test(cleanText(guid)) ? cleanText(guid) : '';
}

export function parseFeed(xml) {
  const items = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[2];
    const title = cleanText(tag(block, ['title']));
    const link = linkOf(block);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const description = cleanText(tag(block, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 600);
    const rawDate = cleanText(tag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const time = rawDate ? Date.parse(rawDate) : NaN;
    items.push({ title, link, description, date: Number.isFinite(time) ? time : null });
  }
  return items;
}

// Zoekt in de HTML van een homepage naar een aangekondigde feed.
export function discoverFeed(html, baseUrl) {
  for (const [, attrs] of String(html).matchAll(/<link\b([^>]*)>/gi)) {
    if (!/type\s*=\s*["']application\/(?:rss|atom)\+xml["']/i.test(attrs)) continue;
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!href) continue;
    try {
      const url = new URL(decodeEntities(href[1]), baseUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch { /* ongeldige href, volgende proberen */ }
  }
  return null;
}

async function fetchText(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, credentials: 'omit', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Haalt de feed van één titel op. Lukt de ingestelde feed niet, dan wordt op de homepage naar een feed gezocht.
 * @returns {Promise<{ok: boolean, items: Array, source?: string, error?: string}>}
 */
export async function loadOutletFeed(outlet, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  let lastError = 'geen feed ingesteld';
  for (const url of outlet.feeds || []) {
    try {
      const items = parseFeed(await fetchText(url, fetchImpl, timeoutMs));
      if (items.length > 0) return { ok: true, items, source: url };
      lastError = 'feed bevat geen artikelen';
    } catch (e) {
      lastError = e.name === 'AbortError' ? 'time-out' : String(e.message || e);
    }
  }
  try {
    const home = `https://www.${outlet.domains[0]}/`;
    const found = discoverFeed(await fetchText(home, fetchImpl, timeoutMs), home);
    if (found && !(outlet.feeds || []).includes(found)) {
      const items = parseFeed(await fetchText(found, fetchImpl, timeoutMs));
      if (items.length > 0) return { ok: true, items, source: found, discovered: true };
    }
  } catch { /* de eerdere foutmelding is informatiever */ }
  return { ok: false, items: [], error: lastError };
}

/**
 * Haalt alle feeds parallel op, met een cache zodat een tweede analyse geen nieuw verkeer veroorzaakt.
 * @param cache object met get(key) en set(key, value), beide async
 */
export async function loadAllFeeds(outlets, { fetchImpl = fetch, cache = null, ttlMs = 15 * 60 * 1000, now = Date.now, onProgress = null, timeoutMs = 8000 } = {}) {
  let done = 0;
  const results = {};
  await Promise.all(outlets.map(async (outlet) => {
    const key = `feed:${outlet.id}`;
    let entry = cache ? await cache.get(key) : null;
    if (!entry || now() - entry.at > ttlMs) {
      const loaded = await loadOutletFeed(outlet, { fetchImpl, timeoutMs });
      entry = { at: now(), ...loaded };
      // Mislukte pogingen kort bewaren, zodat een tijdelijke storing niet een kwartier blijft hangen.
      if (cache) await cache.set(key, loaded.ok ? entry : { ...entry, at: now() - ttlMs + 60 * 1000 });
    }
    results[outlet.id] = entry;
    done++;
    if (onProgress) onProgress(done, outlets.length);
  }));
  return results;
}
