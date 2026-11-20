/**
 * THE APP'S SCREEN PAIRING ('Apparaten & sleutels' → connect a screen), the one path both shells take from a screen's
 * offer to `grantSurface`. The screen shows its own throwaway offer and its code; the person pastes the offer (or scans
 * it, on the phone); the app shows three codes and the person PICKS the one their screen shows (the screen door,
 * `screenDoor.js`, the same door the household bot asks through); only then does the app show what the screen may see
 * and do, and only a grant that follows a right pick reaches `grantSurface`. There is no other way in: a shell holds
 * this pairing, never the op (`lint-screen-pairing-door`).
 *
 * Steps, each answering `{ok}` or `{ok: false, reason}` (a reason the shells word with `circle.mydata.connection_<reason>`):
 *   offer(text)       → the offer read and asked about: `{ok, codes, label}` (the parse's own reasons, or the door's);
 *   pick(code)        → the person's pick: `{ok}` (the ticks may now be shown) or the door's refusal;
 *   grant({ops, sections, persona}) → `grantSurface`, only after a right pick (`pairing-no-pick` otherwise; one grant
 *                       per pick); `{ok: false, reason: 'nothing-picked'}` for ticks that grant nothing;
 *   cancel()          → drop the pending offer and the pick.
 */
import { parsePairingOffer, CONNECT_SCHEME } from './connectionPairing.js';
import { compileConnectionGrant } from './connections.js';
import { createScreenDoor, memoryUsedNonces, SCREEN_PAIRING_REFUSAL_CODES } from './screenDoor.js';

/** The reasons a shell words as `circle.mydata.connection_offer_<reason>`: anything else is said as 'grant-failed'. */
const WORDED = new Set([...SCREEN_PAIRING_REFUSAL_CODES, 'pairing-no-pick', 'nothing-picked', 'grant-failed', 'not-a-connect-uri', 'unreadable', 'wrong-version', 'incomplete', 'toolbox-page']);
const worded = (reason) => (WORDED.has(reason) ? reason : 'grant-failed');

/** What the phone's scanner reads on 'Apparaten & sleutels' → connect a screen: a screen's offer only (Me → Scan does not
 *  route it: a screen is connected from here, where the code pick follows). */
export const SCREEN_OFFER_CLASSIFIERS = Object.freeze([
  { kind: 'connect', classify: (t) => (typeof t === 'string' && t.trim().startsWith(CONNECT_SCHEME) ? t.trim() : null) },
]);

const OWNER = 'app';   // the app pairs for this device: one pending offer at a time

/**
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill  the waist (`grantSurface` is called here, never in a shell)
 * @param {() => string[]|null} [a.relays]  the relays this device is on (an offer for another is refused)
 * @param {object} [a.door]  a screen door (default: this pairing's own, pending in memory)
 * @param {() => number} [a.now]
 */
export function createAppScreenPairing({ callSkill, relays = null, door = null, now = Date.now, rand = Math.random } = {}) {
  if (typeof callSkill !== 'function') throw new TypeError('createAppScreenPairing: callSkill required');
  let slot = null;
  const theDoor = door ?? createScreenDoor({
    pending: { get: () => slot, set: (_o, rec) => { slot = rec; } },
    used: memoryUsedNonces({ now }), relays, now, rand,
  });
  let picked = null;   // the offer a right pick released, until its grant (or a new offer)
  return {
    async offer(text) {
      picked = null;
      const parsed = parsePairingOffer(String(text ?? '').trim());
      if (!parsed.ok) return parsed;
      // a TOOLBOX'S PAGE (its offer names a toolbox or carries a ticket) pairs with the household's bot that holds the
      // toolbox, from the link `/scherm <toolbox>` sends, never here as a plain screen of this app (L1113): refused in words
      if (parsed.toolbox || parsed.ticket) return { ok: false, reason: 'toolbox-page' };
      const asked = await theDoor.ask(OWNER, parsed);
      if (!asked.ok) return asked;
      return { ok: true, codes: asked.codes, label: parsed.label ?? null, viewPubKey: parsed.viewPubKey };
    },
    async pick(code) {
      const r = await theDoor.answer(OWNER, code);
      if (!r.ok) { picked = null; return { ok: false, reason: r.reason }; }
      picked = r.offer;
      return { ok: true, label: r.offer.label ?? null };
    },
    /** Whether a right pick has released the ticks. */
    get picked() { return picked != null; },
    async grant({ ops = [], sections = [], persona = null } = {}) {
      if (!picked) return { ok: false, reason: 'pairing-no-pick' };
      const args = compileConnectionGrant({ viewPubKey: picked.viewPubKey, ops, sections, label: picked.label, persona });
      if (!args) return { ok: false, reason: 'nothing-picked' };
      const offer = picked;
      picked = null;   // one grant per pick
      let r = null;
      try { r = await callSkill('household', 'grantSurface', { ...args, nonce: offer.nonce }); } catch { return { ok: false, reason: 'grant-failed' }; }
      // the op's own error text is not a sentence: the person reads 'could not connect', the detail stays here
      return r?.ok === false ? { ok: false, reason: worded(r.error), ...(r.error ? { detail: String(r.error) } : {}) } : { ok: true };
    },
    cancel() { picked = null; theDoor.drop(OWNER); },
  };
}
