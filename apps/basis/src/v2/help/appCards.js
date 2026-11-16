// appCards.js — the APP's own how-to cards: how to do a thing in Basis, step by step. They sit BESIDE the site deck
// (kaartjes.js, a copy of the onderling.org cards about Onderling itself), never in it, so that copy stays the site's.
// helpAnswer.js reads both as one deck with the same matcher; a card id lives in exactly one of them (the test pins it).
// Every step named here is one the app has today: check the screen or the "+" line before changing a card.

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
    en: 'Making a list: tap + and type "nieuwe lijst Boodschappen": then it is yours. For a list in a circle, name the circle: "Thuis: maak een lijst Boodschappen". Putting something on it: "zet melk op Boodschappen".',
  },
]);
