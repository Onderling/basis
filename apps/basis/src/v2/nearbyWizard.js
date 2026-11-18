/**
 * nearbyWizard — Nearby the first time, in three steps: (1) visible here, and as whom; (2) your card and what you offer;
 * (3) the conversation here. It replaces the one first-use question ("what may this room see of you?") and adds no
 * setting: each answer is a setting the gear menu already holds (`nearbyMenu`), written through the same acts —
 * "Ja, als …" is the menu's Zichtbaar (`nearbyHereChoose`), a saved card turns the card's own switch on, the chat switch
 * is the menu's chat switch. Decided once here, so the web and the phone walk the same steps and write the same things.
 *
 * "Alleen kijken" writes no level: only the device's asked-mark, so the screen shows the person as hidden without their
 * having picked "Even stil" (that one is this once only). It ends the wizard.
 */
import { nearbyHereChoose } from './nearbyMenu.js';

/** How many steps the wizard has (the "step n of 3" line). */
export const NEARBY_WIZARD_STEPS = 3;

const K = 'circle.nearbyScreen.';

/**
 * The words and parts of one step, for a painter. Names are resolved by the painter (`nameKey` or `name`, as the room-self
 * view gives them); the general self is said as "{{name}} · yourself".
 * @param {number} step  1..3
 * @param {{selfView?: {self?: object|null, choices?: Array}|null, offers?: string[], chat?: boolean}} a
 *   `selfView`: `nearbyRoomSelfView(...)`; `offers`: what the room self offers (its published skills); `chat`: the chat
 *   allow as it stands (the step-3 switch starts there)
 */
export function nearbyWizardStep(step, { selfView = null, offers = [], chat = false } = {}) {
  const n = Math.min(Math.max(1, Number(step) || 1), NEARBY_WIZARD_STEPS);
  const head = { key: `${K}wizard_step`, vars: { n, of: NEARBY_WIZARD_STEPS } };
  if (n === 1) {
    const listed = Array.isArray(selfView?.choices) && selfView.choices.length ? selfView.choices : (selfView?.self ? [selfView.self] : []);
    const selves = listed.map((c) => ({ ...c, general: c.id === 'default' }));
    return {
      step: n, head,
      titleKey: `${K}wizard1_title`, textKey: `${K}wizard1_text`,
      appearAsKey: `${K}wizard1_appear_as`, generalKey: `${K}wizard1_general`, selves, selected: selfView?.self?.id ?? null,
      underKey: `${K}wizard1_fixed`,
      buttons: [{ id: 'yes', key: `${K}wizard1_yes` }, { id: 'look', key: `${K}wizard1_look` }],
    };
  }
  if (n === 2) {
    const list = (Array.isArray(offers) ? offers : []).filter((s) => typeof s === 'string' && s.trim());
    return {
      step: n, head,
      titleKey: `${K}wizard2_title`, textKey: `${K}wizard2_text`,
      nameKey: `${K}wizard2_name`, lineKey: `${K}wizard2_line`, lineExampleKey: `${K}wizard2_line_example`,
      // nothing offered yet: no switch, the line that says where an offer is made
      offers: list.length ? { key: `${K}wizard2_offers`, vars: { offers: list.join(', ') }, list } : { noneKey: `${K}wizard2_no_offers` },
      underKey: `${K}wizard2_under`,
      buttons: [{ id: 'back', key: `${K}wizard_back` }, { id: 'next', key: `${K}wizard_next` }],
    };
  }
  return {
    step: n, head,
    titleKey: `${K}wizard3_title`, textKey: `${K}wizard3_text`,
    boxKey: `${K}chat_ephemeral`,
    chat: { on: chat === true, key: `${K}wizard3_switch` },
    underKey: `${K}wizard3_under`,
    buttons: [{ id: 'back', key: `${K}wizard_back` }, { id: 'done', key: `${K}wizard_done` }],
  };
}

/**
 * The card's tags, the same in the wizard and the card editor: the offer chips still listed when the card is saved, and
 * only with the offers switch on. A prefill the person saw, never computed at send (a card is authored, never derived).
 * @param {{showOffers?: boolean, tags?: string[]}} [a]
 * @returns {string[]}
 */
export function nearbyCardTags({ showOffers = false, tags = [] } = {}) {
  if (showOffers !== true || !Array.isArray(tags)) return [];
  return tags.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
}

/**
 * One press in the wizard, run through the host's own acts. Returns where the wizard goes next: `{step}` (still open),
 * `{done: true}` (closed), or the same step with a `notice` when a write failed (nothing further is done then).
 *
 * - step 1 `yes`: the menu's Zichtbaar (the level first; nothing is announced at a level that is not written), then step 2.
 * - step 1 `look`: the asked-mark only; closed.
 * - step 2 `next` with `{label, line, showOffers, tags}`: a name typed turns the card's switch on and shows the card, with
 *   the offer chips still listed as its tags when the switch is on; no name, no card. Then step 3.
 * - step 3 `done` with `{chat}`: the chat switch; closed.
 * - `back`: the step before.
 *
 * @param {{step: number}} state
 * @param {'yes'|'look'|'next'|'back'|'done'} press
 * @param {object} input  what the step's fields hold (step 2: `{label, line, showOffers, tags}`; step 3: `{chat}`)
 * @param {{now?: object, setLevel?: Function, setQuiet?: Function, setRadio?: Function,
 *   markAsked?: Function, setAllow?: Function, showCard?: Function}} acts  the host's: `now` = `{level, visibility}` for
 *   `nearbyHereChoose`; `setAllow(key, value)`; `showCard({label, line, tags})` → `{ok, notice?}`
 * @returns {Promise<{step?: number, done?: boolean, notice?: string}>}
 */
export async function nearbyWizardPress(state, press, input = {}, acts = {}) {
  const step = Math.min(Math.max(1, Number(state?.step) || 1), NEARBY_WIZARD_STEPS);
  if (press === 'back') return { step: Math.max(1, step - 1) };
  if (step === 1 && press === 'look') { acts.markAsked?.(); return { done: true }; }
  if (step === 1 && press === 'yes') {
    const r = await nearbyHereChoose('visible', acts.now ?? {}, acts);
    if (!r.ok) return { step, notice: 'level_not_set' };
    acts.markAsked?.();
    return { step: 2 };
  }
  if (step === 2 && press === 'next') {
    const label = typeof input.label === 'string' ? input.label.trim() : '';
    if (label) {
      acts.setAllow?.('card', true);
      // the offers are a PREFILL the person sees (removable chips), never derived at send: what is still listed when the card
      // is saved goes as its tags, and only with the switch on (a card is authored, never derived: nearbyRoom's createCard)
      const tags = nearbyCardTags(input);
      let r = null;
      try { r = await acts.showCard?.({ label, line: typeof input.line === 'string' ? input.line.trim() : '', tags }); } catch { r = null; }
      if (r && r.ok === false && r.notice) return { step, notice: r.notice };
    }
    return { step: 3 };
  }
  if (step === 3 && press === 'done') { acts.setAllow?.('chat', input.chat === true); return { done: true }; }
  return { step };
}
