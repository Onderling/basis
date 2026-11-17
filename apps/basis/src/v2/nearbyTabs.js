/**
 * nearbyTabs — what Nearby's two tabs hold, in what order, and which opens first: decided once here, so the web and the
 * phone paint the same room. The tabs and their parts are declared in `screenSections.js` (`nearbyConversation`,
 * `nearbyQuestions`); this picks, for the model the painters already get (`createNearbyScreen`'s), the parts that have
 * something to show. A part with nothing in it is not painted — no "nothing here" line.
 *
 * Which tab is selected is paint state, kept by each shell; this gives only the one it starts on: Conversation while
 * the person is in the room chat and seen by the room, Questions otherwise.
 */
import { sectionsOf } from './screenSections.js';
import { nearbyChatOff } from './nearbyStream.js';

/** The two tabs, in order: id, the words on the tab, and the declared screen whose sections it paints. */
export const NEARBY_TABS = Object.freeze([
  Object.freeze({ id: 'conversation', labelKey: 'circle.nearbyScreen.tab_conversation', screen: 'nearbyConversation' }),
  Object.freeze({ id: 'questions',    labelKey: 'circle.nearbyScreen.tab_questions',    screen: 'nearbyQuestions' }),
]);

const list = (v) => (Array.isArray(v) ? v : []);

/** Whether a declared part has something to show in this room. An id without a rule here is never shown (the test
 *  holds every declared id to a rule). */
const SHOWS = Object.freeze({
  // the stream only while the person is in the chat AND seen by the room (`nearbyChatOff`); `chat === null` means "not
  // in the chat" — distinct from a joined chat where nobody has said anything yet
  'nearby-chat':      (m) => nearbyChatOff(m) === null,
  'nearby-chat-off':  (m) => nearbyChatOff(m) !== null,
  'nearby-ask-field': () => true,
  'nearby-my-asks':   (m) => list(m.myAsks).length > 0,
  'nearby-asks':      (m) => list(m.asks).length > 0,
  'nearby-peers':     (m) => list(m.rows).length > 0,
  'nearby-invites':   (m) => list(m.invites).length > 0,
});

/**
 * @param {object|null} model  the Nearby model (`{ chat, myAsks, asks, rows, invites, … }`)
 * @returns {{ tabs: Array<{ id: string, labelKey: string, sections: string[] }>, defaultTab: string,
 *   chatOff: ReturnType<typeof nearbyChatOff> }}  chatOff: why Conversation shows one line instead of the stream
 */
export function nearbyTabs(model) {
  const m = model && typeof model === 'object' ? model : {};
  const tabs = NEARBY_TABS.map((tab) => ({
    id: tab.id,
    labelKey: tab.labelKey,
    sections: sectionsOf(tab.screen).map((s) => s.id).filter((id) => SHOWS[id]?.(m) === true),
  }));
  const chatOff = nearbyChatOff(m);
  return { tabs, defaultTab: chatOff ? 'questions' : 'conversation', chatOff };
}
