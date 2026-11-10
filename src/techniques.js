// Beïnvloedingstechnieken en de taalpatronen waaraan ze lokaal herkend worden.
// Elk patroon is een stuk reguliere expressie; woordgrenzen worden in analyze.js toegevoegd.
// 'weight' bepaalt hoe zwaar een treffer meetelt in de band. De gewichten zijn een inschatting,
// niet empirisch gekalibreerd.

export const TECHNIQUES = [
  {
    id: 'geladen-taal',
    name: 'Emotioneel geladen woordkeus',
    why: 'Woorden die een oordeel of emotie meegeven sturen hoe je een feit beleeft, nog voordat je het zelf hebt gewogen.',
    weight: 1,
    patterns: [
      'schokkend\\w*', 'schandalig\\w*', 'schandaal', 'schande', 'verbijsterend\\w*', 'onthutsend\\w*',
      'ongehoord\\w*', 'ongekend\\w*', 'bizar\\w*', 'absurd\\w*', 'krankzinnig\\w*', 'waanzin\\w*',
      'hallucinant\\w*', 'wraakroepend\\w*', 'hemeltergend\\w*', 'stuitend\\w*', 'walgelijk\\w*',
      'blunder\\w*', 'fiasco', 'afgang', 'wanbeleid', 'puinhoop', 'chaos',
      'keihard\\w*', 'snoeihard\\w*', 'genadeloos', 'genadeloze', 'vernietigend\\w*', 'verwoestend\\w*',
      'woedend\\w*', 'ziedend\\w*', 'razend\\w*', 'furieus', 'furieuze',
      'haalt (?:keihard |snoeihard |fel )?uit naar', 'maakt gehakt van', 'fileert', 'sloopt', 'sloopte',
      'afgebrand', 'afgeserveerd', 'de grond in geboord', 'onder vuur',
      'leugen\\w*', 'bedrog', 'bedriegt', 'zwendel', 'hypocri\\w+', 'schaamteloos', 'schaamteloze',
      'gigantisch\\w*', 'kolossaal', 'kolossale', 'torenhoog', 'torenhoge', 'astronomisch\\w*',
    ],
  },
  {
    id: 'angstframing',
    name: 'Angst- en dreigingsframing',
    why: 'Wie bang is, denkt minder kritisch na en deelt sneller. Dreiging benadrukken zonder de kans of omvang te noemen vergroot het gevoel van gevaar.',
    weight: 1,
    patterns: [
      'angstaanjagend\\w*', 'alarmerend\\w*', 'schrikbarend\\w*', 'onheilspellend\\w*', 'beangstigend\\w*',
      'levensgevaarlijk\\w*', 'doodsangst\\w*', 'paniek', 'catastrof\\w+', 'apocalyp\\w+', 'doemscenario\\w*',
      'tikkende tijdbom', 'op de rand van (?:de afgrond|een ramp|de ineenstorting)', 'loopt (?:volledig |compleet )?uit de hand',
      'niet meer veilig', 'nergens meer veilig', 'overspoeld\\w*', 'overspoelen', 'tsunami van', 'vloedgolf van',
      'explosie van', 'explosieve (?:stijging|groei|toename)', 'dreigt te (?:ontploffen|escaleren|bezwijken)',
      'ineenstorting', 'voorgoed verloren', 'geen weg terug',
      'niemand is veilig', 'het ergste moet nog komen', 'nachtmerrie\\w*',
    ],
  },
  {
    id: 'absoluut',
    name: 'Absolute en generaliserende beweringen',
    why: 'Woorden als "altijd", "niemand" en "iedereen" laten geen ruimte voor uitzonderingen. De werkelijkheid is zelden zo zwart-wit.',
    weight: 0.6,
    patterns: [
      'altijd', 'nooit', 'iedereen', 'niemand', 'geen enkele?', 'nergens', 'overal',
      'allemaal', 'stuk voor stuk', 'zonder uitzondering', 'elke keer weer', 'telkens weer', 'voor de zoveelste keer',
      'compleet', 'volkomen', 'volstrekt', '(?<!in )totaal', 'absoluut', 'honderd procent', '100 procent', '100%',
    ],
  },
  {
    id: 'vage-bron',
    name: 'Anonieme of vage bronnen',
    why: 'Een bewering die je niet kunt herleiden tot een persoon of document kun je ook niet controleren. Soms is anonimiteit terecht, maar het vraagt extra vertrouwen.',
    weight: 1.2,
    patterns: [
      'naar verluidt', 'het gerucht gaat', 'geruchten', 'er wordt gezegd', 'er wordt gefluisterd', 'in de wandelgangen',
      'volgens (?:ingewijden|insiders|bronnen|anonieme bronnen|betrokkenen|kenners|critici|sommigen|velen|deskundigen|experts)',
      '(?:ingewijden|insiders|bronnen|kenners|critici|deskundigen|experts|wetenschappers|artsen) (?:zeggen|stellen|melden|waarschuwen|beweren|vrezen)',
      'bronnen rond', 'bronnen dicht bij', 'bronnen binnen', 'een bron (?:binnen|bij|rond|dicht bij)',
      'zou volgens', 'zo wordt gezegd', 'zo klinkt het', 'naar eigen zeggen', 'schijnt het', 'het schijnt dat',
      'uit onderzoek blijkt', 'onderzoek toont aan', 'studies tonen aan', 'het is bekend dat', 'zoals bekend',
      'veel mensen (?:zeggen|vinden|denken|vragen zich af)', 'steeds meer mensen',
    ],
  },
  {
    id: 'wij-zij',
    name: 'Wij-zij-denken en vijandbeelden',
    why: 'Een groep als één blok tegenover "ons" zetten maakt van een meningsverschil een conflict tussen kampen, en van mensen een etiket.',
    weight: 1.3,
    patterns: [
      'de elite', 'elites', 'het establishment', 'de gevestigde orde', 'het kartel', 'partijkartel', 'de grachtengordel',
      'de mainstream ?media', 'mainstream ?media', 'de msm', 'staatsomroep', 'staatsmedia', 'de systeemmedia', 'leugenpers',
      'de gewone (?:man|nederlander|vlaming|burger|mensen)', 'de hardwerkende (?:nederlander|vlaming|burger)', 'het gewone volk', 'het volk tegen',
      'gelukszoeker\\w*', 'asieltsunami', 'omvolking', 'massa-?immigratie', 'importcriminelen',
      'wappie\\w*', 'complotgekkie\\w*', 'aluhoedje\\w*', 'deugmens\\w*', 'deugers', 'gutmensch\\w*', 'wokies', 'woke-?(?:gekte|waanzin|maffia|terreur)',
      'klimaatdrammer\\w*', 'klimaatgekkie\\w*', 'klimaatontkenner\\w*', 'klimaathysteri\\w+',
      'extreemrechts tuig', 'links tuig', 'tuig', 'landverrader\\w*', 'volksverrader\\w*', 'nepparlement',
      'linkse kerk', 'linkse hobby\\w*', 'rechtse rakker\\w*', 'fascisten', 'nazi\\W?s', 'globalisten',
      'ze willen dat (?:je|wij|we)', 'wat ze je niet vertellen', 'wat (?:de media|ze) verzwijg\\w+', 'ze verzwijgen',
    ],
  },
  {
    id: 'urgentie',
    name: 'Urgentie, clickbait en oproepen',
    why: 'Haast en nieuwsgierigheid zijn bedoeld om je te laten klikken of delen voordat je hebt nagedacht.',
    weight: 1.3,
    patterns: [
      'je gelooft (?:nooit|niet)', 'dit moet je (?:weten|zien|lezen)', 'dit wil je niet missen', 'wat er toen gebeurde',
      'je raadt nooit', 'niemand zag (?:dit|het) aankomen', 'dit is waarom', 'dit is wat er', 'de reden zal je verbazen',
      'deel dit', 'deel massaal', 'word wakker', 'wakker worden', 'open je ogen', 'kijk nu', 'lees snel',
      'voordat het te laat is', 'voor het te laat is', 'het is vijf voor twaalf', 'nu of nooit', 'laatste kans',
      'wordt verwijderd', 'voordat (?:het|dit) (?:wordt )?verwijderd', 'mag je niet weten', 'ze willen niet dat je',
      'breaking', 'net binnen', 'onthuld', 'onthulling', 'de waarheid over', 'de echte reden', 'het echte verhaal',
    ],
  },
  {
    id: 'stelligheid',
    name: 'Mening gebracht als feit',
    why: 'Formuleringen als "het is duidelijk dat" presenteren een conclusie als vanzelfsprekend, zodat je niet meer vraagt waar ze op berust.',
    weight: 0.9,
    patterns: [
      'het is (?:overduidelijk|zonneklaar|glashelder|een feit) dat', 'het is duidelijk dat', 'feit is dat', 'het staat vast dat',
      'zonder (?:enige )?twijfel', 'ontegenzeggelijk', 'onmiskenbaar', 'overduidelijk', 'vanzelfsprekend', 'uiteraard', 'natuurlijk is',
      'iedereen weet dat', 'iedereen (?:begrijpt|ziet|snapt) dat', 'elk weldenkend mens', 'wie goed kijkt', 'laten we eerlijk zijn',
      'het ligt voor de hand dat', 'het kan niet anders dan dat', 'dat kan geen toeval zijn', 'zoals verwacht', 'zoals gebruikelijk',
      'de waarheid is dat', 'in werkelijkheid', 'zogenaamd\\w*', 'zogeheten', 'zelfbenoemd\\w*',
    ],
  },
  {
    id: 'suggestief',
    name: 'Suggestieve vragen en insinuaties',
    why: 'Een vraag kan een beschuldiging overbrengen zonder dat er bewijs voor hoeft te worden geleverd.',
    weight: 1.1,
    patterns: [
      'is het toeval dat', 'toeval\\?', 'toevallig\\?', 'hoe kan het dat', 'hoe is het mogelijk dat', 'wie gelooft (?:dit|dat) nog',
      'waarom zwijg\\w+', 'waarom horen we', 'waarom vertelt niemand', 'wat verzwijg\\w+', 'wat hebben ze te verbergen',
      'wie heeft hier belang bij', 'wie profiteert', 'je zou bijna denken', 'het lijkt er verdacht veel op',
      'vraagtekens bij', 'roept vragen op', 'doet de wenkbrauwen fronsen', 'opvallend genoeg', 'opmerkelijk genoeg',
    ],
  },
];

// Afkortingen die in hoofdletters horen en dus geen typografische nadruk zijn.
export const CAPS_ALLOW = new Set(`
NAVO NATO RIVM KNMI UWV ANWB ANP BELGA NPO VRT NOS RTL VTM KLM NMBS UEFA FIFA KNVB PSV FNV CNV VVD CDA PVV PVDA
SGP DENK JA21 BBB NSC NVA CD&V OPEN VLD PVDA-PTB VOORUIT GROEN COVID AIVD MIVD OVV SCP CPB CBS UNHCR UNICEF OPEC
ASML ABN AMRO ING HEMA NASA HTTPS HTML ICT BTW WOZ AOW GGD GGZ UMC UMCG LUMC WHO IMF ECB
`.split(/\s+/).filter(Boolean));
