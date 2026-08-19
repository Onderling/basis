// kaartjes.js — the human-written help answer cards (the "kaartjes"), a
// faithful copy of the onderling.org site deck (content/kaartjes.json →
// built deck.json, meta version 3). One voice across site and app:
// every card carries both nl and en text, plus per-language tags for the
// matcher. "opening" is the greeting, "chips"/"chipTargets" are the pick-one
// affordances, "srcLocal" is the transparency provenance label, and
// "fallbackId" names the honest no-answer card.
//
// SINGLE-SOURCE SEAM (follow-up): for now this is a hand-synced copy of the
// site deck. The ideal is one PUBLISHED content source that both the site and
// this in-app engine consume, so the cards can never drift out of one voice.
// Until that seam exists, re-copy the built site deck when the cards change.

export const helpDeck = {
  "version": 3,
  "opening": {
    "nl": "Welkom. Ik vertel je graag wat we doen, en dat gaat het beste als ik weet wat jou hierheen brengt. Kies gerust, of stel meteen een vraag.",
    "en": "Welcome. I'm happy to explain what we do, and that works best if I know what brings you here. Pick one, or just ask a question."
  },
  "chips": {
    "nl": [
      "Ik woon in een buurt",
      "Ik zit in een bestuur",
      "Ik bouw software",
      "Gewoon nieuwsgierig"
    ],
    "en": [
      "I live in a neighborhood",
      "I'm on a board",
      "I build software",
      "Just curious"
    ]
  },
  "pickLabel": {
    "nl": "of kies zelf:",
    "en": "or pick one:"
  },
  "srcLocal": {
    "nl": "direct beantwoord — geen taalmodel gebruikt",
    "en": "answered directly — no language model used"
  },
  "chipTargets": [
    "intro.neighbourhood",
    "intro.bestuur",
    "intro.dev",
    "intro.nieuwsgierig"
  ],
  "fallbackId": "fallback.eerlijk",
  "kaartjes": [
    {
      "id": "onderling.wat",
      "tags": {
        "nl": [
          "onderling",
          "organisatie",
          "wie",
          "wat",
          "doel",
          "stichting"
        ],
        "en": [
          "onderling",
          "organization",
          "who",
          "what",
          "goal",
          "foundation"
        ]
      },
      "kop": {
        "nl": "Wat is Onderling?",
        "en": "What is Onderling?"
      },
      "nl": "Onderling is een organisatie die software maakt waarmee mensen dingen samen regelen: in hun buurt, hun huis, hun club. We bouwen op één overtuiging: gereedschap voor gemeenschappen hoort van die gemeenschappen zelf te zijn. Daarom is alles open source, en staan jouw gegevens op je eigen apparaat. Wat naar anderen gaat, bepaal jij.",
      "en": "Onderling is an organization that builds software for people to organize things together: in their neighborhood, their house, their club. We build on one conviction: tools for communities should belong to those communities. That's why everything is open source, and your data lives on your own device. What goes to others is up to you."
    },
    {
      "id": "onderling.missie",
      "tags": {
        "nl": [
          "missie",
          "doel",
          "waarom",
          "visie",
          "samenleving",
          "ai"
        ],
        "en": [
          "mission",
          "goal",
          "why",
          "vision",
          "society",
          "ai"
        ]
      },
      "kop": {
        "nl": "Waar we in geloven",
        "en": "What we believe"
      },
      "nl": "Wij geloven dat buurten, huishoudens en clubs prima zelf hun zaken kunnen regelen (iets vragen, iets delen, iets afspreken) als het gereedschap daarvoor van henzelf is. Dat gereedschap maken wij. Ook de AI erin staat onder zeggenschap van de mensen die hem gebruiken.",
      "en": "We believe neighborhoods, households, and clubs are perfectly able to run their own affairs (asking, sharing, planning) when the tools for it are their own. We make those tools. The AI inside answers to the people using it, too."
    },
    {
      "id": "onderling.wie-erachter",
      "tags": {
        "nl": [
          "wie",
          "erachter",
          "team",
          "contact",
          "mensen",
          "achter"
        ],
        "en": [
          "who",
          "behind",
          "team",
          "contact",
          "people"
        ]
      },
      "kop": {
        "nl": "Wie erachter zitten",
        "en": "Who's behind it"
      },
      "nl": "Onderling is een Nederlands initiatief, in opbouw naar een stichting: een vorm die niemand kan opkopen. De broncode staat openbaar op GitHub, dus wat we bouwen is precies wat je daar ziet. Contact: via de over-pagina, of security@onderling.org voor beveiligingsmeldingen.",
      "en": "Onderling is a Dutch initiative, on its way to becoming a foundation: a form nobody can buy out. The source code is public on GitHub, so what we build is exactly what you see there. Contact: via the about page, or security@onderling.org for security reports."
    },
    {
      "id": "product.basis",
      "tags": {
        "nl": [
          "basis",
          "app",
          "product",
          "wat",
          "is",
          "dit"
        ],
        "en": [
          "basis",
          "app",
          "product",
          "what",
          "is",
          "this"
        ]
      },
      "kop": {
        "nl": "Basis",
        "en": "Basis"
      },
      "nl": "Basis is onze app voor alles wat je onderling regelt: berichten, een prikbord voor vraag en aanbod, taken en afspraken, in circles die jij zelf maakt. Zonder verplicht account, versleuteld, en met hulpjes (zoals ik) die je zelf in een circle kunt zetten. Basis werkt in de browser; de Android-app werkt al, maar staat nog niet in de app-winkel. iOS staat op de agenda.",
      "en": "Basis is our app for everything you organize together: messages, a board for asking and offering, tasks and plans, in circles you create yourself. No account required, encrypted, with helpers (like me) you can add to a circle. Basis runs in the browser; the Android app already works, but isn't in the app store yet. iOS is on the roadmap."
    },
    {
      "id": "product.feedback",
      "tags": {
        "nl": [
          "feedback",
          "anoniem",
          "melden",
          "organisatie",
          "werk",
          "zorg"
        ],
        "en": [
          "feedback",
          "anonymous",
          "report",
          "organization",
          "workplace",
          "care"
        ]
      },
      "kop": {
        "nl": "Feedback",
        "en": "Feedback"
      },
      "nl": "Feedback is ons tweede product: eerlijke, anonieme terugkoppeling binnen organisaties. Deelnemers spreken vrijuit tegen een chatbot. Het opschonen en anonimiseren gebeurt door een taalmodel in een afgeschermde omgeving, en de deelnemer keurt zelf goed wat er gedeeld wordt. Het draait op dezelfde bouwstenen als Basis.",
      "en": "Feedback is our second product: honest, anonymous feedback within organizations. Participants speak freely to a chat bot. The cleaning and anonymizing is done by a language model in a shielded environment, and participants approve what gets shared. It runs on the same building blocks as Basis."
    },
    {
      "id": "intro.neighbourhood",
      "tags": {
        "nl": [
          "buurt",
          "straat",
          "buren",
          "noticeboard",
          "lend",
          "delen"
        ],
        "en": [
          "neighborhood",
          "street",
          "neighbors",
          "board",
          "borrow",
          "share"
        ]
      },
      "kop": {
        "nl": "Voor je buurt",
        "en": "For your neighborhood"
      },
      "nl": "Voor een buurt is Basis één plek voor wat nu over vijf app-groepen en briefjes verspreid staat: een prikbord voor vraag en aanbod, berichten, taken en afspraken. Geen account nodig; je opent het en doet mee. Wat je deelt blijft binnen je eigen circle, versleuteld.",
      "en": "For a neighborhood, Basis is one place for what's now scattered across five group chats and paper notes: a board for asking and offering, messages, tasks, and plans. No account needed; you open it and join in. What you share stays within your own circle, encrypted."
    },
    {
      "id": "intro.bestuur",
      "tags": {
        "nl": [
          "bestuur",
          "vereniging",
          "club",
          "vve",
          "members",
          "secretaris"
        ],
        "en": [
          "board",
          "association",
          "club",
          "co-op",
          "members",
          "secretary"
        ]
      },
      "kop": {
        "nl": "Voor besturen en verenigingen",
        "en": "For boards and associations"
      },
      "nl": "Voor een vereniging of VvE is Basis een plek waar leden zelf dingen regelen: taken verdelen, afspraken plannen, vragen stellen. Circles hebben eigen regels, die jullie zelf vaststellen. En de ledenlijst blijft gewoon van de vereniging.",
      "en": "For an association or housing co-op, Basis is where members organize things themselves: dividing tasks, planning meetings, asking questions. Circles have their own rules, set by you. And the member list stays with the association."
    },
    {
      "id": "intro.dev",
      "tags": {
        "nl": [
          "ontwikkelaar",
          "developer",
          "software",
          "code",
          "npm",
          "sdk",
          "bouwen"
        ],
        "en": [
          "developer",
          "software",
          "code",
          "npm",
          "sdk",
          "build"
        ]
      },
      "kop": {
        "nl": "Voor ontwikkelaars",
        "en": "For developers"
      },
      "nl": "Voor ontwikkelaars: Basis staat op een gepubliceerd platform, `@onderling/*` op npm. Agents, end-to-end-versleuteld transport, Solid Pods, en één manifest dat chat, knoppen en commando's uit dezelfde definitie levert. Apps die je ermee bouwt zijn data-compatibel met Basis. Begin bij de tutorials op GitHub; deze bot is er zelf mee gebouwd.",
      "en": "For developers: Basis stands on a published platform, `@onderling/*` on npm. Agents, end-to-end encrypted transport, Solid Pods, and one manifest that serves chat, buttons, and commands from the same definition. Apps you build with it are data-compatible with Basis. Start with the tutorials on GitHub; this bot is built with it."
    },
    {
      "id": "intro.nieuwsgierig",
      "tags": {
        "nl": [
          "nieuwsgierig",
          "rondkijken",
          "gewoon",
          "kijken"
        ],
        "en": [
          "curious",
          "browse",
          "just",
          "look"
        ]
      },
      "kop": {
        "nl": "In het kort",
        "en": "In short"
      },
      "nl": "In het kort: wij maken software waarmee je met je buurt, huis of club dingen regelt, in een omgeving die van jullie zelf is. Vraag me wat je wilt, of begin bij \"Wat is Onderling?\" hieronder.",
      "en": "In short: we make software for organizing things with your neighborhood, house, or club, in a place that's yours. Ask me anything, or start with \"What is Onderling?\" below."
    },
    {
      "id": "principe.zeggenschap",
      "tags": {
        "nl": [
          "baas",
          "eigenaar",
          "zeggenschap",
          "controle",
          "data",
          "gegevens",
          "datakluis",
          "solid",
          "pod"
        ],
        "en": [
          "owner",
          "control",
          "data",
          "vault",
          "solid",
          "pod"
        ]
      },
      "kop": {
        "nl": "Jij bent de baas over je gegevens",
        "en": "You own your data"
      },
      "nl": "Jij bent de baas over je gegevens. Ze worden op je eigen apparaat opgeslagen en zoveel mogelijk ook daar verwerkt. Alleen wat jij zelf deelt verlaat je apparaat, versleuteld, en alleen naar wie jij kiest. Wil je een reservekopie of meerdere apparaten, dan kan dat via een Solid Pod: je eigen online datakluis, waarvan jij beheert wie bij welke gegevens kan.",
      "en": "You own your data. It's stored on your own device and, as much as possible, processed there too. Only what you choose to share leaves your device, encrypted, and only to whom you choose. Want a backup or multiple devices? That works through a Solid Pod: your own online data vault, where you manage who can access what."
    },
    {
      "id": "principe.versleuteld",
      "tags": {
        "nl": [
          "versleuteld",
          "encryptie",
          "meelezen",
          "geheim",
          "lezen",
          "berichten"
        ],
        "en": [
          "encrypted",
          "encryption",
          "read",
          "secret",
          "messages"
        ]
      },
      "kop": {
        "nl": "Versleuteld, ook voor ons",
        "en": "Encrypted, even to us"
      },
      "nl": "Berichten zijn versleuteld; ook wij kunnen ze niet lezen. Er is geen server die kan meelezen: wat onderweg langs een doorgeefpunt komt, is voor dat punt onleesbaar. De grenzen van wat versleuteling wél en niet beschermt, staan eerlijk op onze privacy-pagina.",
      "en": "Messages are encrypted; we can't read them either. There's no server that can read along: whatever passes a relay point is unreadable to that point. The honest boundaries of what encryption does and doesn't protect are on our privacy page."
    },
    {
      "id": "principe.geenaccount",
      "tags": {
        "nl": [
          "account",
          "registreren",
          "email",
          "inloggen",
          "aanmelden",
          "herstelzin"
        ],
        "en": [
          "account",
          "register",
          "email",
          "login",
          "signup",
          "recovery"
        ]
      },
      "kop": {
        "nl": "Geen verplicht account",
        "en": "No account required"
      },
      "nl": "Geen verplicht account. Je apparaat maakt zelf een sleutel aan: dat is je identiteit, en die is van jou. Geen e-mailadres, geen wachtwoord, geen profiel bij ons. Verlies je je apparaat, dan haal je je identiteit terug met een herstelzin van 24 woorden, mits je een reservekopie hebt, bijvoorbeeld in je Solid Pod.",
      "en": "No account required. Your device creates its own key: that's your identity, and it's yours. No email address, no password, no profile with us. If you lose your device, a 24-word recovery phrase restores your identity, provided you have a backup, for instance in your Solid Pod."
    },
    {
      "id": "principe.opensource",
      "tags": {
        "nl": [
          "open",
          "source",
          "broncode",
          "github",
          "controleren",
          "zelf",
          "hosten",
          "openbaar",
          "code"
        ],
        "en": [
          "open",
          "source",
          "github",
          "verify",
          "self",
          "host",
          "public",
          "code"
        ]
      },
      "kop": {
        "nl": "Open source, met opzet",
        "en": "Open source, on purpose"
      },
      "nl": "Alle broncode is openbaar. Je hoeft ons dus niet te geloven: iedereen kan nakijken wat de software doet, erop voortbouwen, alles zelf hosten, of de boel kopiëren als wij ooit de verkeerde kant op zouden gaan. Dat laatste is geen bijzaak, maar de machtsbalans die we bewust inbouwen.",
      "en": "All source code is public. You don't have to take our word: anyone can verify what the software does, build on it, host everything themselves, or fork it if we ever went the wrong way. That last part isn't a side note, but a balance of power we build in deliberately."
    },
    {
      "id": "werking.circles",
      "tags": {
        "nl": [
          "circle",
          "circles",
          "groep",
          "cirkel",
          "hoe"
        ],
        "en": [
          "circle",
          "circles",
          "group",
          "how"
        ]
      },
      "kop": {
        "nl": "Circles",
        "en": "Circles"
      },
      "nl": "Alles in Basis gebeurt in circles: je straat, je huis, je club. Een circle maak je zelf, met eigen regels over wie erbij mag en wat gedeeld wordt. Per circle bepaal je wat anderen van je zien; standaard is dat zo min mogelijk.",
      "en": "Everything in Basis happens in circles: your street, your house, your club. You create a circle yourself, with its own rules about who joins and what's shared. Per circle you decide what others see of you; the default is as little as possible."
    },
    {
      "id": "werking.hulpjes",
      "tags": {
        "nl": [
          "bot",
          "hulpje",
          "assistent",
          "contacten"
        ],
        "en": [
          "bot",
          "helper",
          "assistant",
          "contacts"
        ]
      },
      "kop": {
        "nl": "Hulpjes",
        "en": "Helpers"
      },
      "nl": "In een circle kun je hulpjes zetten: bots die vragen beantwoorden, samenvatten of taken bijhouden. Ze werken voor de circle, niet voor ons. Sommige hulpjes draaien op je eigen apparaat; externe hulpjes kunnen alleen bij de gegevens die jij ze zelf geeft.",
      "en": "You can add helpers to a circle: bots that answer questions, summarize, or track tasks. They work for the circle, not for us. Some helpers run on your own device; external helpers can only access what you give them yourself."
    },
    {
      "id": "werking.ai",
      "tags": {
        "nl": [
          "ai",
          "taalmodel",
          "llm",
          "model",
          "kiezen",
          "privatemode"
        ],
        "en": [
          "ai",
          "model",
          "llm",
          "choose",
          "privatemode"
        ]
      },
      "kop": {
        "nl": "AI, onder jouw zeggenschap",
        "en": "AI, under your control"
      },
      "nl": "Gebruikt een hulpje AI, dan kies jij het taalmodel: per circle, en ook in je privé-gesprekken. In principe kan dat elk model zijn. Onze aanrader is Privatemode, dat draait in een afgeschermde omgeving: hardware waarin je gegevens ook tijdens de verwerking versleuteld blijven, zodat zelfs de beheerder niet kan meekijken. Draait het model op je eigen apparaat, dan verlaat je vraag je apparaat helemaal niet.",
      "en": "When a helper uses AI, you choose the language model: per circle, and in your private chats too. In principle that can be any model. Our recommendation is Privatemode, which runs in a shielded environment: hardware that keeps your data encrypted even during processing, so even the operator can't look in. If the model runs on your own device, your question never leaves it at all."
    },
    {
      "id": "werking.taken",
      "tags": {
        "nl": [
          "taken",
          "noticeboard",
          "ask",
          "offer",
          "agenda",
          "afspraken"
        ],
        "en": [
          "tasks",
          "board",
          "question",
          "offer",
          "calendar",
          "events"
        ]
      },
      "kop": {
        "nl": "Prikbord, taken en afspraken",
        "en": "Board, tasks, and events"
      },
      "nl": "Naast berichten heeft een circle een prikbord (vragen, aanbiedingen, leen-verzoeken), taken die leden kunnen oppakken, en afspraken met uitnodigingen. Wat je plaatst blijft binnen de circle, op de apparaten van de leden; er is geen centrale server die alles bewaart.",
      "en": "Besides messages, a circle has a board (questions, offers, borrow requests), tasks members can pick up, and events with invitations. What you post stays within the circle, on the members' devices; there's no central server keeping it all."
    },
    {
      "id": "werking.interfaces",
      "tags": {
        "nl": [
          "chat",
          "knoppen",
          "bedienen",
          "typen",
          "commando",
          "app"
        ],
        "en": [
          "chat",
          "buttons",
          "operate",
          "type",
          "command",
          "app"
        ]
      },
      "kop": {
        "nl": "Typen, tikken of commando's",
        "en": "Type, tap, or command"
      },
      "nl": "Je bedient Basis zoals jij wilt: gewoon typen, op knoppen tikken, of korte commando's. Onder water is dat allemaal hetzelfde. Daarom kan alles wat een bot kan, ook met een knop, en andersom.",
      "en": "You use Basis however suits you: just typing, tapping buttons, or short commands. Under the hood these are all the same. That's why anything a bot can do, a button can do too, and vice versa."
    },
    {
      "id": "veilig.kern",
      "tags": {
        "nl": [
          "veilig",
          "privacy",
          "vertrouwen",
          "zeker",
          "weten"
        ],
        "en": [
          "safe",
          "privacy",
          "trust",
          "sure",
          "know"
        ]
      },
      "kop": {
        "nl": "De kern",
        "en": "The core"
      },
      "nl": "Berichten zijn versleuteld; ook wij kunnen ze niet lezen. Er is geen verplicht account en geen server die kan meelezen. En omdat de broncode openbaar is, hoef je ons niet te geloven: je kunt het nakijken, of iemand laten nakijken die je wél vertrouwt.",
      "en": "Messages are encrypted; we can't read them either. There's no required account and no server that can read along. And because the source is public, you don't have to believe us: you can check, or have someone you do trust check."
    },
    {
      "id": "veilig.dezevraag",
      "tags": {
        "nl": [
          "deze",
          "ask",
          "chat",
          "bot",
          "waar",
          "gaat",
          "mijn",
          "vragen",
          "opslaan",
          "bewaren"
        ],
        "en": [
          "this",
          "question",
          "chat",
          "bot",
          "where",
          "goes",
          "my",
          "questions",
          "store",
          "keep"
        ]
      },
      "kop": {
        "nl": "En dit gesprek zelf?",
        "en": "And this conversation itself?"
      },
      "nl": "Vragen aan mij worden waar mogelijk in je eigen browser beantwoord, zonder taalmodel. Lukt dat niet, dan vraag ik eerst je toestemming om je vraag versleuteld te laten verwerken door Privatemode, in een afgeschermde omgeving. Ook dan kies ik alleen uit de vaste antwoorden. We slaan je vragen niet op; wat deze pagina bewaart, staat lokaal in je eigen browser.",
      "en": "Questions to me are answered in your own browser where possible, without a language model. If that fails, I first ask your permission to have your question processed encrypted by Privatemode, in a shielded environment. Even then, I only choose from the fixed answers. We don't store your questions; what this page keeps is stored locally in your own browser."
    },
    {
      "id": "veilig.grenzen",
      "tags": {
        "nl": [
          "grenzen",
          "eerlijk",
          "niet",
          "perfect",
          "metadata",
          "beperkingen",
          "verwijderen",
          "versleuteling"
        ],
        "en": [
          "boundaries",
          "honest",
          "not",
          "perfect",
          "metadata",
          "limits",
          "delete",
          "encryption"
        ]
      },
      "kop": {
        "nl": "De grenzen, eerlijk",
        "en": "The boundaries, honestly"
      },
      "nl": "Eerlijk is eerlijk: geen enkel systeem beschermt alles. De inhoud van berichten is versleuteld, maar wíe met wie contact heeft is bijvoorbeeld deels zichtbaar voor de doorgeefpunten. En wat je eenmaal gedeeld hebt, staat op de apparaten van je circlegenoten: verwijderen kun je vragen, niet afdwingen. Zulke grenzen benoemen we liever zelf; op de privacy-pagina staat precies wat wel en niet beschermd is.",
      "en": "Honestly: no system protects everything. Message content is encrypted, but who contacts whom, for example, is partly visible to relay points. And what you've shared lives on your circle members' devices: you can request deletion, not enforce it. We prefer naming such boundaries ourselves; the privacy page states exactly what is and isn't protected."
    },
    {
      "id": "doe.probeer",
      "tags": {
        "nl": [
          "proberen",
          "demo",
          "start",
          "beginnen",
          "downloaden",
          "installeren"
        ],
        "en": [
          "try",
          "demo",
          "start",
          "begin",
          "download",
          "install"
        ]
      },
      "kop": {
        "nl": "Probeer Basis",
        "en": "Try Basis"
      },
      "nl": "Basis draait in je browser, zonder account of installatie. Je kunt nu al circles maken en die met anderen delen. Het is een onderzoeksversie, dus verwacht ruwe randjes. Beginnen: open Basis, maak een circle aan en geef hem een naam. Deel daarna de uitnodiging met wie je erbij wilt hebben. Meer is het niet.",
      "en": "Basis runs in your browser, no account or installation. You can already create circles and share them with others. It's a research release, so expect rough edges. To start: open Basis, create a circle, and give it a name. Then share the invitation with whoever you want in. That's all there is to it."
    },
    {
      "id": "doe.probeer.dev",
      "tags": {
        "nl": [
          "proberen",
          "demo",
          "start",
          "sdk",
          "npm",
          "tutorials"
        ],
        "en": [
          "try",
          "demo",
          "start",
          "sdk",
          "npm",
          "tutorials"
        ]
      },
      "kop": {
        "nl": "Vandaag beginnen als ontwikkelaar",
        "en": "Start today as a developer"
      },
      "nl": "Meteen te doen: de tutorials op GitHub en `@onderling/*` op npm. Deze bot is met het platform gebouwd, dus je kijkt nu al naar een werkend voorbeeld. In de proefversie kun je circles maken en delen; als ontwikkelaar kun je vandaag beginnen.",
      "en": "Ready today: the tutorials on GitHub and `@onderling/*` on npm. This bot is built with the platform, so you're already looking at a working example. In the trial version you can create and share circles; as a developer you can start now."
    },
    {
      "id": "doe.bouwmee",
      "tags": {
        "nl": [
          "bijdragen",
          "meedoen",
          "helpen",
          "contribute",
          "open",
          "source"
        ],
        "en": [
          "contribute",
          "join",
          "help",
          "open",
          "source"
        ]
      },
      "kop": {
        "nl": "Bouw mee",
        "en": "Build with us"
      },
      "nl": "Graag zelfs. De broncode staat op github.com/Onderling, met een bijdrage-gids, tutorials en uitgebreide documentatie. Kleine dingen zijn welkom (een vertaling, een foutmelding), grotere ook. Beveiligingsvondsten: security@onderling.org.",
      "en": "Please do. The source lives at github.com/Onderling, with a contributing guide, tutorials, and extensive documentation. Small things are welcome (a translation, a bug report), bigger things too. Security findings: security@onderling.org."
    },
    {
      "id": "doe.volgen",
      "tags": {
        "nl": [
          "volgen",
          "nieuws",
          "updates",
          "releases",
          "nieuwsbrief",
          "hoogte",
          "blijven"
        ],
        "en": [
          "follow",
          "news",
          "updates",
          "releases",
          "newsletter",
          "stay"
        ]
      },
      "kop": {
        "nl": "Op de hoogte blijven",
        "en": "Stay up to date"
      },
      "nl": "Volgen kan via GitHub: elke uitgave staat op github.com/Onderling, met een leesbaar overzicht van wat er veranderd is. Een nieuwsbrief of ander kanaal is er nog niet; als dat komt, lees je het daar als eerste.",
      "en": "You can follow along on GitHub: every release is at github.com/Onderling, with a readable summary of what changed. There's no newsletter or other channel yet; when one arrives, you'll read it there first."
    },
    {
      "id": "praktisch.kosten",
      "tags": {
        "nl": [
          "kosten",
          "prijs",
          "gratis",
          "betalen",
          "verdienmodel"
        ],
        "en": [
          "cost",
          "price",
          "free",
          "pay",
          "business"
        ]
      },
      "kop": {
        "nl": "Wat kost het?",
        "en": "What does it cost?"
      },
      "nl": "De software is gratis en open source, en dat blijft zo. Onderling wordt een stichting; we zoeken de dekking van kosten in samenwerkingen en publieke fondsen, niet in jouw gegevens. Er zit geen advertentie en geen datahandel in. Dat zou alles tegenspreken waar dit voor is.",
      "en": "The software is free and open source, and stays that way. Onderling is becoming a foundation; we cover costs through partnerships and public funding, not your data. There are no ads and no data trade. That would contradict everything this is for."
    },
    {
      "id": "praktisch.apparaten",
      "tags": {
        "nl": [
          "telefoon",
          "android",
          "iphone",
          "ios",
          "web",
          "apparaat",
          "app"
        ],
        "en": [
          "phone",
          "android",
          "iphone",
          "ios",
          "web",
          "device",
          "app"
        ]
      },
      "kop": {
        "nl": "Op welke apparaten?",
        "en": "On which devices?"
      },
      "nl": "Basis werkt in de browser. De Android-app werkt en draait op echte telefoons; hij staat alleen nog niet in de app-winkel. iPhone staat daarna op de agenda: Apple beperkt apps op de achtergrond, dus een goede iOS-versie vraagt extra infrastructuur. Daar wordt aan gewerkt.",
      "en": "Basis works in the browser. The Android app works and runs on real phones; it just isn't in the app store yet. iPhone comes after that: Apple restricts background apps, so a good iOS version needs extra infrastructure. That work is underway."
    },
    {
      "id": "praktisch.status",
      "tags": {
        "nl": [
          "status",
          "af",
          "klaar",
          "beta",
          "versie",
          "stabiel"
        ],
        "en": [
          "status",
          "finished",
          "ready",
          "beta",
          "version",
          "stable"
        ]
      },
      "kop": {
        "nl": "Hoe af is het?",
        "en": "How finished is it?"
      },
      "nl": "Eerlijk antwoord: dit is een onderzoeksversie. De kern werkt en wordt dagelijks getest, maar het is nog geen gepolijst consumentenproduct. We zeggen liever te weinig toe dan te veel. Wat er staat, werkt.",
      "en": "Honest answer: this is a research release. The core works and is tested daily, but it's not yet a polished consumer product. We'd rather promise too little than too much. What you see works."
    },
    {
      "id": "meta.bot",
      "tags": {
        "nl": [
          "wie",
          "ben",
          "jij",
          "bot",
          "zelf",
          "ai",
          "wat",
          "je"
        ],
        "en": [
          "who",
          "am",
          "you",
          "bot",
          "self",
          "ai",
          "what"
        ]
      },
      "kop": {
        "nl": "Wie ben ik?",
        "en": "Who am I?"
      },
      "nl": "Ik ben een Basis-hulpje dat Onderling voor deze website heeft ingericht, hetzelfde soort hulpje dat je zelf in een circle kunt zetten. Dit gesprek is dus meteen een demonstratie. Ik kies mijn antwoorden uit vaste, door mensen geschreven teksten. Een taalmodel helpt soms kiezen en mag ze met een kort zinnetje aan elkaar praten — dat zinnetje is dan van het model, de antwoorden zelf blijven van mensen. Andere organisaties kunnen mij ook inrichten, met hun eigen verhaal.",
      "en": "I'm a Basis helper that Onderling set up for this website, the same kind of helper you can add to your own circle. This conversation is a demonstration in itself. I choose my answers from fixed, human-written texts. A language model sometimes helps with the choosing and may tie them together with a short sentence — that sentence is the model's, the answers themselves stay human. Other organizations can set me up too, with their own story."
    },
    {
      "id": "fallback.eerlijk",
      "tags": {
        "nl": [],
        "en": []
      },
      "kop": {
        "nl": "Eerlijk gezegd",
        "en": "Honestly"
      },
      "nl": "Daar heb ik geen vast antwoord op, en ik ga niet improviseren. Kijk in de documentatie op GitHub, of mail ons: een mens antwoordt. Hieronder staat waar ik wél goed in ben.",
      "en": "I don't have a fixed answer for that, and I won't improvise. Check the documentation on GitHub, or email us: a human replies. Below is what I'm good at."
    }
  ]
};

export default helpDeck;
