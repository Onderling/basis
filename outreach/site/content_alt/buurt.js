/* buurt.js — sectie 2: Buurt. Volwaardig, eigen stem (niet de
   thuis-opbouw kopiëren). Prikbord-mockup i.p.v. chat als concrete
   vorm. Nu met data-items-model en FAQ onderaan. */
window.ONDERLING_PAGE = {
  key: "buurt",
  title: "Buurt",
  blocks: [
    {
      type: "hero",
      heading: "In de buurt: elkaar vinden zonder tussenpersoon",
      lead:
        "In een straat of wijk kan en zoekt iedereen van alles, maar " +
        "je weet zelden van elkaar wát. Hier breng je vraag en aanbod " +
        "rechtstreeks bij elkaar, en je houdt zelf in de hand wat de " +
        "buurt van je ziet."
    },

    {
      type: "prose",
      paragraphs: [
        "Hier is het bewust geen feed. Het lijkt meer op een prikbord " +
        "bij de buurtwinkel: je hangt er een vraag of een aanbod op, " +
        "en wie iets ziet dat past, reageert. Geen algoritme dat " +
        "bepaalt wat je te zien krijgt, geen bedrijf dat meeleest om " +
        "er advertenties tegenaan te plakken. Je profiel laat aan de " +
        "buurt alleen zien wat jij wilt; de rest staat in je eigen " +
        "ruimte, net als thuis.",
        "Wat het laat werken is wederkerigheid. Een prikbord met " +
        "alleen vragen wordt een klaagmuur; een prikbord met alleen " +
        "aanbod voelt als reclame. Het gaat om allebei door elkaar — " +
        "en dat een vraag van de buurman je vaak op het idee brengt " +
        "dat je zelf ook iets te bieden hebt."
      ]
    },

    {
      type: "mockup",
      kind: "prikbord",
      heading: "Zo ziet het prikbord eruit",
      title: "Prikbord · jouw buurt",
      items: [
        { tag: "Vraag",  text: "Wie kan helpen een kast ophangen?", hint: "200 m" },
        { tag: "Aanbod", text: "Aanhanger te leen in het weekend",  hint: "3 buren" },
        { tag: "Vraag",  text: "Oppas gezocht, donderdagavond" },
        { tag: "Lenen",  text: "Steeksleutelset — gewoon even langskomen" }
      ]
    },

    {
      type: "prose",
      paragraphs: [
        "Een match is een begin, geen eindpunt. Reageert er iemand, " +
        "dan stelt de assistent jullie aan elkaar voor en regelen " +
        "jullie het verder zelf — even bellen, of op de stoep. " +
        "Achteraf kan er een klein bedankje of een korte " +
        "terugkoppeling bij, zichtbaar voor je eigen circle. Geen " +
        "sterrensysteem: dat maakt van burenhulp een transactie, en " +
        "dat is precies niet de bedoeling."
      ]
    },

    {
      type: "prose",
      heading: "Wat jij laat zien, en aan wie",
      paragraphs: [
        "Je profiel is geen ledenpagina op een platform — het is " +
        "een venster dat jij opendoet naar wie je wilt. In je eigen " +
        "straat kan het meer tonen dan in de wijk; voor één " +
        "specifieke groep kan het iets anders laten zien dan voor " +
        "een andere. Wat je deelt bepaal je per groep, niet één " +
        "keer voor alles.",
        "Achter de schermen werkt dat doordat je gegevens bij jou " +
        "blijven en de buurt-weergave alleen ziet wat je vrijgeeft. " +
        "Voor jou voelt het simpeler: een paar schuifjes per groep, " +
        "die je elk moment kunt aanpassen. De buurt kent geen " +
        "centrale ledenlijst die ergens wordt bijgehouden."
      ]
    },

    {
      type: "prose",
      heading: "Een drager ter plekke",
      paragraphs: [
        "Een buurt-toepassing valt of staat met een drager ter " +
        "plekke — een buurtvereniging, een dorpshuis, een coöperatie " +
        "die er al is. Niet een landelijk platform dat ergens " +
        "neerdaalt, maar iets dat van de buurt zelf is en dat samen " +
        "met zo'n partner wordt opgezet. Denkbaar is dat een " +
        "buurtorganisatie aanvrager wordt voor lokale subsidies, met " +
        "deze techniek als onderlegger — een van de routes die nu " +
        "worden verkend.",
        "Meer over hoe je elkaar concreet helpt en hoe je samen iets " +
        "organiseert, staat onder [burenhulp & klussen]" +
        "(buurt-burenhulp.html). De techniek die dit lokaal en " +
        "zonder tussenpersoon laat werken, staat op [buurt, " +
        "technisch gezien](techniek-buurt.html); het is dezelfde " +
        "basis als [thuis](thuis.html), alleen tussen mensen die " +
        "elkaar minder goed kennen."
      ]
    },

    {
      type: "faq",
      heading: "Vragen",
      items: [
        {
          q: "Hoe weet ik dat de mensen in de buurt-app echt mijn buren zijn?",
          a: "Een buurt ontstaat doordat mensen samen aanvinken dat " +
             "ze meedoen, vaak via een lokale drager (een " +
             "buurtvereniging, een dorpshuis). Wie precies meedoet " +
             "is afhankelijk van die opzet — soms uitnodiging via " +
             "die organisatie, soms gewoon dat je in de straat woont. " +
             "Het systeem dwingt geen wereld-omspannende identiteit " +
             "af; de buurt zelf bepaalt wie erbij hoort."
        },
        {
          q: "Werkt dit ook zonder internet?",
          a: "Twee toestellen die dichtbij elkaar zijn kunnen elkaar " +
             "rechtstreeks vinden via het lokale netwerk of via een " +
             "korte radioverbinding. Op een buurt-barbecue kunnen " +
             "mensen elkaars vrijgegeven profielen zien zonder dat " +
             "er internet bij komt. Voor buren verderop loopt het " +
             "wel via een hulpserver, maar die leest niet mee."
        },
        {
          q: "Wat als een buurman misbruik maakt van wat ik deel?",
          a: "Wat je vrijgeeft is vrijgegeven — daar kan deze opzet " +
             "niet om heen. Wel kun je beperken wát je deelt en aan " +
             "wie: per groep een ander beeld, op elk moment " +
             "aanpasbaar. En je kunt iemand uit je zicht weghalen, " +
             "of een groep verlaten, zonder dat er ergens een " +
             "lijstje achterblijft."
        },
        {
          q: "Is dit niet gewoon Marktplaats voor de buurt?",
          a: "Op Marktplaats staat alle informatie centraal bij één " +
             "bedrijf, en bestaat de waarde van het platform in dat " +
             "iedereen er heen moet komen. Hier staan de gegevens " +
             "bij de mensen zelf, en is het systeem alleen het " +
             "middel om elkaar te vinden. Geen advertenties, geen " +
             "platform dat aan jouw activiteit verdient, geen " +
             "afhankelijkheid van een centrale partij die morgen " +
             "kan beslissen wat anders te doen."
        }
      ]
    }
  ]
};
