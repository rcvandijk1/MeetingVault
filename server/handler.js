// De server voor leden: controleert de lidcode, bewaakt een daglimiet en laat het AI-model het artikel beoordelen
// met de API-sleutel van de eigenaar. Geschreven tegen de standaard Request/Response, zodat het op elk platform
// met die standaard draait (Deno, Cloudflare Workers, Node 18+) en zonder platform te testen is.
import { requestAI, DEFAULT_MODEL } from '../src/ai.js';

export const LIMITS = { maxChars: 60000, perDay: 40 };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * @param deps.client       Anthropic-client met de sleutel van de eigenaar
 * @param deps.verifyMember async (token) => lid-id of null. Hier hoort de controle bij de betaaldienst.
 * @param deps.countUse     async (lidId, dag) => aantal analyses van dit lid vandaag, na ophogen
 */
export function createHandler({ client, verifyMember, countUse, model = DEFAULT_MODEL, now = () => new Date() }) {
  return async function handle(request) {
    if (request.method !== 'POST') return json(405, { error: 'Alleen POST is toegestaan.' });

    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const memberId = token ? await verifyMember(token) : null;
    if (!memberId) return json(401, { error: 'Deze lidcode is niet geldig of het lidmaatschap is verlopen.' });

    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'Het verzoek is geen geldige JSON.' }); }
    const a = body?.article;
    if (!a || typeof a.text !== 'string' || a.text.trim().length < 20) return json(400, { error: 'Er is geen artikeltekst meegestuurd.' });
    // Niet stilletjes afkappen: een half artikel beoordelen geeft een misleidend resultaat.
    if (a.text.length + String(a.title || '').length > LIMITS.maxChars) return json(413, { error: 'Dit artikel is te lang om te beoordelen.' });

    const used = await countUse(memberId, now().toISOString().slice(0, 10));
    if (used > LIMITS.perDay) return json(429, { error: 'Je hebt je daglimiet bereikt.' });

    try {
      const article = { title: String(a.title || ''), text: a.text, isOpinion: !!a.isOpinion, isSelection: !!a.isSelection, paywalled: !!a.paywalled };
      return json(200, await requestAI(client, article, { model }));
    } catch (e) {
      if (e.code === 'refusal' || e.code === 'truncated' || e.code === 'invalid') return json(422, { error: e.message });
      // Details van de fout blijven op de server; de sleutel en het account van de eigenaar gaan de gebruiker niet aan.
      console.error('AI-aanroep mislukt:', e?.status, e?.message);
      return json(502, { error: 'De beoordeling is mislukt. Probeer het later opnieuw.' });
    }
  };
}
