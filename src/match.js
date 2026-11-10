import { tokenize } from './text.js';

// Drempels voor "gaat over hetzelfde nieuws". Een inschatting op basis van testgevallen, niet gekalibreerd op grote schaal.
export const MATCH = { minScore: 0.24, minShared: 2, strongShared: 3, maxDays: 4, duplicateTitle: 0.8 };

const TITLE_WEIGHT = 2;
const LEAD_WORDS = 60;

function vector(title, lead) {
  const v = new Map();
  for (const t of tokenize(title)) v.set(t, (v.get(t) || 0) + TITLE_WEIGHT);
  for (const t of tokenize(String(lead || '').split(/\s+/).slice(0, LEAD_WORDS).join(' '))) v.set(t, (v.get(t) || 0) + 1);
  return v;
}

function cosine(a, b, idf) {
  let dot = 0, na = 0, nb = 0, shared = 0;
  for (const [t, wa] of a) {
    const w = wa * idf(t);
    na += w * w;
    const wb = b.get(t);
    if (wb) { dot += w * wb * idf(t); shared++; }
  }
  for (const [t, wb] of b) { const w = wb * idf(t); nb += w * w; }
  return { score: na && nb ? dot / Math.sqrt(na * nb) : 0, shared };
}

function titleOverlap(a, b) {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const sameUrl = (a, b) => {
  try {
    const x = new URL(a), y = new URL(b);
    return x.hostname.replace(/^www\./, '') === y.hostname.replace(/^www\./, '') && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch { return false; }
};

/**
 * Zoekt per titel het feedbericht dat het best bij het artikel past.
 * @param article {title, text, url, date?}
 * @param feeds   { [outletId]: {ok, items: [{title, link, description, date}]} }
 * @param outlets lijst uit outlets.json
 * @param sourceOutletId titel waar het artikel zelf vandaan komt (wordt niet meegeteld)
 */
export function findCoverage(article, feeds, outlets, sourceOutletId = null) {
  const query = vector(article.title, article.text);

  // IDF over alle feedberichten: een woord dat in elke kop staat zegt weinig.
  const df = new Map();
  let n = 1;
  const docs = new Map();
  for (const outlet of outlets) {
    for (const item of feeds[outlet.id]?.items || []) {
      const v = vector(item.title, item.description);
      docs.set(item, v);
      n++;
      for (const t of v.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
  }
  const idf = (t) => Math.log(1 + n / (1 + (df.get(t) || 0)));

  const matched = [], unmatched = [], failed = [];
  for (const outlet of outlets) {
    if (outlet.id === sourceOutletId) continue;
    const feed = feeds[outlet.id];
    if (!feed || !feed.ok) { failed.push({ outlet, error: feed?.error || 'niet opgehaald' }); continue; }
    let best = null;
    for (const item of feed.items) {
      if (article.url && sameUrl(article.url, item.link)) continue;
      if (article.date && item.date && Math.abs(article.date - item.date) > MATCH.maxDays * 86400000) continue;
      const { score, shared } = cosine(query, docs.get(item), idf);
      if (shared < MATCH.minShared) continue;
      // Weinig gedeelde woorden vraagt een hogere score; veel gedeelde woorden is op zichzelf al sterk.
      const needed = shared >= MATCH.strongShared ? MATCH.minScore : MATCH.minScore * 1.5;
      if (score < needed) continue;
      if (!best || score > best.score) best = { item, score, shared };
    }
    if (best) {
      matched.push({
        outlet,
        title: best.item.title,
        link: best.item.link,
        date: best.item.date,
        score: Math.round(best.score * 100) / 100,
        nearDuplicate: titleOverlap(article.title, best.item.title) >= MATCH.duplicateTitle,
      });
    } else {
      unmatched.push({ outlet });
    }
  }
  matched.sort((a, b) => b.score - a.score);
  return { matched, unmatched, failed, summary: summarize(matched) };
}

const SIDE = { links: 'links', 'centrum-links': 'links', centrum: 'midden', 'centrum-rechts': 'rechts', rechts: 'rechts' };

export function summarize(matched) {
  const sides = { links: 0, midden: 0, rechts: 0 };
  const owners = new Map();
  for (const m of matched) {
    sides[SIDE[m.outlet.lean] || 'midden']++;
    owners.set(m.outlet.owner, (owners.get(m.outlet.owner) || 0) + 1);
  }
  return {
    total: matched.length,
    sides,
    owners: [...owners].map(([owner, count]) => ({ owner, count })).sort((a, b) => b.count - a.count),
    nearDuplicates: matched.filter((m) => m.nearDuplicate).length,
  };
}

export function sideOf(lean) {
  return SIDE[lean] || 'midden';
}
