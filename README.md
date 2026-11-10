# Kantlijn

Chrome-extensie die bij een nieuwsartikel laat zien welke beïnvloedingstechnieken in de tekst zitten, met het letterlijke citaat erbij, en welke Nederlandse en Vlaamse media hetzelfde nieuws brengen.

"Kantlijn" is een werknaam. De repository heet nog `MeetingVault`.

## Wat het doet

1. **Herkent nieuwssites.** Op de 32 titels in `data/outlets.json` toont het icoon `nws`, en `art` zodra de pagina een artikel is.
2. **Laat je een artikel kiezen.** In het zijpaneel: het geopende artikel analyseren, een artikel aanklikken op een overzichtspagina (zonder het te openen), of een geselecteerd stuk tekst analyseren.
3. **Toont technieken met citaten.** Negen technieken, van geladen woordkeus tot anonieme bronnen. Per techniek staat waarom hij werkt en waar hij in de tekst voorkomt. De band laag, middel of hoog vat het samen.
4. **Vergelijkt met andere media.** Hoeveel titels links van, in en rechts van het midden hetzelfde nieuws in hun feed hebben, van hoeveel eigenaren die titels zijn, en waar de kop vrijwel gelijk is (zelfde persbericht).

Alles draait in de browser. Er gaat geen artikeltekst naar een server; alleen de openbare RSS-feeds van de titels worden opgehaald.

## Installeren

1. Open `chrome://extensions` en zet rechtsboven **Ontwikkelaarsmodus** aan.
2. Kies **Uitgepakte extensie laden** en selecteer deze map.
3. Ga naar een nieuwssite en klik op het Kantlijn-icoon.

Vereist Chrome 116 of nieuwer. Werkt niet in Chrome op telefoons, want die ondersteunt geen extensies.

## Wat het niet kan

Lees dit voordat je conclusies trekt uit de uitkomsten.

- **Het telt woorden, het begrijpt niets.** De analyse zoekt vaste taalpatronen. Ironie, context, selectief citeren, weglaten en misleidende cijfers ziet het niet. Een artikel met band "laag" kan onwaar zijn, een artikel met band "hoog" kan kloppen.
- **De band is niet gekalibreerd.** De gewichten en drempels in `src/techniques.js` en `src/analyze.js` zijn een inschatting. Ze zijn niet getoetst tegen een verzameling artikelen die door mensen is beoordeeld.
- **De links-rechtsindeling is indicatief.** Ze berust op zelfbeschrijving en gangbare typering van de titels, niet op een externe meting. Elke gebruiker kan de indeling aanpassen via **Indeling en feeds**.
- **De eigenaren zijn niet nagelopen tegen een actuele bron.** Controleer `owner` in `data/outlets.json` voordat je de extensie publiceert.
- **De feed-URL's zijn niet tegen de echte sites getest.** De ontwikkelomgeving had geen toegang tot de nieuwssites. Draai `npm run feeds` op je eigen machine, of gebruik **Controleer alle feeds** in de instellingen. Werkt een feed niet, dan zoekt de extensie zelf een feed op de homepage; lukt dat ook niet, dan telt de titel niet mee en staat hij onder "Niet te controleren".
- **Een feed bevat alleen recent nieuws.** "Niet gevonden" betekent niet dat een titel er niet over schreef. Voor nieuws van meer dan een paar dagen oud is de vergelijking onbruikbaar.
- **Het herkennen van hetzelfde nieuws is niet gekalibreerd.** De drempels in `src/match.js` zijn getest op nagebootste feeds, niet op echte.
- **Betaalmuren.** Staat de tekst achter een betaalmuur, dan wordt alleen het zichtbare deel geanalyseerd.

## Opbouw

| Pad | Inhoud |
| --- | --- |
| `data/outlets.json` | Titels, domeinen, indeling met onderbouwing, eigenaar, feeds |
| `src/techniques.js` | Technieken en taalpatronen |
| `src/analyze.js` | Telt treffers, weegt citaten en kop, bepaalt de band |
| `src/feeds.js` | RSS/Atom ophalen en ontleden, feed zoeken via homepage |
| `src/match.js` | Zoekt dezelfde berichtgeving en telt per kant en per eigenaar |
| `content/page.js` | Leest het artikel uit de pagina, laat een artikel aanwijzen |
| `panel/` | Het zijpaneel |
| `options/` | Indeling aanpassen en feeds controleren |
| `background.js` | Icoon bijwerken, zijpaneel openen |

De mappen `src/` en `data/` gebruiken geen Chrome-API's. Ze zijn herbruikbaar voor een latere mobiele app of webversie.

## Een titel toevoegen of een indeling wijzigen

1. Pas `data/outlets.json` aan. Geef bij `basis` aan waarop de indeling berust.
2. Draai `npm run sync`. Dat werkt de sitelijst in `manifest.json` bij.
3. Draai `npm test`.

## Testen

```
npm test            # analyse, feeds, vergelijking, medialijst
npm run test:e2e    # laadt de extensie in Chromium met nagebootste pagina's en feeds (vereist Playwright)
npm run feeds       # controleert de echte feeds vanaf je eigen machine
```

## Toestemmingen

- Toegang tot de sites in de medialijst: om artikelen te lezen en feeds op te halen.
- `activeTab` en `scripting`: om een andere pagina te analyseren nadat je zelf op het icoon klikt.
- `storage`: je eigen indeling en een tijdelijke kopie van de feeds (15 minuten).
- `sidePanel`: het zijpaneel.
