// Startpunt voor een Deno-omgeving (zoals de backend functions van base44). NIET GETEST op base44:
// de documentatie was tijdens het bouwen niet bereikbaar. Controleer de vorm tegen hun actuele voorbeeld.
// Zet ANTHROPIC_API_KEY als secret in het dashboard; zet hem nooit in de code.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createHandler } from './handler.js';

const uses = new Map<string, number>(); // Vervang door een database: geheugen verdwijnt bij elke herstart.

const handle = createHandler({
  client: new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') }),
  // TODO: controleer hier de lidcode bij de betaaldienst of in de ledentabel. Zolang dit null teruggeeft is niemand lid.
  verifyMember: async (_token: string) => null,
  countUse: async (memberId: string, day: string) => {
    const key = `${memberId}:${day}`;
    uses.set(key, (uses.get(key) || 0) + 1);
    return uses.get(key)!;
  },
});

Deno.serve(handle);
