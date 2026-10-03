/**
 * screenView — a SCREEN connecting to a household bot (the person's own app, in a browser, with no account of its own).
 *
 * The person typed `/scherm` and got a one-time link (the bot's address, its relay, a nonce). Opened here:
 *   1. the link is read and NOTHING is sent: the shell shows which bot, and waits for the person's tap (a preview
 *      service that opens the page sends nothing);
 *   2. on the tap, a key for this browser (kept like a device key) sends the bot its offer over the relay, and the
 *      screen shows the CODE — the fingerprint of its key and the link's nonce — which the bot shows the person in their
 *      private chat with "is this the code on your screen?";
 *   3. after their yes the bot's grant arrives (one capability token per op of the person's role, acting as them); it is
 *      checked (`acceptConnectionGrant`) and kept, so a later visit acts without pairing again;
 *   4. the screen acts by calling the bot's ops with those tokens (`sa.peer.invoke`) — the bot's door decides each call
 *      as the person, the same gate as their typed line.
 *
 * Pure composition: the secure agent is made by the shell (`makeAgent`, a persistent key for this browser), the
 * tokens are kept in the shell's storage. Nothing here touches a page.
 */
import { DataPart } from '@onderling/core';
import { encodePairingOffer, acceptConnectionGrant, CONNECTION_GRANT_SUBTYPE } from './connectionPairing.js';
import { parseScreenLink, parseScreenStartLink, screenCode, SCREEN_LINK_TTL_MS } from './botScreens.js';
import { SCREEN_STEP_UP_SUBTYPE, SCREEN_STEP_UP_TTL_MS, SCREEN_STEP_UP_UNANSWERED } from './screenStepUp.js';
import { SCREEN_NUDGE_SUBTYPE } from './screenNudge.js';

/** The peer-message subtype a screen's offer travels as (the bot's router takes it). */
export const SCREEN_OFFER_SUBTYPE = 'screen-offer';
/** What the bot tells a screen whose offer was not taken (a wrong code, "none of these", too late, replaced). */
export const SCREEN_REFUSED_SUBTYPE = 'screen-offer-refused';

const storeKey = (botAddress) => `onderling.screen.${botAddress}`;
const randomNonce = () => { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };

/**
 * Is this address a screen's? `#scherm=<link>` (pairing: the one-time link) or `#scherm-bot=<address>` (a later visit:
 * the address bar keeps only the bot's address — the link's secret is removed as soon as it is read).
 */
export function isScreenAddress(hash) {
  return /#scherm(?:-bot|-nieuw)?=/.test(String(hash ?? ''));
}
/** The address a screen keeps in its address bar once the link is read: the bot's, no secret. */
export const screenAddressFor = (botAddress) => `#scherm-bot=${encodeURIComponent(botAddress)}`;

/**
 * @param {object} a
 * @param {string} a.link  the address the screen was opened at (its `#scherm=` fragment), or a stored bot address
 * @param {() => Promise<object>} a.makeAgent  a secure agent (`createSecureAgent`, `transportMode: 'relay'`) with this browser's
 *   persistent key
 * @param {{getItem: Function, setItem: Function, removeItem?: Function}} a.storage  where the grant is kept
 * @param {(fn: Function, ms: number) => any} [a.setTimer]
 * @param {(h: any) => void} [a.clearTimer]
 */
export function createScreenView({ link, makeAgent, storage, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) }) {
  const load = (botAddress) => { try { return JSON.parse(storage.getItem(storeKey(botAddress)) ?? 'null'); } catch { return null; } };
  // a later visit (`#scherm-bot=`): the bot's address, and the relay from the grant this browser kept
  const resolve = () => {
    const kept = /#scherm-bot=([^&]+)/.exec(String(link ?? ''));
    if (!kept) {
      // the paste route: the screen makes its own connect code (the person pastes it into their chat)
      const start = parseScreenStartLink(link);
      if (start.ok) return { ...start, nonce: null, pasteMode: true };
      return parseScreenLink(link);
    }
    const botAddress = decodeURIComponent(kept[1]);
    const rec = load(botAddress);
    return rec ? { ok: true, botAddress, relayUrl: rec.relayUrl ?? null, nonce: null, resumeOnly: true } : { ok: false, reason: 'no-kept-grant' };
  };
  const parsed = resolve();
  const kept = () => (parsed.ok ? load(parsed.botAddress) : null);
  let sa = null;
  let granted = null;          // { tokens, label, botAddress }
  let resolveGrant = null;
  let rejectGrant = null;
  const grantArrived = new Promise((resolve, reject) => { resolveGrant = resolve; rejectGrant = reject; });
  grantArrived.catch(() => { /* a refusal nobody awaits yet is not an unhandled rejection */ });
  // what the bot says later about a request that waited for a yes in the person's chat (`{outcome, op}`)
  const notices = new Set();
  const emit = (notice) => { for (const fn of notices) { try { fn(notice); } catch { /* a listener's fault is its own */ } } };
  // a call the bot holds for the person's yes: the screen waits its own ten minutes, then says "no answer" itself
  let waiting = null;
  const stopWaiting = () => { if (waiting) { clearTimer(waiting); waiting = null; } };
  // the bot's nudge: something in the household changed (it names nothing; the screen reads again)
  const nudges = new Set();
  const noticeOf = ({ from, payload } = {}) => {
    if (from === parsed.botAddress && payload?.subtype === SCREEN_NUDGE_SUBTYPE) {
      for (const fn of nudges) { try { fn(); } catch { /* a listener's fault is its own */ } }
      return true;
    }
    if (from !== parsed.botAddress || payload?.subtype !== SCREEN_STEP_UP_SUBTYPE) return false;
    stopWaiting();
    emit({ outcome: String(payload.outcome ?? ''), op: typeof payload.op === 'string' ? payload.op : null });
    return true;
  };

  return {
    /** What the link says (bot address, relay): `{ok, botAddress, relayUrl}` or `{ok: false, reason}`. No secret in it. */
    get link() { return parsed.ok ? { ok: true, botAddress: parsed.botAddress, relayUrl: parsed.relayUrl, botName: parsed.botName ?? kept()?.botName ?? null, resumeOnly: Boolean(parsed.resumeOnly), pasteMode: Boolean(parsed.pasteMode) } : parsed; },

    /** A grant this browser already holds for this bot (a later visit), or null. */
    stored: () => (parsed.ok ? load(parsed.botAddress) : null),

    /**
     * The person tapped "connect": the key, the relay, the offer — and the code to compare in their chat. Resolves once
     * the offer is sent; `granted()` resolves when the bot's grant arrives (after the person's yes).
     * @returns {Promise<{code: string}>}
     */
    /**
     * The person tapped "connect" (the link) or "make a connect code" (the paste route). Resolves once the offer is out —
     * sent over the relay, or, on the paste route, as `offer` for the person to copy into their own chat — with the code
     * to pick. `granted()` resolves when the bot's grant arrives.
     * @returns {Promise<{code: string, offer?: string}>}
     */
    async connect({ label = null } = {}) {
      if (!parsed.ok || parsed.resumeOnly) throw new Error(`screenView: not a screen link (${parsed.reason ?? 'a kept grant resumes, it does not pair'})`);
      if (parsed.pasteMode) parsed.nonce = randomNonce();
      sa = await makeAgent();
      const viewPubKey = sa.agent.pubKey;
      await sa.relay.connect({
        relayUrl: parsed.relayUrl,
        onPeerMessage: ({ from, payload } = {}) => {
          // only the bot this screen offered to speaks for it: a grant- or refusal-shaped message from any other key is
          // not this pairing's (its tokens would fail at the door — confusion, not access — but it would look connected)
          if (from !== parsed.botAddress) return;
          if (noticeOf({ from, payload })) return;
          if (payload?.subtype === SCREEN_REFUSED_SUBTYPE) { rejectGrant(new Error('refused')); return; }
          if (payload?.subtype !== CONNECTION_GRANT_SUBTYPE) return;
          const r = acceptConnectionGrant(payload, { nonce: parsed.nonce, viewPubKey });
          if (!r.ok) return;
          granted = { botAddress: parsed.botAddress, relayUrl: parsed.relayUrl, botName: parsed.botName ?? null, tokens: r.tokens, label: r.label ?? null };
          try { storage.setItem(storeKey(parsed.botAddress), JSON.stringify(granted)); } catch { /* kept for this visit only */ }
          resolveGrant(granted);
        },
      });
      const offer = encodePairingOffer({ viewPubKey, relayUrl: parsed.relayUrl, nonce: parsed.nonce, label });
      const code = await screenCode(viewPubKey, parsed.nonce);
      if (parsed.pasteMode) return { code, offer };   // nothing sent: the person carries the offer to their own chat
      await sa.peer.sendTo(parsed.botAddress, { subtype: SCREEN_OFFER_SUBTYPE, offer });
      return { code };
    },

    /** A later visit: this browser's key and the grant it kept, back on the relay — no pairing again. */
    async resume() {
      const kept = parsed.ok ? load(parsed.botAddress) : null;
      if (!kept) return false;
      sa = await makeAgent();
      await sa.relay.connect({ relayUrl: parsed.relayUrl, onPeerMessage: noticeOf });
      granted = kept;
      resolveGrant(granted);
      return true;
    },

    /**
     * Resolves with the grant once the bot sent it (the person picked the right code); rejects with `refused` (the bot
     * said it was not taken) or `timed-out` (nothing within the link's ten minutes) — never waits for ever.
     */
    granted: ({ timeoutMs = SCREEN_LINK_TTL_MS } = {}) => Promise.race([
      grantArrived,
      new Promise((_, reject) => { const h = setTimeout(() => reject(new Error('timed-out')), timeoutMs); h?.unref?.(); }),
    ]),

    /**
     * Hear what became of a request that waited for a yes in the person's own chat: `fn({outcome, op})`, outcome one of
     * done · declined · expired · replaced · failed. Returns the unsubscribe.
     */
    onNotice(fn) { notices.add(fn); return () => notices.delete(fn); },

    /** Hear the bot's nudge (something in the household changed; it names nothing). Returns the unsubscribe. */
    onNudge(fn) { nudges.add(fn); return () => nudges.delete(fn); },

    /** The ops this screen may call (`app.op`), from the grant. */
    ops: () => (granted?.tokens ?? []).map((t) => t.skill),

    /**
     * Call one of the bot's ops as the person (the bot's door decides it). Returns the op's answer.
     * @param {string} skill  `app.op`
     * @param {object} [args]
     */
    async call(skill, args = {}) {
      if (!granted) throw new Error('screenView: not connected');
      const token = granted.tokens.find((t) => t.skill === skill);
      if (!token) throw new Error(`screenView: no grant for ${skill}`);
      const parts = await sa.peer.invoke(granted.botAddress, skill, [DataPart(args)], { token });
      const data = (parts ?? []).map((p) => p?.data ?? p?.content).find((d) => d && typeof d === 'object');
      if (data?.pending === true) {
        stopWaiting();
        waiting = setTimer(() => { waiting = null; emit({ outcome: SCREEN_STEP_UP_UNANSWERED, op: skill.split('.').pop() }); }, SCREEN_STEP_UP_TTL_MS);
      }
      return data ?? null;
    },
  };
}
