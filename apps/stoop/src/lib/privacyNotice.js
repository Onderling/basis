/**
 * Closed-beta privacy-notice content (Stoop V1).
 *
 * Source of truth for the seven required content items per
 * `Project Files/Stoop/privacy-and-safety-2026-05-05.md` §
 * "Closed-beta privacy notice — required content".
 *
 * Stoop's onboarding renders this on the join / first-run screens.
 * Localisation: keep the content in NL/EN here for V1; a richer localisation
 * pipeline (Phase 8) lifts the strings into locale JSON when more
 * locales are added.
 */

export const PRIVACY_NOTICE = Object.freeze({
  nl: Object.freeze([
    {
      heading: 'Wat is versleuteld',
      body:    'De inhoud van je berichten wordt versleuteld voordat ze het apparaat verlaten. ' +
               'De relay-operator (de server die berichten doorgeeft) kan ze niet lezen.',
    },
    {
      heading: 'Wat de relay-operator wel ziet',
      body:    'Wie verbinding maakt, wie met wie praat, op welk moment, hoe groot de berichten zijn ' +
               'en in welke groep iets wordt geplaatst. De inhoud blijft afgeschermd, het verkeerspatroon niet.',
    },
    {
      heading: 'Wie de relay beheert',
      body:    'De huidige test-relay wordt door één persoon beheerd. ' +
               'De naam van de operator staat onderaan deze pagina en in instellingen.',
    },
    {
      heading: 'Waar je data staat',
      body:    'Je profiel, posts en groep-instellingen staan op je eigen Solid pod. ' +
               'Je kunt op elk moment exporteren of verwijderen.',
    },
    {
      heading: 'Dit is een onderzoeks-preview',
      body:    'Geen volwassen dienst. Reken er niet op voor zaken die niet kapot mogen.',
    },
    {
      heading: 'Wat je niet in deze app moet stoppen',
      body:    'Geen medische, financiële of anderszins gevoelige informatie. ' +
               'Stoop is voor losse buurt-vragen en aanbod, niet voor een digitale kluis.',
    },
    {
      heading: 'Hoe je weggaat',
      body:    'Uitloggen, groep verlaten of je pod verwijderen kan altijd via het profielscherm. ' +
               'Andere leden zien dan dat je weg bent.',
    },
  ]),
  en: Object.freeze([
    { heading: 'What is encrypted',
      body:    'The content of your messages is encrypted before leaving your device. The relay operator cannot read them.' },
    { heading: 'What the relay operator sees',
      body:    'Who connects, who talks to whom, when, message sizes, and which group activity belongs to. Content stays sealed; traffic patterns do not.' },
    { heading: 'Who runs the relay',
      body:    'The current test relay is run by one person. The operator name is at the bottom of this page and in settings.' },
    { heading: 'Where your data lives',
      body:    'Your profile, posts and group settings live on your own Solid pod. You can export or delete at any time.' },
    { heading: 'This is a research preview',
      body:    'Not a mature product. Do not rely on it for things that must not break.' },
    { heading: 'What not to put in this app',
      body:    'No medical, financial or otherwise sensitive information. Stoop is for casual neighbourhood questions and offers, not a digital vault.' },
    { heading: 'How to leave',
      body:    'You can sign out, leave a group, or delete your pod from the profile screen at any time. Other members will see that you are gone.' },
  ]),
});

/**
 * Pick a localised copy of the notice.  Defaults to English if the
 * requested lang is not available.
 *
 * @param {string} [lang='en']
 * @returns {ReadonlyArray<{heading: string, body: string}>}
 */
export function getPrivacyNotice(lang = 'en') {
  return PRIVACY_NOTICE[lang] ?? PRIVACY_NOTICE.en;
}
