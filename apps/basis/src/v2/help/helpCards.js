// helpCards.js — the ONE deck every help reader uses: the site's cards about Onderling (kaartjes.js, a copy kept as the
// site has it) plus the app's own how-to cards (appCards.js). The matcher, the model's grounding and both shells read
// this, so a card added to either source reaches every reader. A card id lives in one source only (helpAppCards.test).
import { helpDeck as siteDeck } from './kaartjes.js';
import { APP_HOWTO_CARDS } from './appCards.js';

export const helpCardsDeck = Object.freeze({ ...siteDeck, kaartjes: [...siteDeck.kaartjes, ...APP_HOWTO_CARDS] });
