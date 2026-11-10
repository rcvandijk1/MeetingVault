# Kantlijn: bouwspecificatie

Versie 1.0. Gegenereerd uit de werkende code in deze repository; de bijlagen komen rechtstreeks uit de broncode. Bijwerken: `npm run spec`.

---

## 0. Instructie aan de bouwer

Je bouwt een Chrome-extensie met een bijbehorende server. Deze specificatie beschrijft een versie die al gebouwd en getest is. Volg haar letterlijk.

- Waar iets niet is gespecificeerd: vraag het, verzin het niet.
- Verzin geen namen, parameters of eindpunten van externe API's. Gebruik de officiële SDK van Anthropic (`@anthropic-ai/sdk`) en de vormen in hoofdstuk 14. Je kennis van die API kan verouderd zijn.
- Bouw in de volgorde van hoofdstuk 19. Lever na elke fase werkende code en laat de acceptatiecriteria van die fase zien.
- Alle tekst die de gebruiker ziet is Nederlands. Code, bestandsnamen en commentaar mogen Engels of Nederlands zijn, maar wees consequent.
- Geen frameworks, geen build-stap voor de extensie zelf. Gewone ES-modules, gewone DOM. De enige uitzondering is de gebundelde SDK in `vendor/`.
- Zet nooit `innerHTML` met tekst uit een artikel, feed, model of sponsorbestand. Bouw de DOM met `textContent`.

---

## 1. Doel en doelgroep

**Doel.** Lezers helpen zien hoe een nieuwsartikel hen probeert te sturen, en of andere media hetzelfde nieuws brengen. Het product leert kritisch lezen; het vertelt de lezer niet wat waar is.

**Doelgroep.** Generatie X (ongeveer 45 tot 60 jaar) en jongeren (ongeveer 14 tot 25 jaar) in Nederland en Vlaanderen, zonder journalistieke achtergrond. Schrijf alle teksten in gewone taal, zonder jargon.

**Werknaam.** Kantlijn.

**Wat de gebruiker kan:**

1. Op een herkende nieuwssite ziet het icoon dat de site is herkend (`nws`) of dat de pagina een artikel is (`art`).
2. In het zijpaneel een artikel laten analyseren op drie manieren: het geopende artikel, een artikel aanklikken op een overzichtspagina zonder het te openen, of een stuk geselecteerde tekst.
3. Per gevonden beïnvloedingstechniek de letterlijke passage zien, gemarkeerd, met uitleg.
4. Zien hoeveel media links van het midden, in het midden en rechts van het midden hetzelfde nieuws in hun recente feed hebben, en van hoeveel eigenaren die media zijn.

---

## 2. Uitgangspunten die nergens mogen worden losgelaten

1. **Geen feitencontrole.** Het product zegt nooit dat iets waar of onwaar is. Het beoordeelt hoe een tekst stuurt.
2. **Elke vondst heeft een letterlijk citaat.** Een vondst zonder citaat dat letterlijk in het artikel staat, wordt niet getoond. Het aantal weggelaten vondsten wordt wel gemeld.
3. **Onzekerheid hoort zichtbaar te zijn.** Het paneel zegt welke analyse is gebruikt (AI-model of woordpatronen), dat een AI-model zich kan vergissen, en dat de links-rechtsindeling indicatief is.
4. **Citaten van anderen zijn geen keuze van de redactie.** Een geladen woord in een citaat telt minder zwaar en wordt gemarkeerd als "in een citaat".
5. **Privacy.** Zonder lidmaatschap en zonder eigen sleutel verlaat geen artikeltekst de browser. Met AI-analyse gaat alleen de tekst van het gekozen artikel weg, en het paneel zegt waarheen.
6. **Geen tracking.** Geen analytics, geen externe scripts, geen cookies van derden. Ook niet bij sponsorberichten.

---

## 3. Architectuur

```
Nieuwspagina (bijv. nos.nl)
  └─ content/page.js ──────── leest artikel, laat artikel aanwijzen
          │  chrome.runtime-berichten
          ▼
background.js ─────────────── icoon en badge, opent zijpaneel
          │
panel/panel.html + panel.js ── zijpaneel: knoppen, resultaat, vergelijking, sponsorbericht
   ├─ src/analyze.js ───────── basisanalyse op woordpatronen (lokaal)
   ├─ src/ai.js ────────────── instructie, schema, aanroep model, citaten terugzoeken
   │     ├─ eigen sleutel ──── rechtstreeks naar api.anthropic.com (via vendor/anthropic-sdk.js)
   │     └─ lid ───────────── via eigen server (src/membership.js → server/)
   ├─ src/feeds.js ─────────── RSS/Atom ophalen en ontleden, cache
   └─ src/match.js ─────────── zelfde nieuws zoeken, tellen per kant en eigenaar
options/ ───────────────────── sleutel, model, lidcode, eigen indeling, feeds controleren
server/ ────────────────────── controleert lidcode en daglimiet, roept model aan met sleutel van de eigenaar
```

**Volgorde bij een analyse:**

1. Lid (lidcode aanwezig én server ingesteld) → server.
2. Anders eigen API-sleutel aanwezig → rechtstreeks naar de API.
3. Anders, of als stap 1 of 2 faalt → basisanalyse, met een melding waarom.

De mediavergelijking start tegelijk met de analyse en wacht daar niet op.

---

## 4. Bestandsstructuur

```
manifest.json
background.js
config.js                     serverUrl en joinUrl
content/page.js               klassiek script (geen module)
panel/panel.html, panel.css, panel.js, ai-client.js
options/options.html, options.js
src/text.js                   tokeniseren, zinnen, citaten (geen browser-API's)
src/techniques.js             technieken en taalpatronen
src/analyze.js                basisanalyse
src/ai.js                     AI-analyse (krijgt een client mee, kent de SDK niet)
src/feeds.js                  feeds
src/match.js                  vergelijking
src/outlets.js                titels opzoeken, eigen indeling toepassen
src/membership.js             lidcode, sponsorkeuze, serveraanroep
data/outlets.json             medialijst (bijlage A)
data/sponsors.json            sponsorberichten
vendor/anthropic-sdk.js       gebundelde SDK (esbuild, ESM, browser)
server/handler.js             serverlogica op standaard Request/Response
server/deno-entry.ts          startpunt voor Deno / base44
icons/icon16.png, icon48.png, icon128.png
scripts/sync-manifest.mjs     zet domeinen uit outlets.json in manifest.json
scripts/check-feeds.mjs       controleert de echte feeds
tests/*.test.js, tests/e2e.mjs
```

`src/` en `data/` gebruiken geen Chrome-API's, zodat ze in Node getest en later hergebruikt kunnen worden. Uitzondering: `src/membership.js` leest `chrome.storage`.

---

## 5. Manifest en toestemmingen

- `manifest_version: 3`, `minimum_chrome_version: "116"`.
- `permissions`: `sidePanel`, `storage`, `scripting`, `activeTab`.
- `host_permissions`: `*://*.<domein>/*` voor elk domein in de medialijst, plus `https://api.anthropic.com/*`, plus de origin van `serverUrl` als die is ingevuld.
- `content_scripts`: `content/page.js` op dezelfde nieuwsdomeinen (niet op de API of server), `run_at: document_idle`.
- `background.service_worker: background.js`, `type: module`.
- `side_panel.default_path: panel/panel.html`.
- `options_ui.page: options/options.html`, `open_in_tab: true`.
- Geen `default_popup`: een klik op het icoon opent het zijpaneel.

Het script `scripts/sync-manifest.mjs` vult `host_permissions` en `content_scripts[0].matches` uit de medialijst en `config.js`. Met `--check` faalt het als het manifest achterloopt; dat hoort in `npm test`.

Extensiepagina's met host-toestemming hebben geen CORS-kop nodig van de feeds, de API of de server.

---

## 6. Content script (`content/page.js`)

Klassiek script in een IIFE, met een vlag op `window` zodat dubbel injecteren niets doet.

### 6.1 Artikel uitlezen: `extract(document, url)`

Geeft terug: `{ url, title, text, words, date, isArticle, isOpinion, paywalled }`.

1. **JSON-LD.** Lees alle `script[type="application/ld+json"]`, doorloop arrays en `@graph`. Neem het eerste object waarvan een `@type` past bij `/^(News|Reportage|Opinion|Analysis|Background|Review|Satirical)?(NewsArticle|Article)$|^(BlogPosting|LiveBlogPosting)$/`. Kapotte JSON negeren.
2. **Titel:** `headline` uit JSON-LD, anders `og:title`, anders `twitter:title`, anders eerste `h1`, anders `document.title`.
3. **Tekst uit de pagina.** Kandidaten: `[itemprop="articleBody"]`, `article`, `main`, `[role="main"]`, en elementen met `article-body`, `article__body` of `articleBody` in de class. Per kandidaat: alle `p, blockquote, h2, h3, li`, behalve binnen:
   `nav, aside, footer, header, form, figure, figcaption, script, style, noscript, [aria-hidden="true"]` en elementen met `related`, `newsletter`, `cookie`, `consent`, `paywall`, `comment` of `reactie` in de class.
   Sla een `blockquote` met een `p` erin over (de `p` telt al). Sla een `li` over die alleen uit één link bestaat. Houd tekst van minstens 40 tekens (bij `h2`/`h3` minstens 8). Neem de kandidaat met de meeste tekst. Is dat minder dan 400 tekens, probeer dan `document.body`.
4. **Tekst uit JSON-LD.** Is `articleBody` langer dan de tekst uit de pagina, gebruik die.
5. **Datum:** `datePublished`, anders `article:published_time`, `date` of `pubdate`. Als milliseconden, of `null`.
6. **isArticle:** (JSON-LD gevonden of `og:type` is `article`) én minstens 80 woorden.
7. **isOpinion:** een `@type` met `Opinion`, of een pad dat past bij `/\/(opinie|opinies|columns?|columnisten|commentaar|ingezonden|lezersbrieven|blogs?|standpunt|essay)(\/|$)/i`, of een `articleSection`/`article:section` met `opinie`, `column` of `commentaar`.
8. **paywalled:** `isAccessibleForFree` is `false` of de tekst `"false"`/`"False"`.

Witruimte wordt overal samengevoegd tot één spatie; alinea's worden met `\n` aan elkaar gezet.

### 6.2 Artikel aanwijzen op een overzichtspagina

Gestart door bericht `kl:startSelect`.

- Toon een balk **onderaan** het scherm (`position: fixed; bottom: 0`, `pointer-events: none`, hoogste z-index, `role="status"`) met: "Kantlijn: klik op een artikel om het te analyseren. Druk op Esc om te stoppen." Bovenaan dekt hij koppen af; dat is een getest probleem.
- Bij muisbeweging: zoek de dichtstbijzijnde `a[href]`. Telt als artikellink als: `http(s)`, zelfde origin, ander pad dan de huidige pagina, en (linktekst van minstens 20 tekens of pad van minstens 25 tekens). Linktekst: tekst, anders `aria-label`, anders `alt` van een afbeelding. Markeer met `outline: 3px solid #e76f51` en zet de oude outline terug bij verlaten.
- Bij klik op een artikellink (in de capture-fase): `preventDefault`, `stopImmediatePropagation`, stop de kiesmodus, stuur `kl:selecting {state:'loading', label}`, haal de pagina op met `fetch(url, {credentials:'include'})`, ontleed met `DOMParser`, roep `extract` aan, en stuur `kl:selected {article}`. Bij een fout: `kl:selecting {state:'error', url, error}`.
- Klik op iets anders dan een artikellink: niets doen, kiesmodus blijft aan.
- Esc: stoppen en `kl:selecting {state:'cancelled'}`.

### 6.3 Berichten

| Bericht naar content script | Antwoord |
| --- | --- |
| `kl:extract` | resultaat van `extract(document, location.href)` |
| `kl:selection` | `{url, title: document.title, text: selectie, words, date:null, isArticle:false, isOpinion:false, paywalled:false, isSelection:true}` |
| `kl:startSelect` / `kl:stopSelect` | `{ok:true}` |

| Bericht van content script | Betekenis |
| --- | --- |
| `kl:page {isArticle}` | bij laden, voor de badge |
| `kl:selecting {state, label?, error?}` | voortgang van het aanwijzen |
| `kl:selected {article}` | gekozen artikel, klaar om te analyseren |

---

## 7. Achtergrond (`background.js`)

- Bij `chrome.action.onClicked`: `chrome.sidePanel.open({windowId})`, daarna na 300 ms `kl:refresh {tabId}` naar het paneel. De klik geeft via `activeTab` tijdelijk toegang tot een niet-herkende pagina.
- Badge per tabblad, bijgewerkt bij `tabs.onUpdated` (status `loading` of nieuwe URL) en bij `kl:page`:
  - herkende titel en artikel: tekst `art`, kleur `#e76f51`;
  - herkende titel, geen artikel: tekst `nws`, kleur `#457b9d`;
  - anders: geen badge.
- Titel van het icoon: "Kantlijn: {naam} herkend[, artikel gevonden]. Klik om te analyseren." of "Kantlijn: klik om deze pagina te analyseren".
- Herkenning: hostnaam zonder `www.` is gelijk aan een domein uit de lijst of eindigt op `.{domein}`.

---

## 8. Zijpaneel

### 8.1 Opbouw van boven naar onder

1. Kop "Kantlijn" met rechts een link "Instellingen" (opent de instellingenpagina in een nieuw tabblad).
2. **Sitekaart**, drie toestanden:
   - *Herkend:* "Nieuwssite herkend", naam vet, een label met de indeling plus "(indicatief)" of "(jouw indeling)", en "Eigenaar: {eigenaar}. {onderbouwing}".
   - *Onbekend maar toegankelijk:* "Onbekende site" en "{host} staat niet in de lijst met nieuwstitels. Je kunt de pagina wel analyseren, maar zonder indeling van de bron."
   - *Geen toegang:* "Geen toegang tot deze pagina" en "Kantlijn leest alleen mee op herkende nieuwssites. Wil je deze pagina analyseren, klik dan op het Kantlijn-icoon in de werkbalk terwijl de pagina open staat." De knoppen zijn dan verborgen.
   Toegang wordt bepaald door `chrome.scripting.executeScript` met `content/page.js` te proberen.
3. **Knoppen:** "Analyseer dit artikel" (primair), "Kies een artikel op de pagina", "Analyseer geselecteerde tekst".
4. **Statusregel** (`role="status"`), met een rode rand bij fouten.
5. **Sponsorbericht** (hoofdstuk 12), alleen voor niet-leden.
6. **Resultaat:**
   - Bron · eventueel "geselecteerde tekst" · datum (`nl-NL`, bijv. "10 november 2026").
   - Titel van het artikel.
   - Band: een omrand label `LAAG`, `MIDDEL`, `HOOG` of `ONBEPAALD`, met ernaast de samenvatting.
   - Regel over de analyse: "Beoordeeld door {model}. Dit is het oordeel van een AI-model: het kan zich vergissen. Elk citaat is teruggezocht in het artikel." of "Basisanalyse op woordpatronen, zonder AI."
   - Kanttekeningen als lijst.
   - **Gevonden technieken:** per techniek een uitklapblok (de eerste twee open). Kop: naam, rechts "{n}×[, {k} in kop][, {c} in citaat]". Inhoud: de uitleg van de techniek, dan per voorbeeld een citaatblok met de treffer gemarkeerd en eventueel "in de kop" of "in een citaat", en bij AI-analyse eronder de uitleg van het model. Zinnen langer dan 260 tekens worden rond de treffer ingekort met "…".
   - Geen vondsten: bij AI "Het model vond geen beïnvloedingstechnieken in deze tekst. Dat zegt niets over of de inhoud klopt.", bij basisanalyse "Geen van de bekende taalpatronen gevonden. Dat betekent niet dat het artikel klopt of volledig is: weglaten en selectief citeren zijn zo niet te zien."
   - **Wat ontbreekt volgens het model:** alleen bij AI-analyse en als de lijst niet leeg is.
   - **Wie brengt dit nieuws ook?** (hoofdstuk 10.4).
7. **Voettekst:** "Kantlijn controleert geen feiten. Het laat zien hoe een tekst je stuurt, niet of de inhoud waar is. Lees de citaten en oordeel zelf." en een privacyzin die afhangt van de toestand:
   - lid: "De tekst van een artikel dat je laat analyseren gaat naar de server van Kantlijn en van daar naar de API van Anthropic. Voor de vergelijking haalt Kantlijn alleen de openbare nieuwsfeeds op."
   - eigen sleutel: "De tekst van een artikel dat je laat analyseren gaat naar de API van Anthropic, via je eigen sleutel. Je leesgedrag verder niet. Voor de vergelijking haalt Kantlijn alleen de openbare nieuwsfeeds op."
   - geen van beide: "Zonder API-sleutel gaat er geen artikeltekst naar een server. Voor de vergelijking haalt Kantlijn alleen de openbare nieuwsfeeds op."

### 8.2 Gedrag

- Elke analyse krijgt een volgnummer. Een antwoord dat binnenkomt nadat een nieuwe analyse is gestart, wordt genegeerd.
- Wisselt het actieve tabblad of laadt de pagina opnieuw, dan verdwijnen resultaat en sponsorbericht, behalve direct na een artikel dat via "Kies een artikel" is gekozen (dat heeft een ander adres dan de overzichtspagina).
- Is de artikeltekst leeg of korter dan 5 woorden: "Op deze pagina is geen artikeltekst gevonden. Open een artikel of kies er een op de pagina." Bij een lege selectie: "Selecteer eerst een stuk tekst op de pagina."
- Na "Kies een artikel": status "Klik nu op een artikel in de pagina. Druk daar op Esc om te stoppen.", tijdens ophalen "Artikel ophalen: {label}", bij fout "Het artikel kon niet worden opgehaald ({fout}). Open het artikel en kies "Analyseer dit artikel"." Heeft het gekozen artikel minder dan 120 woorden, behandel het als `paywalled`.
- Tijdens AI-analyse: status "Het AI-model leest het artikel. Dit duurt meestal 10 tot 30 seconden."
- Antwoordt de pagina niet: "De pagina gaf geen antwoord ({fout}). Herlaad de pagina en probeer het opnieuw."
- Wijzigt de gebruiker de indeling in de instellingen, dan werkt het paneel die direct bij (`storage.onChanged`).
- Testhaak: met `?tabId=<n>` in de URL van het paneel gebruikt het dat tabblad in plaats van het actieve.

---

## 9. Analyse

### 9.1 AI-analyse (`src/ai.js`)

**Invoer:** `{title, text, isOpinion, isSelection, paywalled}`.

**Gebruikersbericht** aan het model:

```
[Genre: waarschijnlijk een opiniestuk of column.]              ← alleen als isOpinion
[Dit is een door de lezer geselecteerd fragment, niet het hele artikel.]   ← alleen als isSelection
[Het artikel staat achter een betaalmuur; de tekst kan onvolledig zijn.]    ← alleen als paywalled

<artikel>
<kop>{titel}</kop>
<tekst>
{tekst}
</tekst>
</artikel>
```

**Systeeminstructie:** letterlijk bijlage C. **Antwoordschema:** letterlijk bijlage D.

**Antwoord verwerken:**

1. `stop_reason` is `refusal` → fout met code `refusal`: "Het AI-model wilde dit artikel niet beoordelen."
2. `stop_reason` is `max_tokens` → fout `truncated`: "Het antwoord van het AI-model was te lang en is afgebroken."
3. Het eerste blok van type `text` als JSON lezen; lukt dat niet → fout `invalid`: "Het AI-model gaf een onleesbaar antwoord." (Er kunnen eerst blokken van type `thinking` komen; negeer die.)
4. **Citaten terugzoeken.** Normaliseer zowel artikel als citaat: alle witruimte wordt één spatie, `‘’‚\`´` wordt `'`, `“”„«»` wordt `"`, `–—` wordt `-`. Houd bij welke oorspronkelijke positie bij elk teken hoort. Zoek het citaat eerst in de tekst, dan in de kop. Korter dan 3 tekens of niet gevonden: de vondst vervalt. Een onbekende techniek: de vondst vervalt.
5. Groepeer per techniek. Een vondst telt als "in een citaat" als het model `in_quote: true` geeft of als de positie binnen een citaat valt (9.3). Toon de hele zin waarin het citaat begint; loopt het citaat over de zin heen, toon tot het einde van het citaat. Sorteer technieken op aantal, aflopend.
6. `band` buiten `laag|middel|hoog` wordt `onbepaald`. `missing`: lege regels weg, hooguit 4.
7. Kanttekeningen: "{n} vondst is / vondsten zijn weggelaten omdat het citaat niet letterlijk in het artikel stond." en bij een opiniestuk "Dit lijkt een opiniestuk of column. Daar is stellige taal gebruikelijk."

**Modellen** (keuze in de instellingen):

| Model-id | Label | Fallback |
| --- | --- | --- |
{{MODELS}}

### 9.2 Basisanalyse (`src/analyze.js`)

Werkt zonder netwerk en is de terugval bij elke fout.

1. Per techniek (bijlage B) één reguliere expressie: `(?<![\p{L}\p{N}])(?:patroon1|patroon2|…)(?![\p{L}\p{N}])` met vlaggen `giu`.
2. Extra techniek **typografie** (gewicht 1): woorden van 5 of meer hoofdletters die niet in bijlage E staan, en leestekens die passen bij `/[!?]*![!?]+|\?{2,}/`.
3. Zoek in kop en tekst. Score per treffer: gewicht × 2 als in de kop × 0,4 als in een citaat.
4. Per techniek hooguit 4 voorbeelden, hoogste score eerst, nooit twee keer dezelfde zin.
5. `dichtheid = totale score / max(woorden, 120) × 1000`.
6. Eigen stem = aantal technieken met minstens één treffer buiten citaten.
7. Band: `hoog` bij dichtheid ≥ {{HOOG_D}} en eigen stem ≥ {{HOOG_T}}; `middel` bij ≥ {{MIDDEL_D}} en ≥ {{MIDDEL_T}}; anders `laag`. Minder dan 120 woorden: `onbepaald`.
8. Samenvatting: "Geen taalsignalen van beïnvloeding gevonden." / "Weinig taalsignalen: …" / "Meerdere taalsignalen: …" / "Veel taalsignalen: …", gevolgd door "{n} signalen in {t} technieken, op {w} woorden." Bij `onbepaald`: "Te weinig tekst om iets over te zeggen."
9. Kanttekeningen: te kort ("De tekst is te kort ({w} woorden) voor een betrouwbaar beeld. Staat het artikel achter een betaalmuur?"), opiniestuk ("Dit lijkt een opiniestuk of column. Daar is stellige en geladen taal gebruikelijk en geen teken van misleiding."), signalen in citaten ("{n} signalen staan in een citaat en tellen minder zwaar: dat zijn de woorden van de geciteerde.").

### 9.3 Gedeelde teksthulpen (`src/text.js`)

**Zinnen:** splits op `/[^.!?…\n]+(?:[.!?…]+["”’')\]]*|\n+|$)/g`. Eindigt de vorige zin op een afkorting, plak het stuk eraan vast. Afkorting:

```
/(?:^|[\s(])(?:(?:\p{L}\.)+|(?:dr|mr|drs|ir|ing|prof|bv|nv|nr|ca|jl|resp|incl|excl|max|min|vs|blz|st)\.)$/iu
```

Zo blijft "Dat zei o.a. de minister." één zin, en worden "Iedereen weet dat. De rest volgt." twee zinnen.

**Citaten:** openingstekens `„ “ " ‘ '`, met bijbehorende sluittekens (`„`→`”“"`, `“`→`”"`, `"`→`"`, `‘`→`’`, `'`→`'’`). Een opener telt alleen als er geen letter of cijfer voor staat en geen spatie na. `'s`, `'t`, `'n` gevolgd door spatie of streepje zijn weglatingstekens, geen citaat. Een sluiter telt alleen zonder spatie ervoor en zonder letter of cijfer erna. Citaten korter dan 8 tekens tellen niet. Een open citaat vervalt na 600 tekens of een regeleinde.

**Tokens** (voor de vergelijking): kleine letters, accenten weg (NFD), splitsen op alles behalve `a-z0-9`. Getallen houden bij 2 of meer cijfers. Woorden korter dan 3 tekens en stopwoorden (bijlage F) weg. Grove stam: langer dan 6 en eindigt op `en` → laatste 2 weg; anders langer dan 5 en eindigt op `s` of `e` → laatste 1 weg.

---

## 10. Mediavergelijking

### 10.1 Medialijst

Bijlage A. Per titel: `id`, `name`, `country` (`NL`/`BE`), `domains`, `lean` (een van {{LEANS}}), `owner`, `basis` (onderbouwing van de indeling), `feeds`. De gebruiker kan per titel een eigen indeling kiezen; die staat in `chrome.storage.sync` als `leanOverrides: {id: lean}` en wordt in het paneel getoond als "(jouw indeling)".

### 10.2 Feeds ophalen (`src/feeds.js`)

- Per titel: probeer elke ingestelde feed (`credentials: 'omit'`, time-out 8 s). Lukt geen enkele, haal dan `https://www.{eerste domein}/` op en zoek `<link type="application/rss+xml|application/atom+xml" href>`; probeer die feed.
- Ontleden zonder `DOMParser` (moet ook in Node werken): `<item>` of `<entry>`; titel uit `title`; link uit Atom `<link rel="alternate" href>` (of zonder `rel`), anders RSS `<link>`, anders `guid`/`id` als dat een URL is; beschrijving uit `description|summary|content:encoded|content`, ontdaan van HTML, hooguit 600 tekens; datum uit `pubDate|published|updated|dc:date`. CDATA uitpakken, entiteiten (ook dubbel ge-escapete HTML) decoderen, `<script>` en `<style>` verwijderen. Alleen `http(s)`-links.
- Alle titels parallel. Cache in `chrome.storage.session` onder `feed:{id}`: 15 minuten bij succes; een mislukte poging wordt zo bewaard dat hij na 1 minuut opnieuw wordt geprobeerd.
- Voortgang zichtbaar als `<progress>`.

### 10.3 Zelfde nieuws herkennen (`src/match.js`)

1. **Vector** van een tekst: elk token uit de titel telt 2, elk token uit de eerste 60 woorden van de tekst of beschrijving telt 1.
2. **IDF** over alle feedberichten van alle titels: `n = 1 + aantal berichten`, `idf(t) = ln(1 + n / (1 + df(t)))`.
3. **Cosinus** tussen artikel en bericht met gewichten × idf, plus het aantal gedeelde tokens.
4. Per titel, de eigen titel van het artikel overgeslagen:
   - sla berichten over met dezelfde URL (host zonder `www.`, pad zonder slot-`/`);
   - sla berichten over als beide een datum hebben en die meer dan {{MAXDAYS}} dagen uit elkaar liggen;
   - vereist minstens {{MINSHARED}} gedeelde tokens; bij {{STRONG}} of meer een score van minstens {{MINSCORE}}, anders minstens {{MINSCORE15}};
   - houd het beste bericht.
5. **Vrijwel gelijke kop:** Jaccard-overlap van de tokens van beide koppen ≥ {{DUP}}.
6. **Kant:** `links` en `centrum-links` → links van het midden; `centrum` → midden; `centrum-rechts` en `rechts` → rechts van het midden.
7. Resultaat: `matched` (titel, kop, link, datum, score, vrijwel gelijk), `unmatched`, `failed` (met foutmelding), en een samenvatting met aantallen per kant, per eigenaar en vrijwel gelijke koppen.

### 10.4 Weergave

- "**{n} van de {m}** gecontroleerde titels heeft/hebben dit nieuws in zijn/hun recente feed." waarbij `m` = titels met een werkende feed, eigen titel niet meegeteld.
- Geen enkele feed bereikbaar: "Geen enkele nieuwsfeed was bereikbaar. Controleer je internetverbinding of bekijk de feeds bij "Instellingen"."
- Gestapelde balk in drie delen (alleen delen met aantal > 0), met `role="img"` en een `aria-label` met de drie aantallen. Daaronder een legenda met drie grote cijfers.
- Eigenaren: zijn het minder eigenaren dan titels: "Let op: die {n} titels zijn van {k} eigenaren: {eigenaar (aantal), …}. Titels van één uitgever delen vaak kopij." Anders "Eigenaren: …".
- Vrijwel gelijke koppen: "Bij {n} titel(s) is de kop vrijwel gelijk. Dat wijst op hetzelfde persbericht (ANP, Belga), niet op onafhankelijke bevestiging."
- Per kant een groep met per titel: naam, label met indeling, eventueel label "vrijwel gelijke kop", en de kop als link (`target="_blank" rel="noopener noreferrer"`).
- Uitklapbaar "Niet gevonden bij {n} titel(s)" met de namen en: "Een feed bevat alleen de nieuwste berichten. Niet gevonden betekent dus niet dat een titel er niet over heeft geschreven, en ouder nieuws valt er altijd buiten."
- Uitklapbaar "Niet te controleren: {n} titel(s)" met naam en fout.
- Afsluitend: "Veel media die hetzelfde melden maakt iets niet waar, en weinig media maakt het niet onwaar. Kijk vooral naar wie het níét brengt en hoe de koppen verschillen."

---

## 11. Instellingenpagina

Drie onderdelen.

**AI-analyse.**
- Uitleg: "Met een eigen API-sleutel van Anthropic beoordeelt een AI-model het artikel. Zonder sleutel krijg je alleen de basisanalyse op woordpatronen." en "De sleutel wordt alleen op dit apparaat bewaard. De tekst van elk artikel dat je laat analyseren gaat naar Anthropic, en je betaalt per analyse via je eigen account. Een sleutel maak je aan op console.anthropic.com."
- Wachtwoordveld voor de sleutel, keuzelijst met de modellen.
- "Bewaar en test sleutel": test met `client.models.retrieve(model)` (kost niets). Gelukt: bewaar `aiKey` en `aiModel` in `chrome.storage.local` (nooit `sync`), maak het veld leeg, toon "Bewaard (eindigt op {laatste 4})". Mislukt: niet bewaren, foutmelding uit 14.4.
- "Verwijder sleutel".

**Lidmaatschap.**
- "Leden zien geen sponsorberichten en krijgen de AI-analyse zonder eigen API-sleutel."
- Is `serverUrl` leeg: "Lidmaatschap is in deze versie nog niet beschikbaar: er is geen server ingesteld." en de bewaarknop uitgeschakeld.
- Wachtwoordveld "Lidcode", "Bewaar lidcode", "Verwijder lidcode". Opslag: `memberToken` in `chrome.storage.local`. De server controleert de code; de extensie niet.

**Indeling en feeds.**
- De disclaimer uit `outlets.json`.
- Tabel: titel, land, eigenaar, indeling (keuzelijst, standaard gemarkeerd met "(standaard)"), onderbouwing, feedstatus.
- "Controleer alle feeds": per titel "werkt, {n} berichten[ (via homepage)]" of "werkt niet: {fout}", en tot slot "{ok} van {totaal} feeds werken. Titels zonder werkende feed tellen niet mee in de vergelijking."
- "Zet indeling terug naar standaard".

---

## 12. Sponsorberichten (reclame)

**Wat het is.** Berichten die je zelf plaatst of verkoopt, uit `data/sponsors.json`:

```json
{ "sponsors": [ { "label": "Advertentie", "title": "…", "text": "…", "url": "https://…" } ] }
```

Alleen berichten met een `title` en een `https`-URL worden gebruikt.

**Wanneer.** Een niet-lid ziet vóór **elk** resultaat een sponsorbericht. Het resultaat is al opgebouwd maar verborgen. Pas na een klik op "Verder naar het resultaat" wordt het zichtbaar. Leden zien geen sponsorbericht.

**Vorm.** Een kaart met gestippelde rand, `aria-labelledby` op de titel. Inhoud: label (standaard "Advertentie"), titel, tekst, een link "Bekijk aanbieding" (`target="_blank" rel="noopener noreferrer sponsored"`) en de primaire knop "Verder naar het resultaat", die direct de focus krijgt. Berichten wisselen per vertoning.

**Lege lijst.** Dan toont de kaart "Kantlijn" / "Lees zonder reclame" / "Leden zien geen sponsorberichten en krijgen een beoordeling door een AI-model, zonder eigen API-sleutel." met een knop "Word lid" naar `joinUrl`. Is `joinUrl` leeg, dan geen knop.

**Wat niet mag.**
- Google AdSense of een ander advertentienetwerk in de extensie. Het beleid van AdSense verbiedt Google-advertenties via browserextensies. Dat geldt ook voor een paneel dat in de nieuwspagina wordt gezet.
- Externe scripts of afbeeldingen van een advertentieserver, tracking, cookies.
- Reclame in de nieuwspagina zelf, of reclame van de site verbergen of vervangen.

---

## 13. Lidmaatschap en server

### 13.1 Afspraak tussen extensie en server

```
POST {serverUrl}
Authorization: Bearer {lidcode}
Content-Type: application/json

{ "article": { "title": "…", "text": "…", "isOpinion": false, "isSelection": false, "paywalled": false } }
```

| Status | Inhoud | Betekenis |
| --- | --- | --- |
| 200 | `{"data": <antwoord volgens bijlage D>, "model": "<model-id>"}` | gelukt |
| 400 | `{"error": "…"}` | geen JSON, of tekst korter dan 20 tekens |
| 401 | `{"error": "Deze lidcode is niet geldig of het lidmaatschap is verlopen."}` | geen of ongeldige lidcode |
| 405 | `{"error": "Alleen POST is toegestaan."}` | |
| 413 | `{"error": "Dit artikel is te lang om te beoordelen."}` | titel + tekst > {{MAXCHARS}} tekens |
| 422 | `{"error": "<melding uit 9.1>"}` | model weigert, antwoord afgebroken of onleesbaar |
| 429 | `{"error": "Je hebt je daglimiet bereikt."}` | meer dan {{PERDAY}} analyses vandaag |
| 502 | `{"error": "De beoordeling is mislukt. Probeer het later opnieuw."}` | overige fout |

Alle antwoorden met `Cache-Control: no-store`. De server stuurt het **ruwe** antwoord van het model terug; de extensie zoekt de citaten zelf terug (9.1, stap 4). De extensie gebruikt een time-out van 120 s en `credentials: 'omit'`.

Foutmeldingen in het paneel: 401/403 "Je lidcode wordt niet geaccepteerd. Controleer hem bij "Instellingen".", 429 "Je hebt je daglimiet bereikt.", time-out "De server reageerde niet op tijd.", anders de `error` van de server. Steeds gevolgd door "Hieronder staat de basisanalyse op woordpatronen." en de basisanalyse.

### 13.2 Serverlogica (in deze volgorde)

1. Alleen `POST`.
2. Lidcode uit `Authorization: Bearer`. Controleer hem (`verifyMember`). Ongeldig: 401, en roep het model **niet** aan.
3. JSON lezen en `article.text` controleren.
4. Te lang: 413. Nooit stilletjes afkappen: een half artikel geeft een misleidend oordeel.
5. Teller voor (lid, datum in UTC) ophogen; boven de limiet 429.
6. Model aanroepen zoals in 9.1 en 14, met de sleutel van de eigenaar.
7. Fouten van de API loggen op de server, maar nooit details (sleutel, accountfouten) naar de gebruiker sturen.

Schrijf de logica tegen de standaard `Request`/`Response`, met de afhankelijkheden als parameters (`client`, `verifyMember`, `countUse`, `model`, `now`), zodat ze zonder platform te testen is.

### 13.3 Hosting op base44

- Een backend function op Deno. Zet `ANTHROPIC_API_KEY` als secret in het dashboard; nooit in de code, nooit in de extensie.
- Gebruik de SDK via `npm:@anthropic-ai/sdk`.
- **Te controleren voordat je bouwt:** de documentatie van base44 spreekt zichzelf tegen over welk abonnement backend functions nodig hebben (een pagina noemt het betaalde Builder-abonnement). Controleer ook het exacte adres van een function en de vorm van een function in hun actuele voorbeeld.
- De dagteller hoort in een database-tabel, niet in het geheugen: geheugen verdwijnt bij elke herstart.

### 13.4 Betaling en lidcodes — besluit nodig

De eigenaar moet kiezen. De server moet in elk geval **zelf** kunnen vaststellen of een lidcode geldig is; een controle die alleen in de extensie zit is door elke gebruiker te omzeilen en laat de API-sleutel van de eigenaar open.

**Aanbevolen:** betaling op de eigen server.
- Afrekenpagina via Stripe of Mollie (Mollie ondersteunt iDEAL en Bancontact).
- Na betaling (webhook van de betaaldienst): maak een lid aan met een willekeurige lidcode van minstens 128 bits, toon die op de bedankpagina en mail hem.
- Tabel `members`: `id`, `code_hash` (SHA-256 van de lidcode; de code zelf niet bewaren), `email`, `status` (`active`, `canceled`), `valid_until`.
- `verifyMember(code)`: hash berekenen, lid opzoeken, `status = active` en `valid_until` in de toekomst.
- Opzeggen of mislukte incasso via webhook: status bijwerken.

**Alternatief:** ExtensionPay. Werkt zonder eigen server voor de betaling, maar de openbare documentatie beschrijft geen manier waarop de eigen server kan nagaan of iemand betaald heeft. Gebruik het alleen als ExtensionPay dat bevestigt.

---

## 14. Claude API: de exacte aanroep

Gebruik de officiële SDK `@anthropic-ai/sdk`. Schrijf geen eigen HTTP-aanroep.

### 14.1 In de extensie

Bundel de SDK één keer naar een ES-module:

```
esbuild scripts/vendor-entry.mjs --bundle --format=esm --platform=browser --minify --legal-comments=inline --outfile=vendor/anthropic-sdk.js
```

met `scripts/vendor-entry.mjs`: `export { default } from '@anthropic-ai/sdk';`

```js
import Anthropic from '../vendor/anthropic-sdk.js';
const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120_000 });
```

`dangerouslyAllowBrowser` is hier verantwoord: het is de eigen sleutel van de gebruiker in de eigen browser. Gebruik dit nooit met de sleutel van de eigenaar.

### 14.2 Het verzoek

```js
const request = {
  model,                       // zie 9.1
  max_tokens: 16000,
  system: SYSTEM,              // bijlage C
  messages: [{ role: 'user', content: gebruikersbericht }],
  output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },   // bijlage D
};
if (fallback) {                // Opus 5.5 en Sonnet 5.5, niet Haiku 5.5
  request.betas = ['server-side-fallback-2026-07-01'];
  request.fallbacks = 'default';
}
const response = await client.beta.messages.create(request);
```

Stuur **niet** mee: `temperature`, `top_p`, `top_k`, `thinking` of een "assistant"-voorzet. Die geven bij deze modellen een fout. `fallbacks: 'default'` laat de API een geweigerd verzoek zelf opnieuw uitvoeren op een aanbevolen vervangend model.

### 14.3 Het antwoord

Controleer eerst `response.stop_reason` (9.1, stap 1 en 2), lees daarna het eerste blok met `type === 'text'`. `response.model` is het model dat het antwoord gaf; toon dat in het paneel.

### 14.4 Foutmeldingen voor de gebruiker

Gebruik de foutklassen van de SDK, nooit tekstvergelijking:

| Klasse | Melding |
| --- | --- |
| `AuthenticationError` | De API-sleutel wordt niet geaccepteerd. Controleer hem bij "Instellingen". |
| `PermissionDeniedError` | Deze API-sleutel heeft geen toegang tot het gekozen model. |
| `NotFoundError` | Het gekozen model is niet beschikbaar voor deze sleutel. |
| `RateLimitError` | Je hebt de limiet van je API-account bereikt. Probeer het over een minuut opnieuw. |
| `BadRequestError` | De API wees het verzoek af: {melding} |
| `APIConnectionError` | Geen verbinding met de API. Controleer je internetverbinding. |
| `APIError`, status ≥ 500 | De API heeft een storing. Probeer het later opnieuw. |
| `APIError`, overig | De API gaf een fout ({status}). |

---

## 15. Beveiliging en privacy

- De API-sleutel van de eigenaar staat alleen op de server, als secret.
- De sleutel en lidcode van de gebruiker staan in `chrome.storage.local`, nooit in `sync`, nooit in een content script of webpagina.
- Alle tekst uit artikelen, feeds, model en sponsorbestand via `textContent`. Links alleen als ze met `http://` of `https://` beginnen.
- Instructies die in een artikel staan, mag het model niet opvolgen; de systeeminstructie zegt dat en het artikel staat tussen `<artikel>`-tags.
- Geen externe scripts of stylesheets in de extensie.
- Feeds ophalen zonder cookies (`credentials: 'omit'`). Alleen bij het aanwijzen van een artikel op dezelfde site gaan cookies mee, zodat een abonnee zijn volledige artikel krijgt.

---

## 16. Vormgeving en toegankelijkheid

- Systeemlettertype, basis 15 px, regelhoogte 1,5. Kaarten met afgeronde hoeken (10 px) en een dunne rand.
- Kleurtokens op `:root`, met een donkere variant via `prefers-color-scheme: dark`:

| Token | Licht | Donker |
| --- | --- | --- |
{{COLORS}}

- Band-label: `laag` → `--low`, `middel` → `--mid`, `hoog` → `--high`, `onbepaald` → `--muted`. Kleur is nooit de enige drager: het woord staat erin.
- Zichtbare focus (`outline: 2px solid var(--accent)`). Statusregel en vergelijking met `aria-live`/`role="status"`. Uitklapblokken met `<details>`.
- Het paneel moet werken vanaf 320 px breed zonder horizontaal scrollen.
- Icoon: donkerblauw afgerond vierkant met een oranje verticale streep (de kantlijn) en drie witte regels.

---

## 17. Tests en acceptatiecriteria

Unittests met `node --test`, zonder browser. Een proefdraai in Chromium met Playwright: extensie laden, nagebootste pagina's op `www.nu.nl` (via `--host-resolver-rules` naar een lokale server), nagebootste feeds en nagebootste API.

**Analyse**
- [ ] Een zakelijk bericht (bijv. gemeenteraad stemt in met woningbouw, met cijfers en een citaat) krijgt band `laag`.
- [ ] Een sensationele tekst krijgt `hoog` en raakt alle negen technieken.
- [ ] Elke markering valt precies op de treffer (`zin.slice(start, eind) === treffer`).
- [ ] Een geladen woord in een citaat telt minder zwaar en wordt als citaat gemeld.
- [ ] "in totaal", "KNMI", "NAVO" geven geen treffer.
- [ ] Minder dan 120 woorden geeft `onbepaald`; een opiniestuk krijgt de kanttekening.

**AI**
- [ ] Het verzoek bevat model, schema, `effort: medium`, en bij Opus/Sonnet de fallback; bij Haiku geen fallback; nooit `temperature` of `thinking`.
- [ ] Een verzonnen citaat en een onbekende techniek vallen weg en worden geteld.
- [ ] Een citaat met andere aanhalingstekens of extra spaties wordt wel gevonden.
- [ ] Weigering, afgebroken antwoord en onleesbaar antwoord geven elk hun eigen melding, gevolgd door de basisanalyse.
- [ ] Een verkeerde sleutel (401) geeft de juiste melding en de basisanalyse.
- [ ] Het schema heeft overal `additionalProperties: false` en alle velden verplicht.

**Feeds en vergelijking**
- [ ] RSS met CDATA en entiteiten, en Atom met meerdere links, worden goed ontleed; `javascript:`-links vallen weg.
- [ ] Werkt de ingestelde feed niet, dan wordt de feed via de homepage gevonden.
- [ ] Binnen de cachetijd wordt niets opnieuw opgehaald.
- [ ] Een treinstaking wordt gevonden bij drie titels (één per kant), niet bij een titel met alleen ruis of een bericht van een maand oud; de eigen titel telt niet mee; de kopie van het persbericht wordt als vrijwel gelijk gemarkeerd; eigenaren worden geteld.
- [ ] Een ander onderwerp met één gedeeld woord ("staking") is geen match.
- [ ] De medialijst heeft unieke id's en domeinen, en elke feed valt binnen de eigen domeinen.

**Paneel en pagina**
- [ ] Badge `art` op een artikel, `nws` op een overzichtspagina.
- [ ] Menu en voettekst van de pagina komen niet in de analyse.
- [ ] Aanwijzen: hover geeft een rand, klik navigeert niet weg, het gekozen artikel wordt geanalyseerd.
- [ ] Geselecteerde tekst wordt als selectie gemarkeerd.
- [ ] Een eigen indeling in de instellingen verschijnt direct in het paneel.
- [ ] Een pagina zonder toegang toont de uitleg en verbergt de knoppen.

**Reclame en lidmaatschap**
- [ ] Een niet-lid ziet voor elk resultaat het sponsorbericht; het resultaat is pas zichtbaar na "Verder naar het resultaat".
- [ ] Een lid ziet geen sponsorbericht.
- [ ] Alleen sponsorberichten met titel en `https`-link; ze wisselen per vertoning.
- [ ] Server: zonder of met ongeldige lidcode 401 en geen modelaanroep; te lang 413; boven de limiet 429; een API-fout lekt geen sleutel of details.

---

## 18. Bekende beperkingen

Deze horen in de README en mogen niet worden weggepoetst.

- De links-rechtsindeling en de eigenaren zijn een inschatting, niet extern gevalideerd.
- De feed-URL's zijn niet tegen de echte sites getest.
- De drempels van de vergelijking en de gewichten van de basisanalyse zijn niet gekalibreerd op echte artikelen.
- Het oordeel van het AI-model is niet getoetst tegen door mensen beoordeelde artikelen en kan per keer verschillen.
- Een feed bevat alleen recent nieuws; voor ouder nieuws is de vergelijking onbruikbaar.
- Achter een betaalmuur wordt alleen het zichtbare deel geanalyseerd.
- Het verbergen van reclame is in de browser te omzeilen; de echte afscherming is dat de server zonder geldige lidcode niets doet.

---

## 19. Bouwvolgorde

1. **Kern zonder browser:** `src/text.js`, `src/techniques.js`, `src/analyze.js`, `src/outlets.js`, `data/outlets.json`, met unittests.
2. **Feeds en vergelijking:** `src/feeds.js`, `src/match.js`, met unittests op nagebootste feeds.
3. **Extensie:** manifest, sync-script, content script, achtergrond, zijpaneel met basisanalyse en vergelijking, instellingen voor de indeling. Proefdraai in Chromium.
4. **AI met eigen sleutel:** `src/ai.js`, gebundelde SDK, `panel/ai-client.js`, sleutel in de instellingen. Unittests met een nagebootste client, proefdraai met een nagebootste API.
5. **Reclame:** `data/sponsors.json`, sponsorkaart, `config.js`.
6. **Server:** `server/handler.js` met unittests, dan uitrollen op base44.
7. **Betaling:** na het besluit uit 13.4.
8. **Vóór publicatie:** feeds controleren (`npm run feeds`), indeling en eigenaren nalopen met bronnen, de AI-analyse toetsen op ongeveer 50 artikelen die door mensen zijn beoordeeld, privacyverklaring schrijven voor de Chrome Web Store.

---

## Bijlage A: medialijst

Disclaimer (tonen in de instellingen): {{DISCLAIMER}}

| id | Naam | Land | Domeinen | Indeling | Eigenaar | Feed | Onderbouwing |
| --- | --- | --- | --- | --- | --- | --- | --- |
{{OUTLETS}}

Een lege feed betekent: de extensie zoekt de feed via de homepage.

---

## Bijlage B: technieken en taalpatronen

De naam en uitleg worden zowel in de basisanalyse als in de instructie voor het model gebruikt. De patronen zijn stukken reguliere expressie (JavaScript, vlaggen `giu`); woordgrenzen worden eromheen gezet zoals in 9.2.

{{TECHNIQUES}}

---

## Bijlage C: systeeminstructie voor het model

Letterlijk overnemen. De lijst met technieken wordt opgebouwd uit bijlage B (id, naam, uitleg).

```text
{{SYSTEM}}
```

---

## Bijlage D: antwoordschema

```json
{{SCHEMA}}
```

---

## Bijlage E: afkortingen die geen typografische nadruk zijn

```
{{CAPS}}
```

---

## Bijlage F: stopwoorden voor de vergelijking

```
{{STOPWORDS}}
```
