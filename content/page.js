// Draait in de nieuwspagina zelf: herkent artikelen, leest de tekst en laat de gebruiker een artikel aanwijzen.
// Klassiek script (geen module), omdat content scripts geen ES-modules kunnen zijn.
(() => {
  if (window.__kantlijn) return;
  window.__kantlijn = true;

  const ARTICLE_TYPES = /^(News|Reportage|Opinion|Analysis|Background|Review|Satirical)?(NewsArticle|Article)$|^(BlogPosting|LiveBlogPosting)$/;
  const OPINION_URL = /\/(opinie|opinies|columns?|columnisten|commentaar|ingezonden|lezersbrieven|blogs?|standpunt|essay)(\/|$)/i;
  const SKIP = 'nav, aside, footer, header, form, figure, figcaption, script, style, noscript, [aria-hidden="true"], [class*="related"], [class*="newsletter"], [class*="cookie"], [class*="consent"], [class*="paywall"], [class*="comment"], [class*="reactie"]';

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const words = (s) => (s.match(/\S+/g) || []).length;

  function jsonLd(doc) {
    const found = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      const types = [].concat(node['@type'] || []);
      if (types.some((t) => ARTICLE_TYPES.test(String(t)))) found.push(node);
      if (node['@graph']) visit(node['@graph']);
    };
    for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(el.textContent)); } catch { /* kapotte JSON-LD komt vaak voor */ }
    }
    return found[0] || null;
  }

  const meta = (doc, ...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      if (el && el.content) return clean(el.content);
    }
    return '';
  };

  function paragraphs(root) {
    const out = [];
    for (const p of root.querySelectorAll('p, blockquote, h2, h3, li')) {
      if (p.closest(SKIP)) continue;
      if (p.matches('blockquote') && p.querySelector('p')) continue;
      if (p.matches('li') && p.querySelector('a') && clean(p.textContent) === clean(p.querySelector('a').textContent)) continue;
      const t = clean(p.textContent);
      if (t.length >= (p.matches('h2, h3') ? 8 : 40)) out.push(t);
    }
    return out;
  }

  function bodyText(doc) {
    let best = [];
    let bestLen = 0;
    const candidates = doc.querySelectorAll('[itemprop="articleBody"], article, main, [role="main"], [class*="article-body"], [class*="article__body"], [class*="articleBody"]');
    for (const el of candidates) {
      const ps = paragraphs(el);
      const len = ps.reduce((a, p) => a + p.length, 0);
      if (len > bestLen) { best = ps; bestLen = len; }
    }
    if (bestLen < 400 && doc.body) {
      const ps = paragraphs(doc.body);
      const len = ps.reduce((a, p) => a + p.length, 0);
      if (len > bestLen) best = ps;
    }
    return best.join('\n');
  }

  function extract(doc, url) {
    const ld = jsonLd(doc);
    const title = clean(ld?.headline) || meta(doc, 'og:title', 'twitter:title') || clean(doc.querySelector('h1')?.textContent) || clean(doc.title);
    const dom = bodyText(doc);
    const ldBody = clean(typeof ld?.articleBody === 'string' ? ld.articleBody : '');
    // Neem de langste versie: bij een betaalmuur staat de volledige tekst soms alleen in de pagina of alleen in de metadata.
    const text = ldBody.length > dom.length ? ldBody : dom;
    const rawDate = ld?.datePublished || meta(doc, 'article:published_time', 'date', 'pubdate');
    const time = rawDate ? Date.parse(rawDate) : NaN;
    const types = [].concat(ld?.['@type'] || []).map(String);
    const section = clean([].concat(ld?.articleSection || []).join(' ')) || meta(doc, 'article:section');
    const wordCount = words(text);
    return {
      url,
      title,
      text,
      words: wordCount,
      date: Number.isFinite(time) ? time : null,
      isArticle: (!!ld || meta(doc, 'og:type') === 'article') && wordCount >= 80,
      isOpinion: types.some((t) => /Opinion/.test(t)) || OPINION_URL.test(new URL(url).pathname) || /opinie|column|commentaar/i.test(section),
      paywalled: ld?.isAccessibleForFree === false || ld?.isAccessibleForFree === 'False' || ld?.isAccessibleForFree === 'false',
    };
  }

  // ---- Een artikel aanwijzen op een overzichtspagina ----

  let selecting = null;

  function articleLink(target) {
    const a = target instanceof Element ? target.closest('a[href]') : null;
    if (!a) return null;
    let url;
    try { url = new URL(a.href, location.href); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return null;
    if (url.pathname === location.pathname || url.pathname.split('/').filter(Boolean).length < 1) return null;
    const label = clean(a.textContent) || clean(a.getAttribute('aria-label')) || clean(a.querySelector('img')?.alt);
    if (label.length < 20 && url.pathname.length < 25) return null;
    return { a, url: url.href, label };
  }

  function stopSelecting() {
    if (!selecting) return;
    document.removeEventListener('mouseover', selecting.over, true);
    document.removeEventListener('click', selecting.click, true);
    document.removeEventListener('keydown', selecting.key, true);
    selecting.clear();
    selecting.banner.remove();
    selecting = null;
  }

  function startSelecting() {
    stopSelecting();
    const banner = document.createElement('div');
    banner.textContent = 'Kantlijn: klik op een artikel om het te analyseren. Druk op Esc om te stoppen.';
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;pointer-events:none;padding:10px 16px;background:#1d3557;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 -2px 8px rgba(0,0,0,.3)';
    document.documentElement.appendChild(banner);

    let marked = null;
    let previous = '';
    const clear = () => { if (marked) { marked.style.outline = previous; marked = null; } };
    const over = (e) => {
      const hit = articleLink(e.target);
      if (hit?.a === marked) return;
      clear();
      if (!hit) return;
      marked = hit.a;
      previous = marked.style.outline;
      marked.style.outline = '3px solid #e76f51';
    };
    const click = async (e) => {
      const hit = articleLink(e.target);
      if (!hit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stopSelecting();
      chrome.runtime.sendMessage({ type: 'kl:selecting', state: 'loading', label: hit.label });
      try {
        const res = await fetch(hit.url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const article = extract(doc, res.url || hit.url);
        if (!article.title) article.title = hit.label;
        chrome.runtime.sendMessage({ type: 'kl:selected', article });
      } catch (err) {
        chrome.runtime.sendMessage({ type: 'kl:selecting', state: 'error', url: hit.url, error: String(err.message || err) });
      }
    };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      stopSelecting();
      chrome.runtime.sendMessage({ type: 'kl:selecting', state: 'cancelled' });
    };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    selecting = { over, click, key, clear, banner };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'kl:extract') {
      reply(extract(document, location.href));
    } else if (msg.type === 'kl:selection') {
      const text = clean(String(window.getSelection() || ''));
      reply({ url: location.href, title: clean(document.title), text, words: words(text), date: null, isArticle: false, isOpinion: false, paywalled: false, isSelection: true });
    } else if (msg.type === 'kl:startSelect') {
      startSelecting();
      reply({ ok: true });
    } else if (msg.type === 'kl:stopSelect') {
      stopSelecting();
      reply({ ok: true });
    }
  });

  // Laat de achtergrond weten of dit een artikelpagina is, voor het icoon.
  try {
    const info = extract(document, location.href);
    chrome.runtime.sendMessage({ type: 'kl:page', isArticle: info.isArticle }).catch(() => {});
  } catch { /* pagina zonder leesbare inhoud */ }
})();
