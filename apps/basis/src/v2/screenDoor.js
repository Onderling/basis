/**
 * THE SCREEN DOOR — the one place a screen's pairing offer is asked about, picked and refused, for every door that
 * grants a screen: the household bot (`botScreens.js`, the person answers in their private chat) and the person's own
 * app ('Apparaten & sleutels', the person pastes or scans the offer the screen shows).
 *
 * A screen makes its own throwaway key and nonce and SHOWS its offer and its CODE (a fingerprint of the key and the
 * nonce). The offer is not a secret and not a credential: anyone holding it can only ask to be granted. So nothing is
 * granted on the offer alone: the person is shown THREE codes and must PICK the one their screen shows. The code is not
 * a secret either (anyone holding the offer can compute it); what the pick proves is that the person looked at THEIR
 * screen. A planted offer ("paste this") yields a code the person cannot find on any screen of theirs.
 *
 * What the door holds per owner (the person on the bot, the app itself on a device): ONE pending offer, with its
 * lifetime (`SCREEN_PAIRING_TTL_MS`); a second offer replaces the first. What it refuses, each said in the refusal log
 * with a code from the closed set (`SCREEN_PAIRING_REFUSAL_CODES`):
 *   - `pairing-not-an-offer`    no key or no nonce;
 *   - `pairing-other-relay`     the screen waits on a relay this device is not on (its grant could never reach it);
 *   - `pairing-nonce-replayed`  an offer whose nonce was already granted here;
 *   - `pairing-nothing-pending` a pick with no offer waiting;
 *   - `pairing-expired`         a pick after the offer's lifetime;
 *   - `pairing-wrong-code`      a pick that is not the screen's code (or "none of these").
 * The pending offer is gone after any answer, right or wrong: one try per offer.
 *
 * Pure composition: where the pending offer is kept (`pending`) and which nonces were used (`used`) are handed in.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { sha256Hex } from './botAdmission.js';
import { processRefusalLog, SCREEN_PAIRING_REFUSAL_CODES } from './refusalLog.js';

/** How long an offer waits for the person's pick (the bot's one-time link lives as long). */
export const SCREEN_PAIRING_TTL_MS = param({ key: 'screen.pairingTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1000 });

/** The door's refusals: the refusal log's closed set holds the list (one home), re-exported for the door's readers. */
export { SCREEN_PAIRING_REFUSAL_CODES };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L: read aloud, typed, compared at a glance

/**
 * The code a person compares between the door and the screen: a short fingerprint of the screen's key and the offer's
 * nonce. Both sides compute it from what they hold; neither sends it.
 */
export async function screenCode(viewPubKey, nonce) {
  const hex = await sha256Hex(`${viewPubKey}|${nonce}`);
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % CODE_ALPHABET.length];
  return out;
}

/** Two other codes beside the real one, the three shuffled: the person must PICK the code their screen shows. */
export function codeChoices(real, rand = Math.random) {
  const pick = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]).join('');
  const set = new Set([real]);
  for (let tries = 0; set.size < 3 && tries < 50; tries++) set.add(pick());
  // a random source that keeps repeating itself still yields three distinct codes (and never loops)
  for (let i = 0; set.size < 3; i++) set.add([...real].map((ch, k) => CODE_ALPHABET[(CODE_ALPHABET.indexOf(ch) + i + 1 + k) % CODE_ALPHABET.length]).join(''));
  const out = [...set];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** A screen's label is someone else's text: one line, 40 characters at most. */
export const screenLabel = (label) => String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || null;

const sameRelay = (a, b) => String(a ?? '').replace(/\/+$/, '').toLowerCase() === String(b ?? '').replace(/\/+$/, '').toLowerCase();

/**
 * An in-memory set of used nonces, each kept until its own time. In memory only, on purpose: after a restart a spent
 * offer can be asked about again, but it still needs the right pick, and the screen's key is its own throwaway one, so
 * a replay grants nothing a fresh pairing would not (accepted, 2026-11-15).
 */
export function memoryUsedNonces({ now = Date.now } = {}) {
  const m = new Map();
  return {
    has: (nonce) => { const t = now(); for (const [k, until] of m) if (until < t) m.delete(k); return m.has(nonce); },
    add: (nonce, until) => { m.set(nonce, until); },
  };
}

/**
 * @param {object} a
 * @param {{get: (owner: string) => object|null, set: (owner: string, rec: object|null) => void}} a.pending
 *   where the one pending offer per owner lives (`{viewPubKey, nonce, label, until}`)
 * @param {{has: (nonce: string) => boolean, add: (nonce: string, until: number) => void}} [a.used]  nonces granted here
 * @param {() => string[]|null} [a.relays]  the relays this device is on (null: not checked, e.g. the bot answers on its own)
 * @param {(r: {check: string, reason: string}) => void} [a.note]  the refusal log (default: the process's)
 * @param {() => number} [a.now]
 * @param {() => number} [a.rand]
 */
export function createScreenDoor({ pending, used = null, relays = null, note = null, now = Date.now, rand = Math.random } = {}) {
  if (!pending || typeof pending.get !== 'function' || typeof pending.set !== 'function') throw new TypeError('createScreenDoor: pending {get, set} required');
  const say = (check, reason) => {
    try { (note ?? ((r) => processRefusalLog().note({ tag: 'screen', lane: 'pairing', ...r })))({ check, reason }); } catch { /* a report never breaks the door */ }
    return { ok: false, reason };
  };
  return {
    /**
     * An offer arrived (pasted, scanned, or over the relay to the bot): checked, kept as the owner's ONE pending offer
     * (a second replaces the first), and the three codes to pick from returned. Nothing is granted. The REAL code is not
     * in the answer: a caller that held it could mark it on the person's screen, and the pick would prove nothing.
     * @returns {Promise<{ok: true, codes: string[], previous: object|null}|{ok: false, reason: string}>}
     */
    async ask(owner, { viewPubKey, nonce, label = null, relayUrl = null } = {}) {
      if (typeof viewPubKey !== 'string' || !viewPubKey || typeof nonce !== 'string' || !nonce) return say('offer', 'pairing-not-an-offer');
      const mine = typeof relays === 'function' ? relays() : null;
      if (relayUrl && Array.isArray(mine) && mine.length && !mine.some((r) => sameRelay(r, relayUrl))) return say('offer', 'pairing-other-relay');
      if (used?.has?.(nonce)) return say('offer', 'pairing-nonce-replayed');
      const previous = pending.get(owner) ?? null;
      const code = await screenCode(viewPubKey, nonce);
      pending.set(owner, { viewPubKey, nonce, label: screenLabel(label), relayUrl: relayUrl ?? null, until: now() + SCREEN_PAIRING_TTL_MS });
      return { ok: true, codes: codeChoices(code, rand), previous };
    },
    /** The owner's pending offer (or null). */
    pendingOf: (owner) => pending.get(owner) ?? null,
    /** Drop the owner's pending offer (revoked, cancelled). */
    drop: (owner) => { pending.set(owner, null); },
    /**
     * The person's pick. One try: the pending offer is gone after any answer. Only the screen's own code, in time,
     * returns the offer to grant; the nonce is then spent (a replay of the same offer is refused).
     * @returns {Promise<{ok: true, offer: object}|{ok: false, reason: string, offer?: object}>}
     */
    async answer(owner, picked) {
      const offer = pending.get(owner) ?? null;
      if (!offer) return say('pick', 'pairing-nothing-pending');
      pending.set(owner, null);
      if (!(offer.until >= now())) return { ...say('pick', 'pairing-expired'), offer };
      const real = await screenCode(offer.viewPubKey, offer.nonce);
      if (String(picked ?? '').trim().toUpperCase() !== real) return { ...say('pick', 'pairing-wrong-code'), offer };
      try { used?.add?.(offer.nonce, now() + 2 * SCREEN_PAIRING_TTL_MS); } catch { /* the grant still goes; a replay is then not caught here */ }
      return { ok: true, offer };
    },
  };
}
