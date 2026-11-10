# Kantlijn

Chrome-extensie die bij een nieuwsartikel laat zien welke beïnvloedingstechnieken in de tekst zitten, met het letterlijke citaat erbij, en welke Nederlandse en Vlaamse media hetzelfde nieuws brengen.

"Kantlijn" is een werknaam. De repository heet nog `MeetingVault`.

De volledige bouwspecificatie staat in [`docs/SPEC.md`](docs/SPEC.md). Na een wijziging in de code: `npm run spec`.

## Wat het doet

1. **Herkent nieuwssites.** Op de 32 titels in `data/outlets.json` toont het icoon `nws`, en `art` zodra de pagina een artikel is.
2. **Laat je een artikel kiezen.** In het zijpaneel: het geopende artikel analyseren, een artikel aanklikken op een overzichtspagina (zonder het te openen), of een geselecteerd stuk tekst analyseren.
3. **Laat een AI-model het artikel beoordelen.** Met je eigen API-sleutel van Anthropic wijst het model per techniek de passage aan en legt uit wat die met de lezer doet. Het noemt ook wat in het artikel ontbreekt. De band laag, middel of hoog vat het samen.
4. **Vergelijkt met andere media.** Hoeveel titels links van, in en rechts van het midden hetzelfde nieuws in hun feed hebben, van hoeveel eigenaren die titels zijn, en waar de kop vrijwel gelijk is (zelfde persbericht).

Zonder sleutel, of als de API een fout geeft, krijg je een basisanalyse die alleen vaste woordpatronen telt.

## AI-analyse en je sleutel

- Vul je sleutel in bij **Instellingen**. Hij wordt getest en alleen op dit apparaat bewaard (`chrome.storage.local`), niet gesynchroniseerd en niet zichtbaar voor webpagina's.
- De tekst van elk artikel dat je laat analyseren gaat naar de API van Anthropic. Er is geen tussenliggende server.
- Je betaalt per analyse via je eigen account. Het standaardmodel is Claude Opus 5.5; in de instellingen kun je Sonnet 5.5 of Haiku 5.5 kiezen, die goedkoper zijn.
- Elk citaat dat het model geeft wordt letterlijk teruggezocht in het artikel. Staat het er niet in, dan wordt de vondst niet getoond en zie je hoeveel er zijn weggelaten.
- Weigert het model een artikel, dan probeert de API het zelf opnieuw op een vervangend model (server-side fallback).
- Deze opzet is geschikt voor eigen gebruik en een kleine testgroep. Voor een breed publiek heb je een eigen server nodig, want je kunt van tieners niet verwachten dat ze een betaalde API-sleutel aanmaken.

## Installeren

1. Open `chrome://extensions` en zet rechtsboven **Ontwikkelaarsmodus** aan.
2. Kies **Uitgepakte extensie laden** en selecteer deze map.
3. Ga naar een nieuwssite en klik op het Kantlijn-icoon.

Vereist Chrome 116 of nieuwer. Werkt niet in Chrome op telefoons, want die ondersteunt geen extensies.

## Reclame en lidmaatschap

- **Niet-leden** klikken voor elk resultaat eerst een sponsorbericht weg. De berichten staan in `data/sponsors.json`. Is die lijst leeg, dan verschijnt een uitnodiging om lid te worden.
- **Leden** zien geen sponsorberichten en krijgen de AI-analyse via de eigen server, zonder eigen API-sleutel. Een lid vult zijn lidcode in bij **Instellingen**.
- Lidmaatschap staat uit zolang `serverUrl` in `config.js` leeg is. Vul daar het adres van de server in en draai `npm run sync`.

Wat nog niet af is:

- **Er is geen betaling.** `verifyMember` in `server/deno-entry.ts` geeft altijd "geen lid" terug. Daar hoort de controle bij de betaaldienst.
- **De server is niet uitgerold en niet op base44 getest.** `server/handler.js` is getest met nagebootste verzoeken; `server/deno-entry.ts` is een ongeteste aanzet.
- **Google-advertenties kunnen niet in de extensie.** Het beleid van AdSense verbiedt plaatsing via browserextensies, ook in een paneel dat in de pagina wordt gezet. Sponsorberichten zijn dus berichten die je zelf plaatst of verkoopt.
- **Het verbergen van reclame is in de browser te omzeilen.** De echte afscherming is de server: zonder geldige lidcode geen AI-analyse op jouw sleutel.

### Afspraak tussen extensie en server

`POST <serverUrl>` met kop `Authorization: Bearer <lidcode>` en als inhoud `{"article": {"title", "text", "isOpinion", "isSelection", "paywalled"}}`.
Antwoord `200` met `{"data": <antwoord van het model>, "model": "<model>"}`. Fouten: `401` ongeldige lidcode, `413` artikel te lang, `429` daglimiet, `422` model weigert, `502` overige fout. De extensie zoekt de citaten zelf terug in het artikel.

## Wat het niet kan

Lees dit voordat je conclusies trekt uit de uitkomsten.

- **De AI-analyse is niet tegen de echte API getest.** In de ontwikkelomgeving was geen sleutel beschikbaar. De aanroep is getest met een nagebootste API; of het verzoek door de echte API wordt geaccepteerd en hoe goed de beoordelingen zijn, is niet vastgesteld.
- **Het oordeel van het model is een oordeel.** Het is niet getoetst tegen artikelen die door mensen zijn beoordeeld, kan per keer verschillen en kan zelf een vooringenomenheid hebben. De instructie staat in `src/ai.js`.
- **Het controleert geen feiten.** Een artikel met band "laag" kan onwaar zijn, een artikel met band "hoog" kan kloppen.
- **De basisanalyse telt woorden en begrijpt niets.** Ironie, context, selectief citeren en weglaten ziet ze niet. De gewichten en drempels in `src/techniques.js` en `src/analyze.js` zijn een inschatting.
- **De links-rechtsindeling is indicatief.** Ze berust op zelfbeschrijving en gangbare typering van de titels, niet op een externe meting. Elke gebruiker kan de indeling aanpassen via **Instellingen**.
- **De eigenaren zijn niet nagelopen tegen een actuele bron.** Controleer `owner` in `data/outlets.json` voordat je de extensie publiceert.
- **De feed-URL's zijn niet tegen de echte sites getest.** De ontwikkelomgeving had geen toegang tot de nieuwssites. Draai `npm run feeds` op je eigen machine, of gebruik **Controleer alle feeds** in de instellingen. Werkt een feed niet, dan zoekt de extensie zelf een feed op de homepage; lukt dat ook niet, dan telt de titel niet mee en staat hij onder "Niet te controleren".
- **Een feed bevat alleen recent nieuws.** "Niet gevonden" betekent niet dat een titel er niet over schreef. Voor nieuws van meer dan een paar dagen oud is de vergelijking onbruikbaar.
- **Het herkennen van hetzelfde nieuws is niet gekalibreerd.** De drempels in `src/match.js` zijn getest op nagebootste feeds, niet op echte.
- **Betaalmuren.** Staat de tekst achter een betaalmuur, dan wordt alleen het zichtbare deel geanalyseerd.

## Opbouw

| Pad | Inhoud |
| --- | --- |
| `data/outlets.json` | Titels, domeinen, indeling met onderbouwing, eigenaar, feeds |
| `src/ai.js` | Instructie, antwoordschema en aanroep van het AI-model; zoekt citaten terug |
| `panel/ai-client.js` | Maakt de SDK-client met de sleutel van de gebruiker, vertaalt fouten |
| `vendor/anthropic-sdk.js` | Gebundelde Anthropic-SDK (`npm run vendor` bouwt hem opnieuw) |
| `src/techniques.js` | Technieken en taalpatronen |
| `src/analyze.js` | Basisanalyse: telt treffers, weegt citaten en kop, bepaalt de band |
| `src/feeds.js` | RSS/Atom ophalen en ontleden, feed zoeken via homepage |
| `src/match.js` | Zoekt dezelfde berichtgeving en telt per kant en per eigenaar |
| `content/page.js` | Leest het artikel uit de pagina, laat een artikel aanwijzen |
| `panel/` | Het zijpaneel |
| `options/` | Sleutel, model en lidcode instellen, indeling aanpassen, feeds controleren |
| `src/membership.js` | Lidcode, keuze van het sponsorbericht, aanroep van de eigen server |
| `server/` | Server voor leden: controleert lidcode en daglimiet, roept het model aan |
| `config.js` | Adres van de server en van de pagina om lid te worden |
| `data/sponsors.json` | Sponsorberichten voor niet-leden |
| `background.js` | Icoon bijwerken, zijpaneel openen |

De mappen `src/` en `data/` gebruiken geen Chrome-API's. Ze zijn herbruikbaar voor een latere mobiele app of webversie.

## Een titel toevoegen of een indeling wijzigen

1. Pas `data/outlets.json` aan. Geef bij `basis` aan waarop de indeling berust.
2. Draai `npm run sync`. Dat werkt de sitelijst in `manifest.json` bij.
3. Draai `npm test`.

## Testen

```
npm test            # analyse, AI-aanroep, feeds, vergelijking, medialijst
npm run test:e2e    # laadt de extensie in Chromium met nagebootste pagina's, feeds en API (vereist Playwright)
npm run feeds       # controleert de echte feeds vanaf je eigen machine
```

## Toestemmingen

- Toegang tot de sites in de medialijst: om artikelen te lezen en feeds op te halen.
- Toegang tot `api.anthropic.com`: voor de AI-analyse met je eigen sleutel.
- `activeTab` en `scripting`: om een andere pagina te analyseren nadat je zelf op het icoon klikt.
- `storage`: je sleutel, je eigen indeling en een tijdelijke kopie van de feeds (15 minuten).
- `sidePanel`: het zijpaneel.
