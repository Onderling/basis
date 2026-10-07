/**
 * botScreens — a person on a household bot connects a SCREEN (their own app, in a browser) to act through.
 *
 * `/scherm` gives the person a one-time link (the bot's address and a nonce, ten minutes, for them alone); the screen
 * makes a key and sends the bot its offer with that nonce over the relay; the bot grants that key the person's ROLE
 * COLUMN — one capability token per op, each saying, signed, that it acts as that person — and tells the person in
 * their own chat. A screen's call then reaches the bot's door as that person (the gate, the role, the settings: the
 * same as a typed line). `/schermen` lists the person's screens and drops one; revoking the person drops them all.
 *
 * Holding the link is not enough: an offer is never granted on arrival. The person is asked, in their own PRIVATE chat,
 * to PICK the code their screen shows (a fingerprint of the screen's key and the link's nonce) from three, or "none of
 * these". Only the real code, from that private door, grants — a bare yes does not, so a link someone else used first
 * yields a code the person cannot find on their own screen; no answer within ten minutes drops
 * the offer; a second offer drops the first, and the person is told. A stolen or planted link yields a question the
 * person did not expect, with a code they cannot see on any screen of theirs.
 *
 * Opened INSIDE Telegram (the "Open het scherm" button in the person's own chat, a Mini App), a screen proves who opened it
 * with Telegram's signed launch data instead (`telegramLaunch.js`): no link exists to steal, so there is no code to pick.
 * Checked, used once, for an admitted person only, it gets the same grant the pick gives. One Telegram-launched screen
 * per person: a new launch replaces the earlier one (its key revoked, the person told); the same key again is the same.
 *
 * The nonce is kept as its HASH on the person's thread row (as admission codes are), one pending per person.
 * Pure composition: the grants, the role column and the notice are handed in.
 */
import { sha256Hex } from './botAdmission.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { TELEGRAM_LAUNCH_MAX_AGE_S } from './telegramLaunch.js';

/**
 * The calls a household bot takes from its connected screens: per screen a burst, then so many a second; and from all
 * screens together. A person ticking off the shopping on their screen costs a call per tick plus a read of the household
 * (a call per list): the secure agent's own default (30, then 1 a second) answered "Even rustig" after a handful of ticks
 * (the every-button walk, 2026-10-05). Still a cap: a flood from one key, or from many, is refused.
 */
export const SCREEN_CALLS_PER_SECOND = param({ key: 'assistant.screenCallsPerSecond', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
export const SCREEN_CALL_BURST = param({ key: 'assistant.screenCallBurst', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 });
export const SCREEN_CALL_BUDGET = Object.freeze({
  perPeer: Object.freeze({ burst: SCREEN_CALL_BURST, refillPerSec: SCREEN_CALLS_PER_SECOND }),
  global: Object.freeze({ burst: SCREEN_CALL_BURST * 2.5, refillPerSec: SCREEN_CALLS_PER_SECOND * 5 }),
});

/** How long a `/scherm` link may be used (once). */
export const SCREEN_LINK_TTL_MS = param({ key: 'assistant.screenLinkTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1000 });

const randomNonce = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L: read aloud, typed, compared at a glance
/**
 * The code a person compares between their chat and the screen: a short fingerprint of the screen's key and the link's
 * nonce. Both sides compute it from what they hold; neither sends it.
 */
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

export async function screenCode(viewPubKey, nonce) {
  const hex = await sha256Hex(`${viewPubKey}|${nonce}`);
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % CODE_ALPHABET.length];
  return out;
}

/** A connected screen's own address, for a later visit (`#scherm-bot=<address>`): the browser resumes the grant it kept. */
export const screenAddressFor = (botAddress) => `#scherm-bot=${encodeURIComponent(botAddress)}`;

/**
 * Where a person finds their screen again once it is connected: the app with the bot's address (no secret — only the
 * browser that holds the grant opens it). Null without an app address.
 */
export function screenReopenLink(appUrl, botAddress) {
  if (!appUrl || !botAddress) return null;
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/${screenAddressFor(botAddress)}`;
}

/** The `/scherm` link's fragment: the bot's address, its relay and the nonce. No authority — a screen still needs the grant. */
export function encodeScreenLink(appUrl, { botAddress, relayUrl = null, nonce, botName = null }) {
  const body = b64url(JSON.stringify({ v: 1, b: botAddress, ...(relayUrl ? { r: relayUrl } : {}), n: nonce, ...(botName ? { m: botName } : {}) }));
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/#scherm=${body}`;
}
/** @returns {{ok: true, botAddress: string, relayUrl: string|null, nonce: string}|{ok: false, reason: string}} */
export function parseScreenLink(link) {
  const m = /#scherm=([A-Za-z0-9_-]+)/.exec(String(link ?? ''));
  if (!m) return { ok: false, reason: 'not-a-screen-link' };
  let d; try { d = JSON.parse(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1) return { ok: false, reason: 'wrong-version' };
  if (typeof d.b !== 'string' || !d.b || typeof d.n !== 'string' || !d.n) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, nonce: d.n, botName: typeof d.m === 'string' && d.m ? d.m : null };
}

/**
 * The address a screen opens to make its OWN connect code (the paste route, `/koppel-scherm`): the bot's address, its
 * relay and its name — no nonce, no secret. The screen makes a key and a nonce, shows its offer to copy and the code to
 * pick, and the person pastes the offer into their own chat.
 */
export function encodeScreenStartLink(appUrl, { botAddress, relayUrl = null, botName = null }) {
  const body = b64url(JSON.stringify({ v: 1, b: botAddress, ...(relayUrl ? { r: relayUrl } : {}), ...(botName ? { m: botName } : {}) }));
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/#scherm-nieuw=${body}`;
}
/** @returns {{ok: true, botAddress: string, relayUrl: string|null, botName: string|null}|{ok: false, reason: string}} */
export function parseScreenStartLink(link) {
  const m = /#scherm-nieuw=([A-Za-z0-9_-]+)/.exec(String(link ?? ''));
  if (!m) return { ok: false, reason: 'not-a-start-link' };
  let d; try { d = JSON.parse(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1 || typeof d.b !== 'string' || !d.b) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, botName: typeof d.m === 'string' && d.m ? d.m : null };
}

/**
 * The address Telegram opens for the "Open het scherm" button: the bot's address, relay and name in the QUERY (Telegram
 * puts its launch data in the fragment). No secret: what connects is the launch data Telegram signs.
 */
export function encodeScreenLaunchLink(appUrl, { botAddress, relayUrl = null, botName = null }) {
  const body = b64url(JSON.stringify({ v: 1, b: botAddress, ...(relayUrl ? { r: relayUrl } : {}), ...(botName ? { m: botName } : {}) }));
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/?scherm-tg=${body}`;
}
/** @returns {{ok: true, botAddress: string, relayUrl: string|null, botName: string|null}|{ok: false, reason: string}} */
export function parseScreenLaunchLink(link) {
  const m = /[?&]scherm-tg=([A-Za-z0-9_-]+)/.exec(String(link ?? ''));
  if (!m) return { ok: false, reason: 'not-a-launch-link' };
  let d; try { d = JSON.parse(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1 || typeof d.b !== 'string' || !d.b) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, botName: typeof d.m === 'string' && d.m ? d.m : null };
}

/**
 * @param {object} a
 * @param {object} a.threads  the bot's thread rows (`screenNonceOf` / `setScreenNonce` / `screenNonceOwner`)
 * @param {(person: string) => Promise<boolean>} a.isAdmitted  the person is in the book (not revoked)
 * @param {(person: string) => Promise<string[]>} a.columnOf  the op ids (`app.op`) this person's role reaches, minus
 *   what a screen never gets (the shell decides; the admin's own ops are not minted)
 * @param {(person: string, text: string, rememberAs: string|null, buttons?: object[]|null) => Promise<{ok: boolean, reason?: string}>} a.sendPrivately
 *   the person's PRIVATE door (their own chat, their inbox) — never the chat `/scherm` was typed in, which may be a
 *   group; `rememberAs` is what their thread keeps instead of the link (a secret does not belong in memory)
 * @param {(g: {viewPubKey: string, ops: string[], actingAs: string, label: string, nonce: string}) => Promise<object>} a.grant
 * @param {(viewPubKey: string) => Promise<boolean>} a.revokeView
 * @param {() => Promise<Array<{viewPubKey: string, label: string|null, ops: string[], actingAs?: string}>>} a.listGrants
 * @param {(person: string, key: string, params?: object) => Promise<void>|void} [a.notify]  a line in the person's chat
 * @param {(person: string, q: {codes: string[], replaced: boolean}) => Promise<{ok: boolean}>} a.ask  the question, to
 *   the person's PRIVATE door: three codes (the real one and two others) to pick from, and "none of these"
 * @param {(viewPubKey: string) => Promise<void>|void} [a.tellRefused]  tells the screen its offer was not taken
 * @param {() => {appUrl: string|null, botAddress: string|null, relayUrl: string|null}} a.where
 * @param {(initData: string) => Promise<{ok: boolean, telegramId?: string, hash?: string, reason?: string}>} [a.verifyLaunch]
 *   checks Telegram's launch data (the bot's token is in it; `verifyTelegramLaunch`)
 * @param {(telegramId: string) => Promise<string|null>} [a.personOfTelegram]  the ADMITTED person with this Telegram id
 * @param {(person: string) => {label: string, webApp: string}|null} [a.launchButton]  the "Open het scherm" button for
 *   this person's private chat (a Telegram person, an app address Telegram opens), or null
 * @param {(person: string) => string} [a.launchLabel]  what `/schermen` calls a Telegram-launched screen
 * @param {() => number} [a.now]
 */
export function createBotScreens({ threads, isAdmitted, columnOf, grant, revokeView, listGrants, notify = null, ask = null, tellRefused = null, sendPrivately, where, verifyLaunch = null, personOfTelegram = null, launchButton = null, launchLabel = () => 'Telegram', now = Date.now, rand = Math.random }) {
  const mine = async (person) => ((await listGrants()) ?? []).filter((g) => g?.actingAs === person);
  // a launch's hash, used: kept until no launch that old is taken anyway
  const usedLaunches = new Map();
  const spend = (hash) => {
    const t = now();
    for (const [h, until] of usedLaunches) if (until < t) usedLaunches.delete(h);
    if (usedLaunches.has(hash)) return false;
    usedLaunches.set(hash, t + 2 * TELEGRAM_LAUNCH_MAX_AGE_S * 1000);
    return true;
  };
  const buttonsFor = (person) => { const b = typeof launchButton === 'function' ? launchButton(person) : null; return b ? [b] : null; };

  /** The grant, for an offer the person vouched for (the code they picked, or a launch Telegram signed): their role's column, as them. */
  async function grantTo(person, { viewPubKey, label, nonce }) {
    const ops = await columnOf(person);
    if (!ops.length) return { ok: false, reason: 'nothing-to-grant' };
    const r = await grant({ viewPubKey, ops, actingAs: person, label, nonce });
    if (r?.ok === false) return { ok: false, reason: r.error ?? 'grant-failed' };
    try { await notify?.(person, 'circle.bot.screen_connected', { n: ops.length }); } catch { /* the grant stands; /schermen shows it */ }
    return { ok: true, person, ops };
  }

  /** The question, for an offer from either route: the code to pick from three, in the person's private door. */
  async function askAbout(person, { viewPubKey, nonce, label }) {
    if (typeof ask !== 'function') return { ok: false, reason: 'no-private-door' };
    const previous = threads.screenOfferOf(person);   // a second offer drops the first, and its screen is told —
    // unless it IS this screen (a reload, a second /scherm on the same browser): the screen asking now must not be the
    // one told it was refused, or it gives up on the offer it just made
    if (previous && previous.viewPubKey !== viewPubKey) { try { await tellRefused?.(previous.viewPubKey); } catch { /* the screen times out on its own */ } }
    const code = await screenCode(viewPubKey, nonce);
    threads.setScreenOffer(person, { viewPubKey, nonce, label: screenLabel(label) ?? 'scherm', until: now() + SCREEN_LINK_TTL_MS });
    const asked = await ask(person, { codes: codeChoices(code, rand), replaced: Boolean(previous) });
    if (!asked?.ok) { threads.setScreenOffer(person, null); return { ok: false, reason: asked?.reason ?? 'not-reachable' }; }
    return { ok: true, pending: true, person, code };
  }

  return {
    /**
     * `/scherm`: a fresh one-time link for this person (the previous pending one stops working), sent to their PRIVATE
     * door only — a group must never see it. `text(link, minutes)` words it in the person's language; `remembered` is
     * what their thread keeps instead (never the link).
     */
    async start(person, text, remembered = null) {
      const { appUrl, botAddress, relayUrl, botName = null } = where() ?? {};
      if (!appUrl || !botAddress) return { ok: false, reason: 'no-app-url' };
      if (typeof sendPrivately !== 'function') return { ok: false, reason: 'no-private-door' };
      const nonce = randomNonce();
      const until = now() + SCREEN_LINK_TTL_MS;
      threads.setScreenNonce(person, { hash: await sha256Hex(nonce), until });
      const link = encodeScreenLink(appUrl, { botAddress, relayUrl, nonce, botName });
      const sent = await sendPrivately(person, text(link, Math.round(SCREEN_LINK_TTL_MS / 60000)), remembered ?? '', buttonsFor(person));
      if (!sent?.ok) { threads.setScreenNonce(person, null); return { ok: false, reason: sent?.reason ?? 'not-reachable' }; }
      return { ok: true, until };
    },

    /**
     * The paste route (`/scherm` for the admin, by default): the person gets the address a screen opens to make its own
     * connect code — no secret travels through the chat; the screen's offer comes back pasted (`/koppel-scherm`).
     */
    async startPaste(person, text) {
      const { appUrl, botAddress, relayUrl, botName = null } = where() ?? {};
      if (!appUrl || !botAddress) return { ok: false, reason: 'no-app-url' };
      if (typeof sendPrivately !== 'function') return { ok: false, reason: 'no-private-door' };
      const sent = await sendPrivately(person, text(encodeScreenStartLink(appUrl, { botAddress, relayUrl, botName })), null, buttonsFor(person));
      return sent?.ok ? { ok: true } : { ok: false, reason: sent?.reason ?? 'not-reachable' };
    },

    /**
     * A screen's offer PASTED by the person into their own chat (`/koppel-scherm <offer>`). The person is the one who
     * pasted it; a pasted offer can be planted ("paste this into your bot") as a link can be stolen — so nothing is
     * granted here either: the same question, the code to pick from three.
     */
    async pasted(person, { viewPubKey, nonce, label = null }) {
      if (typeof viewPubKey !== 'string' || !viewPubKey || typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'not-an-offer' };
      if (typeof isAdmitted !== 'function' || !(await isAdmitted(person))) return { ok: false, reason: 'not-admitted' };
      return askAbout(person, { viewPubKey, nonce, label });
    },

    /**
     * A screen's offer arrived (over the relay, from `from`): the nonce names the person; one use, in time; the key
     * that sends the offer is the key it names. NOTHING is granted yet: the person is asked, privately, with the code.
     */
    async offer({ from, viewPubKey, nonce, label = null }) {
      if (typeof viewPubKey !== 'string' || !viewPubKey || viewPubKey !== from) return { ok: false, reason: 'wrong-sender' };
      if (typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'no-nonce' };
      const hash = await sha256Hex(nonce);
      const person = threads.screenNonceOwner(hash);
      if (!person) return { ok: false, reason: 'unknown-nonce' };
      const pending = threads.screenNonceOf(person);
      threads.setScreenNonce(person, null);   // one use, whatever happens next
      if (!pending || pending.until < now()) return { ok: false, reason: 'expired' };
      if (typeof isAdmitted !== 'function' || !(await isAdmitted(person))) return { ok: false, reason: 'not-admitted' };
      return askAbout(person, { viewPubKey, nonce, label });
    },

    /**
     * The person's answer to the question, from the door it came through: only their PRIVATE door counts (a yes in a
     * group is not accepted). Ja → the grant (their role's column, as them) and the notice; Nee, or too late → nothing.
     */
    async confirm(person, answer, { isPrivate = false } = {}) {
      const offer = threads.screenOfferOf(person);
      if (!offer) return { ok: false, reason: 'nothing-pending' };
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      threads.setScreenOffer(person, null);   // answered (or late): the offer is gone either way
      const refuse = async () => { try { await tellRefused?.(offer.viewPubKey); } catch { /* the screen times out on its own */ } };
      if (offer.until < now()) { await refuse(); return { ok: false, reason: 'expired' }; }
      // only the code the screen shows grants: a wrong code, "none of these", or a bare yes drops the offer
      const real = await screenCode(offer.viewPubKey, offer.nonce);
      if (String(answer ?? '').trim().toUpperCase() !== real) { await refuse(); return { ok: true, declined: true }; }
      if (typeof isAdmitted !== 'function' || !(await isAdmitted(person))) return { ok: false, reason: 'not-admitted' };
      const r = await grantTo(person, { viewPubKey: offer.viewPubKey, label: offer.label, nonce: offer.nonce });
      return r.ok ? { ...r, reopen: this.reopenLink() } : r;
    },

    /**
     * A screen opened inside Telegram offers with the launch data Telegram signed (sealed to this bot, from the key it
     * names). Taken once, fresh, from a private chat, for an admitted person — then the grant, as the pick gives it. A
     * stranger is refused (a launch admits nobody); a second launched screen replaces the first.
     */
    async launched({ from, viewPubKey, nonce, initData }) {
      if (typeof viewPubKey !== 'string' || !viewPubKey || viewPubKey !== from) return { ok: false, reason: 'wrong-sender' };
      if (typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'no-nonce' };
      if (typeof verifyLaunch !== 'function' || typeof personOfTelegram !== 'function') return { ok: false, reason: 'no-launch-route' };
      const refuse = async (reason) => { try { await tellRefused?.(viewPubKey); } catch { /* the screen times out on its own */ } return { ok: false, reason }; };
      const v = await verifyLaunch(initData);
      if (!v?.ok) return refuse(v?.reason ?? 'bad-launch');
      if (!spend(v.hash)) return refuse('used');
      const person = await personOfTelegram(v.telegramId);
      if (!person) return refuse('stranger');
      // one use per person across a restart too: a launch not newer than the last one taken is refused
      const last = threads.lastLaunchOf(person);
      if (last != null && v.authDate <= last) return refuse('used');
      threads.setLastLaunch(person, v.authDate);
      const previous = threads.telegramScreenOf(person);
      if (previous && previous !== viewPubKey) {
        await revokeView(previous);
        try { await notify?.(person, 'circle.bot.screen_launch_replaced', {}); } catch { /* the new grant still goes */ }
      }
      const r = await grantTo(person, { viewPubKey, label: launchLabel(person), nonce });
      if (r.ok) threads.setTelegramScreen(person, viewPubKey);
      return r;
    },

    /** Where the person's screens are, from now on: the app at this bot's address (null without an app address). */
    reopenLink() {
      const { appUrl, botAddress } = where() ?? {};
      return screenReopenLink(appUrl, botAddress);
    },

    /** `/schermen`: this person's screens, numbered as `/schermen los <n>` names them. */
    list: (person) => mine(person),

    /** `/schermen los <n>`: drop one of this person's screens. */
    async drop(person, n) {
      const list = await mine(person);
      const g = list[Number(n) - 1];
      if (!g) return { ok: false, reason: 'no-such-screen' };
      return { ok: Boolean(await revokeView(g.viewPubKey)), viewPubKey: g.viewPubKey };
    },

    /** Revoking a person drops every screen of theirs, and the link they may still hold. */
    async dropAll(person) {
      threads.setScreenNonce(person, null);
      threads.setScreenOffer(person, null);
      threads.setTelegramScreen(person, null);
      let n = 0;
      for (const g of await mine(person)) if (await revokeView(g.viewPubKey)) n += 1;
      return n;
    },
  };
}
