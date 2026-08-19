/* techniek-buurt.js — verdieping voor de buurt-ring. Andere data-
   items, andere toegang dan thuis. Skill-matching en lokale
   ontdekking zijn de specifieke elementen hier. */
window.ONDERLING_PAGE = {
  key: "buurt",
  title: "Buurt, technisch gezien",
  blocks: [
    { type: "backlink", href: "buurt.html", label: "Buurt" },

    {
      type: "hero",
      heading: "Buurt, technisch gezien",
      lead:
        "Wat er in een buurt onder de motorkap zit. De fundamenten — " +
        "eigen ruimtes, ingangen, toegangsrechten — staan op " +
        "[techniek](techniek.html); deze pagina laat zien wat er " +
        "specifiek is voor mensen die elkaar minder goed kennen."
    },

    {
      type: "prose",
      heading: "De data-items",
      paragraphs: [
        "Een buurt is een andere situatie dan een huishouden, en " +
        "andere soorten gegevens spelen er. Niet veel — een handvol " +
        "vormen die je herkent van een prikbord, plus iets persoonlijks " +
        "dat over jou gaat:"
      ],
      list: [
        "**Vraag-items** — \"wie kan zaterdag even helpen tillen?\", " +
        "\"oppas gezocht donderdagavond\". Iets waar je hulp bij " +
        "zoekt, met een tijd en een plek erbij.",
        "**Aanbod-items** — \"aanhanger te leen\", \"ik kan een " +
        "kast ophangen\". Iets dat je beschikbaar stelt, vrijblijvend " +
        "of voor een tegenprestatie.",
        "**Jouw profiel** — wat je laat zien aan de buurt: je voornaam, " +
        "globale plek, een paar vaardigheden waarmee je benaderd wilt " +
        "worden. Hoeveel daarvan zichtbaar is bepaal je zelf, en je " +
        "kunt per groep een ander beeld laten zien.",
        "**Korte uitwisselingen** — \"hoi, hoe en wanneer?\" om een " +
        "match tot een afspraak te maken. Niet een volwaardig " +
        "chatprogramma; net genoeg om door te gaan naar bellen of " +
        "fysiek afspreken."
      ]
    },

    {
      type: "prose",
      heading: "Wie ziet wat van wie",
      paragraphs: [
        "Toegang werkt hier anders dan thuis. Een huishouden is een " +
        "kleine circle met veel wederzijds vertrouwen; een buurt is een " +
        "ruimere circle waarin je per groep en soms per persoon kiest " +
        "wat je laat zien. Je profiel kan in je eigen straat meer " +
        "tonen dan in de wijk; je vraag-item kan voor een paar " +
        "buurtgenoten zichtbaar zijn en voor de rest niet.",
        "Wie wel hetzelfde aanvinkt — \"ik woon in deze buurt en wil " +
        "meedoen\" — kan elkaars vragen en aanbod zien. Maar dat is " +
        "geen platte ledenlijst die ergens centraal wordt bijgehouden. Het " +
        "is een lichte samenstelling van ruimtes die elkaar erkennen, " +
        "die ook weer afgebouwd kan worden als je het niet meer wil. " +
        "Je profiel blijft van jou; wat je deelt is een venster dat " +
        "open of dicht kan."
      ]
    },

    {
      type: "prose",
      heading: "Vragen en aanbod aan elkaar koppelen",
      paragraphs: [
        "Vraag en aanbod komen bij elkaar op basis van " +
        "wat mensen kenbaar maken dat ze kunnen of zoeken. Die " +
        "vaardigheden — \"ik kan helpen met een kast ophangen\", \"ik " +
        "zoek iemand die zonnepanelen kan controleren\" — staan niet " +
        "in een centrale database, ze worden door je eigen ruimte " +
        "uitgezonden als signaal naar wie je wil dat het ziet. Een " +
        "match ontstaat doordat ruimtes elkaar herkennen, niet doordat " +
        "een matchmaker tussenin alles weet.",
        "Dat klinkt klein maar is een belangrijk onderscheid met " +
        "platforms zoals Marktplaats of Nextdoor. Daar staat alle " +
        "informatie centraal; hier staat ze bij jou, en wat de buurt " +
        "ziet is wat jij laat zien. Onderling helpt je elkaar te " +
        "vinden zonder zelf alles bij te houden."
      ]
    },

    {
      type: "prose",
      heading: "Lokaal werkt het ook",
      paragraphs: [
        "Net als thuis hoeft er geen aanbieder ergens in de cloud te " +
        "zijn om dit te laten werken. Twee toestellen in elkaars buurt " +
        "kunnen elkaar direct vinden — via het lokale netwerk als ze " +
        "op dezelfde wifi zitten, of via een korte radioverbinding " +
        "(Bluetooth) als ze fysiek dichtbij elkaar zijn. Op een buurt-" +
        "barbecue kunnen mensen met de app elkaars vrijgegeven " +
        "profielen zien zonder dat er aan internet gedacht is.",
        "Wie verderop in de buurt zit en niet toevallig op hetzelfde " +
        "wifi-netwerk, bereik je via een doorgeefluik — een " +
        "hulpserver die berichten doorgeeft maar zelf niets onthoudt " +
        "of leest. De praktische optimalisatie (welke route is " +
        "snelst?) loopt automatisch; voor jou voelt het in beide " +
        "gevallen hetzelfde."
      ]
    },

    {
      type: "prose",
      heading: "Wat hier juist niet gebeurt",
      paragraphs: [
        "Drie dingen die op gangbare buurt-platforms wel gebeuren, en " +
        "hier expliciet niet:"
      ],
      list: [
        "**Geen algoritmische feed.** Vragen en aanbod staan op een " +
        "prikbord, niet in een stroom die door iets gerangschikt wordt " +
        "om je betrokkenheid te maximaliseren.",
        "**Geen advertenties of derde partijen die meelezen.** Er is " +
        "geen platform-eigenaar die met jouw gegevens iets anders " +
        "doet dan ze beschikbaar maken voor wie jij toestaat.",
        "**Geen reputatie-systeem met sterren.** Een match is een " +
        "begin van contact; wat er daarna gebeurt regel je zelf. Een " +
        "kort bedankje achteraf kan, zichtbaar voor je eigen circle; " +
        "geen ranglijst die van burenhulp een transactie maakt."
      ]
    },

    {
      type: "prose",
      heading: "De rol van slimme hulp",
      paragraphs: [
        "Een taalmodel kan ook in de buurt-context helpen. Niet om " +
        "matches te maken — dat deel gebeurt zonder taalmodel — maar om een " +
        "vraag of aanbod beter te formuleren, of om eerste " +
        "berichtjes tussen wildvreemden minder houterig te laten " +
        "verlopen. Net als thuis is dat optioneel; je profiel en je " +
        "vragen kunnen ook gewoon door jou zelf getypt worden, en de " +
        "rest werkt onveranderd."
      ]
    },

    {
      type: "note",
      variant: "info",
      text:
        "Wat hier staat is hoe het bedoeld is. De buurt-toepassing is " +
        "in uitwerking; veel hangt af van een lokale partner ter " +
        "plekke. Zie [stand van zaken](stand-van-zaken.html) voor wat " +
        "al loopt en wat nog niet."
    }
  ]
};
