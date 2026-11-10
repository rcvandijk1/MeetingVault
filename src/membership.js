// Lidmaatschap. De extensie bewaart alleen een lidcode; of die geldig is beslist de server bij elke analyse.
// Wat hier in de browser staat is door de gebruiker aan te passen: de echte afscherming zit op de server.
import { CONFIG } from '../config.js';

export async function getMembership() {
  const { memberToken = '' } = await chrome.storage.local.get('memberToken');
  return { token: memberToken, member: !!memberToken && !!CONFIG.serverUrl };
}

export function setMemberToken(token) {
  return token ? chrome.storage.local.set({ memberToken: token }) : chrome.storage.local.remove('memberToken');
}

/** Kiest een sponsorbericht; wisselt per vertoning. Ongeldige berichten worden overgeslagen. */
export function pickSponsor(sponsors, counter) {
  const valid = (Array.isArray(sponsors) ? sponsors : []).filter((s) => s && s.title && /^https:\/\//i.test(s.url || ''));
  return valid.length ? valid[counter % valid.length] : null;
}

/** Laat de eigen server het artikel beoordelen. Geeft het ruwe antwoord van het model terug. */
export async function requestServer(article, token, { fetchImpl = fetch, url = CONFIG.serverUrl, timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ article: { title: article.title, text: article.text, isOpinion: !!article.isOpinion, isSelection: !!article.isSelection, paywalled: !!article.paywalled } }),
      signal: ctrl.signal,
      credentials: 'omit',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `De server gaf een fout (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return body; // { data, model }
  } finally {
    clearTimeout(timer);
  }
}
