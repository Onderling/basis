// appCards.js — the APP's own how-to cards: how to do a thing in Basis, step by step. They sit BESIDE the site deck
// (kaartjes.js, a copy of the onderling.org cards about Onderling itself), never in it, so that copy stays the site's.
// helpAnswer.js reads both as one deck with the same matcher; a card id lives in exactly one of them (the test pins it).
// Every step named here is one the app has today: check the screen or the "+" line before changing a card. A card that
// quotes "+" lines lists them in `plusLines` per language; the test runs each through the "+" and fails one it cannot read.

/**
 * THE APP'S OWN WORDS FOR SITE CARDS THAT ARE WRONG INSIDE THE APP. The site deck (kaartjes.js) stays the site's copy;
 * a card read in the app that speaks of "this website", "your browser" or "open Basis", says "circles" in Dutch (the app
 * says "kringen"), or names one way where the app has two (a pod OR a recovery file, Frits 2026-11-17), gets its text here,
 * keyed by the site card's id. Only the text changes: the id, its tags and its heading stay the site's, so the matcher
 * finds the same card. helpCards.js applies these; a sentence that is wrong on the SITE too also goes on the site's list.
 */
export const APP_VARIANTS = Object.freeze({
  'product.basis': {
    nl: 'Basis is onze app voor alles wat je onderling regelt: berichten, een prikbord voor vraag en aanbod, taken, lijstjes en afspraken, in kringen die jij zelf maakt. Zonder verplicht account en versleuteld. Basis werkt in de browser en als Android-app; die staat nog niet in de app-winkel. iOS staat op de agenda.',
    en: 'Basis is our app for everything you organise together: messages, a board for asking and offering, tasks, lists and appointments, in circles you make yourself. No account required, and encrypted. Basis works in the browser and as an Android app, which is not in the app store yet. iOS is on the roadmap.',
  },
  'intro.buurt': {
    nl: 'Voor een buurt is Basis één plek voor wat nu over vijf app-groepen en briefjes verspreid staat: een prikbord voor vraag en aanbod, berichten, taken en afspraken. Geen account nodig. Wat je deelt blijft binnen je eigen kring, versleuteld.',
    en: 'For a neighbourhood, Basis is one place for what is now scattered across five group chats and paper notes: a board for asking and offering, messages, tasks and appointments. No account needed. What you share stays within your own circle, encrypted.',
  },
  'intro.bestuur': {
    nl: 'Voor een vereniging of VvE is Basis een plek waar leden zelf dingen regelen: taken verdelen, afspraken plannen, vragen stellen. Kringen hebben eigen regels, die jullie zelf vaststellen. En de ledenlijst blijft gewoon van de vereniging.',
    en: 'For an association or housing co-op, Basis is where members organise things themselves: dividing tasks, planning meetings, asking questions. Circles have their own rules, set by you. And the member list stays with the association.',
  },
  'principe.zeggenschap': {
    nl: 'Jij bent de baas over je gegevens. Ze worden op je eigen apparaat opgeslagen en zoveel mogelijk ook daar verwerkt. Alleen wat jij zelf deelt verlaat je apparaat, versleuteld, en alleen naar wie jij kiest. Wil je verder op een ander apparaat, dan voeg je dat toe bij Instellingen → Apparaten & sleutels; je kringen neem je mee met een herstelbestand (Mijn gegevens), of via een Solid Pod als je die hebt.',
    en: 'You own your data. It is stored on your own device and, as much as possible, processed there too. Only what you choose to share leaves your device, encrypted, and only to whom you choose. To carry on on another device, add it under Settings → Devices & keys; you take your circles along with a recovery file (My data), or through a Solid Pod if you have one.',
  },
  'principe.geenaccount': {
    nl: 'Geen verplicht account. Je apparaat maakt zelf een sleutel aan: dat is je identiteit, en die is van jou. Geen e-mailadres, geen wachtwoord, geen profiel bij ons. Verlies je je apparaat, dan haalt je herstelzin van 24 woorden terug wie je bent. Je kringen komen terug met een herstelbestand (Mijn gegevens) of uit een Solid Pod; je gesprekken zitten daar niet in.',
    en: 'No account required. Your device creates its own key: that is your identity, and it is yours. No email address, no password, no profile with us. If you lose your device, your 24-word recovery phrase brings back who you are. Your circles come back with a recovery file (My data) or from a Solid Pod; your conversations are not in it.',
  },
  'werking.kringen': {
    nl: 'Alles in Basis gebeurt in kringen: je straat, je huis, je club. Een kring maak je zelf, met eigen regels over wie erbij mag en wat gedeeld wordt. Per kring bepaal je wat anderen van je zien; standaard is dat zo min mogelijk.',
    en: 'Everything in Basis happens in circles: your street, your house, your club. You make a circle yourself, with its own rules about who joins and what is shared. Per circle you decide what others see of you; the default is as little as possible.',
  },
  'werking.hulpjes': {
    nl: 'Een kring kan een hulpje hebben: een bot die vragen beantwoordt of taken bijhoudt, zoals ik hier. Een hulpje werkt voor de kring, niet voor ons, en kan alleen bij wat de kring hem geeft. Zelf een hulpje aan een kring toevoegen kan in de app nog niet.',
    en: 'A circle can have a helper: a bot that answers questions or keeps track of tasks, like me here. A helper works for the circle, not for us, and can only reach what the circle gives it. Adding a helper to a circle yourself is not possible in the app yet.',
  },
  'werking.ai': {
    nl: 'Gebruikt een hulpje AI, dan kies jij het taalmodel: per kring, en voor je eigen + een model van jezelf (bij Instellingen). In principe kan dat elk model zijn. Onze aanrader is Privatemode, dat draait in een afgeschermde omgeving: hardware waarin je gegevens ook tijdens de verwerking versleuteld blijven, zodat zelfs de beheerder niet kan meekijken. Draait het model op je eigen apparaat, dan verlaat je vraag je apparaat helemaal niet.',
    en: 'If a helper uses AI, you choose the language model: per circle, and for your own + a model of your own (in Settings). In principle it can be any model. We recommend Privatemode, which runs in a shielded environment: hardware in which your data stays encrypted even while it is processed, so that not even the operator can look in. If the model runs on your own device, your question never leaves it.',
  },
  'werking.taken': {
    nl: 'Naast berichten heeft een kring een prikbord (vragen, aanbiedingen, leen-verzoeken), taken die leden kunnen oppakken, lijstjes en afspraken. Wat je plaatst blijft binnen de kring, op de apparaten van de leden; er is geen centrale server die alles bewaart.',
    en: 'Besides messages, a circle has a board (questions, offers, borrow requests), tasks members can pick up, lists and appointments. What you post stays within the circle, on the members\' devices; there is no central server keeping it all.',
  },
  'veilig.grenzen': {
    nl: 'Eerlijk is eerlijk: geen enkel systeem beschermt alles. De inhoud van berichten is versleuteld, maar wíe met wie contact heeft is bijvoorbeeld deels zichtbaar voor de verbindingspunten. En wat je eenmaal gedeeld hebt, staat op de apparaten van je kringgenoten: verwijderen kun je vragen, niet afdwingen. Zulke grenzen benoemen we liever zelf; op de pagina Grenzen op onderling.org staat precies wat wel en niet beschermd is.',
    en: 'Honestly: no system protects everything. Message content is encrypted, but who contacts whom, for example, is partly visible to the connection points. And what you have shared lives on your circle members\' devices: you can request deletion, not enforce it. We prefer naming such boundaries ourselves; the Limits page on onderling.org states exactly what is and is not protected.',
  },
  'veilig.dezevraag': {
    nl: 'Vragen aan mij worden op je eigen apparaat beantwoord, uit vaste, door mensen geschreven antwoorden, zonder taalmodel. Past er geen, dan vraag ik eerst of je je vraag wilt doorsturen naar het taalmodel van de kring; alleen met jouw ja gaat hij weg. Je vragen blijven in dit gesprek op je eigen apparaat.',
    en: 'Questions to me are answered on your own device, from fixed answers written by people, without a language model. If none fits, I first ask whether you want to pass your question on to the circle\'s language model; it only leaves with your yes. Your questions stay in this conversation on your own device.',
  },
  'doe.probeer': {
    nl: 'Je bent al begonnen. Maak een kring bij Kringen, geef hem een naam en deel de uitnodiging met wie je erbij wilt hebben. Het is een onderzoeksversie, dus verwacht ruwe randjes.',
    en: 'You have already started. Make a circle under Circles, give it a name and share the invitation with whoever you want in. It is a research release, so expect rough edges.',
  },
  'doe.probeer.dev': {
    nl: 'Meteen te doen: de tutorials op GitHub en `@onderling/*` op npm. Deze app is met het platform gebouwd, dus je kijkt nu al naar een werkend voorbeeld; als ontwikkelaar kun je vandaag beginnen.',
    en: 'Ready today: the tutorials on GitHub and `@onderling/*` on npm. This app is built with the platform, so you are already looking at a working example; as a developer you can start now.',
  },
  'meta.bot': {
    nl: 'Ik ben de hulp van Basis. Ik kies mijn antwoorden uit vaste, door mensen geschreven teksten. Weet ik het niet, dan zeg ik dat, en vraag ik of je je vraag wilt doorsturen naar een taalmodel; dat antwoord is dan van het model.',
    en: 'I am the help of Basis. I choose my answers from fixed, human-written texts. If I do not know, I say so, and I ask whether you want to pass your question on to a language model; that answer is then the model\'s.',
  },
});

export const APP_HOWTO_CARDS = Object.freeze([
  {
    id: 'app.uitnodigen',
    tags: {
      nl: ['uitnodigen', 'uitnodiging', 'nodig', 'iemand', 'toevoegen', 'erbij', 'lid'],
      en: ['invite', 'invitation', 'someone', 'add', 'join', 'member'],
    },
    kop: { nl: 'Iemand uitnodigen', en: 'Inviting someone' },
    nl: 'Iemand uitnodigen: open de kring, tik op ⋯ en kies "Uitnodigen voor deze kring". Je krijgt een code, een QR en een link: deel die met wie je erbij wilt hebben. In een kring met beheerders kan alleen een beheerder uitnodigen.',
    en: 'Inviting someone: open the circle, tap ⋯ and choose "Invite to this circle". You get a code, a QR and a link: share it with the person you want in. In a circle with admins, only an admin can invite.',
  },
  {
    id: 'app.lijst',
    tags: {
      nl: ['lijst', 'lijstje', 'lijsten', 'boodschappen', 'boodschappenlijst', 'maken'],
      en: ['list', 'lists', 'shopping', 'make', 'create'],
    },
    kop: { nl: 'Een lijst maken', en: 'Making a list' },
    nl: 'Een lijst maken: tik op + en typ "nieuwe lijst Boodschappen": dan is hij van jou. Voor een lijst in een kring noem je de kring: "Thuis: maak een lijst Boodschappen". Iets erop zetten: "zet melk op Boodschappen".',
    en: 'Making a list: tap + and type "new list Shopping": then it is yours. For a list in a circle, name the circle: "Home: make a list Shopping". Putting something on it: "add milk to Shopping".',
    // the "+" lines this card quotes, per language: each must be read by that language's gate (helpAppCards.test)
    plusLines: {
      nl: ['nieuwe lijst Boodschappen', 'Thuis: maak een lijst Boodschappen', 'zet melk op Boodschappen'],
      en: ['new list Shopping', 'Home: make a list Shopping', 'add milk to Shopping'],
    },
  },
]);
