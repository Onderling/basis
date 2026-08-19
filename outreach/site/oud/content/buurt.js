/* buurt.js — sectie 2: Buurt & omgeving. Volwaardig, eigen stem
   (niet de thuis-opbouw kopiëren). Prikbord-mockup i.p.v. chat als
   concrete vorm. "patroon"/"commercieel" vermijden. */
window.ONDERLING_PAGE = {
  key: "buurt",
  title: "Buurt & omgeving",
  blocks: [
    {
      type: "hero",
      heading: "In de buurt: elkaar vinden zonder tussenpersoon",
      lead:
        "In een straat of wijk kan en zoekt iedereen van alles, maar je " +
        "weet zelden van elkaar wát. Hier breng je vraag en aanbod " +
        "rechtstreeks bij elkaar, en je houdt zelf in de hand wat de " +
        "buurt van je ziet."
    },

    {
      type: "prose",
      paragraphs: [
        "Hier is het bewust geen feed. Het lijkt meer op een prikbord bij " +
        "de buurtwinkel: je hangt er een vraag of een aanbod op, en wie " +
        "iets ziet dat past, reageert. Geen algoritme dat bepaalt wat je " +
        "te zien krijgt, geen bedrijf dat meeleest om er advertenties " +
        "tegenaan te plakken. Je profiel laat aan de buurt alleen zien " +
        "wat jij wilt; de rest staat in je eigen ruimte, net als thuis.",
        "Wat het laat werken is wederkerigheid. Een prikbord met alleen " +
        "vragen wordt een klaagmuur; een prikbord met alleen aanbod " +
        "voelt als reclame. Het gaat om allebei door elkaar — en dat een " +
        "vraag van de buurman je vaak op het idee brengt dat je zelf ook " +
        "iets te bieden hebt."
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
        "Een match is een begin, geen eindpunt. Reageert er iemand, dan " +
        "stelt de assistent jullie aan elkaar voor en regelen jullie het " +
        "verder zelf — even bellen, of op de stoep. Achteraf kan er een " +
        "klein bedankje of een korte terugkoppeling bij, zichtbaar voor " +
        "je eigen circle. Geen sterrensysteem: dat maakt van burenhulp een " +
        "transactie, en dat is precies niet de bedoeling."
      ]
    },

    {
      type: "prose",
      heading: "Lokaal verankerd",
      paragraphs: [
        "Een buurt-toepassing valt of staat met een drager ter plekke — " +
        "een buurtvereniging, een dorpshuis, een coöperatie die er al " +
        "is. Niet een landelijk platform dat ergens neerdaalt, maar iets " +
        "dat van de buurt zelf is en dat samen met zo'n partner wordt " +
        "opgezet. Hoe dat financieel en organisatorisch kan, is per plek " +
        "verschillend en hoort bij het werk dat nog moet gebeuren — niet " +
        "bij een belofte hier.",
        "Meer over hoe je elkaar concreet helpt en hoe je samen iets " +
        "organiseert, staat onder [burenhulp & klussen](buurt-burenhulp.html). " +
        "De techniek die dit lokaal en zonder tussenpersoon laat werken, " +
        "staat op [techniek](techniek.html); het is dezelfde basis als " +
        "[thuis](thuis.html), alleen tussen mensen die elkaar minder goed " +
        "kennen."
      ]
    }
  ]
};
