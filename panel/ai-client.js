// Koppelt de extensie aan de Anthropic-SDK. De sleutel blijft in chrome.storage.local op dit apparaat
// en komt nooit in een webpagina terecht: alleen de pagina's van de extensie zelf lezen hem.
import Anthropic from '../vendor/anthropic-sdk.js';
import { DEFAULT_MODEL, MODELS } from '../src/ai.js';

export async function loadAiSettings() {
  const { aiKey = '', aiModel = DEFAULT_MODEL } = await chrome.storage.local.get(['aiKey', 'aiModel']);
  return { key: aiKey, model: MODELS.some((m) => m.id === aiModel) ? aiModel : DEFAULT_MODEL };
}

export function createClient(key) {
  // De gebruiker draait dit met zijn eigen sleutel in zijn eigen browser; er is geen server om de sleutel achter te verbergen.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120_000 });
}

/** Vertaalt een fout van de API naar een zin die de gebruiker verder helpt. */
export function explainError(e) {
  if (e?.code === 'refusal' || e?.code === 'truncated' || e?.code === 'invalid') return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'De API-sleutel wordt niet geaccepteerd. Controleer hem bij "Instellingen".';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Deze API-sleutel heeft geen toegang tot het gekozen model.';
  if (e instanceof Anthropic.NotFoundError) return 'Het gekozen model is niet beschikbaar voor deze sleutel.';
  if (e instanceof Anthropic.RateLimitError) return 'Je hebt de limiet van je API-account bereikt. Probeer het over een minuut opnieuw.';
  if (e instanceof Anthropic.BadRequestError) return `De API wees het verzoek af: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Geen verbinding met de API. Controleer je internetverbinding.';
  if (e instanceof Anthropic.APIError) return e.status >= 500 ? 'De API heeft een storing. Probeer het later opnieuw.' : `De API gaf een fout (${e.status}).`;
  return String(e?.message || e);
}
