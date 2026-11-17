// helpCards.js — the ONE deck every help reader uses: the site's cards about Onderling (kaartjes.js, a copy kept as the
// site has it) plus the app's own how-to cards (appCards.js). The matcher, the model's grounding and both shells read
// this, so a card added to either source reaches every reader. A card id lives in one source only (helpAppCards.test).
//
// Two app layers on top of the copy, so the copy itself stays the site's:
//   - APP_VARIANTS: the app's own text for a site card that is wrong INSIDE the app (same id, tags and heading);
//   - the introduction's seven cards as help cards: their words are the intro's own locale keys (circle.introDeck.*),
//     so the Help circle and the introduction can never say two different things.
import { helpDeck as siteDeck } from './kaartjes.js';
import { APP_HOWTO_CARDS, APP_VARIANTS } from './appCards.js';
import { INTRO_CARDS } from '../introDeck.js';
import { sharedCircleLocale } from '../../locales/index.js';

/** The words a newcomer types for each intro card's subject (the matcher's tags; the text is the intro's own). */
const INTRO_TAGS = Object.freeze({
  welcome: { nl: ['basis', 'wat', 'is', 'app', 'welkom'], en: ['basis', 'what', 'is', 'app', 'welcome'] },
  circles: { nl: ['kring', 'kringen', 'groep'], en: ['circle', 'circles', 'group'] },
  contacts: { nl: ['contact', 'contacten', 'toevoegen', 'scannen', 'code', 'verzoek'], en: ['contact', 'contacts', 'add', 'scan', 'code', 'request'] },
  plus: { nl: ['plus', '+', 'notitie', 'afspraak', 'maken', 'typ'], en: ['plus', '+', 'note', 'appointment', 'make', 'type'] },
  selves: { nl: ['persona', 'personas', 'thuis', 'werk', 'wie'], en: ['persona', 'personas', 'home', 'work', 'who'] },
  nearby: { nl: ['buurt', 'dichtbij', 'nearby', 'vraag', 'boormachine'], en: ['nearby', 'close', 'near', 'ask', 'drill'] },
  // not 'herstelzin'/'recovery phrase': the site's 'no account' card answers those (the site-parity routes pin it)
  keys: { nl: ['sleutel', 'sleutels', 'kwijt', 'opschrijven', 'bewaren'], en: ['key', 'keys', 'lost', 'write', 'keep'] },
});

const { nl, en } = sharedCircleLocale;
const textOf = (tree, key) => String(tree?.introDeck?.[key]?.text ?? '');

/** The introduction's seven cards as help cards, read from the locale (one source). */
export const INTRO_HELP_CARDS = Object.freeze(INTRO_CARDS.map((id) => Object.freeze({
  id: `app.intro.${id}`,
  tags: INTRO_TAGS[id],
  kop: { nl: textOf(nl, `${id}_title`), en: textOf(en, `${id}_title`) },
  nl: textOf(nl, `${id}_body`),
  en: textOf(en, `${id}_body`),
})));

/** A site card as the app shows it: its own text, or the app's where the site's is wrong inside the app. */
const asInApp = (card) => (APP_VARIANTS[card.id] ? { ...card, ...APP_VARIANTS[card.id] } : card);

export const helpCardsDeck = Object.freeze({
  ...siteDeck,
  kaartjes: [...siteDeck.kaartjes.map(asInApp), ...APP_HOWTO_CARDS, ...INTRO_HELP_CARDS],
});
