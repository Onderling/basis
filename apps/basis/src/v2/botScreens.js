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
import { parseUntrustedJson } from '@onderling/core';
// the door every screen pairing goes through (the code, the three to pick from, the pending offer, the refusals)
import { createScreenDoor, memoryUsedNonces, screenLabel, SCREEN_PAIRING_TTL_MS } from './screenDoor.js';

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


const randomNonce = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));

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
  let d; try { d = parseUntrustedJson(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1) return { ok: false, reason: 'wrong-version' };
  if (typeof d.b !== 'string' || !d.b || typeof d.n !== 'string' || !d.n) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, nonce: d.n, botName: typeof d.m === 'string' && d.m ? d.m : null };
}

/**
 * The address a screen opens to make its OWN connect code (the paste route, `/koppel-scherm`): the bot's address, its
 * relay and its name — no nonce, no secret. The screen makes a key and a nonce, shows its offer to copy and the code to
 * pick, and the person pastes the offer into their own chat.
 */
export function encodeScreenStartLink(appUrl, { botAddress, relayUrl = null, botName = null, ticket = null, toolbox = null }) {
  const body = b64url(JSON.stringify({
    v: 1, b: botAddress, ...(relayUrl ? { r: relayUrl } : {}), ...(botName ? { m: botName } : {}),
    // a TOOLBOX'S PAGE link (L1113): the one-use ticket the page hands back in its offer, and which toolbox it is for
    ...(ticket ? { k: ticket } : {}), ...(toolbox ? { t: String(toolbox) } : {}),
  }));
  // a toolbox's PAGE keeps its address as placed, query included (L1149: `?e=<entry>`), and gains nothing but the
  // fragment; Basis's own app address is normalised as before
  if (toolbox) return `${String(appUrl).replace(/#.*$/, '')}#scherm-nieuw=${body}`;
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/#scherm-nieuw=${body}`;
}
/** @returns {{ok: true, botAddress: string, relayUrl: string|null, botName: string|null, ticket: string|null, toolbox: string|null}|{ok: false, reason: string}} */
export function parseScreenStartLink(link) {
  const m = /#scherm-nieuw=([A-Za-z0-9_-]+)/.exec(String(link ?? ''));
  if (!m) return { ok: false, reason: 'not-a-start-link' };
  let d; try { d = parseUntrustedJson(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1 || typeof d.b !== 'string' || !d.b) return { ok: false, reason: 'incomplete' };
  return {
    ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, botName: typeof d.m === 'string' && d.m ? d.m : null,
    ticket: typeof d.k === 'string' && d.k ? d.k : null, toolbox: typeof d.t === 'string' && d.t ? d.t : null,
  };
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
  let d; try { d = parseUntrustedJson(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1 || typeof d.b !== 'string' || !d.b) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, botName: typeof d.m === 'string' && d.m ? d.m : null };
}

/** The box's vault key that says the pre-ticket toolbox grants were ended (L1113): once per box. */
export const TOOLBOX_TICKET_UPGRADE_KEY = 'screens.toolbox-ticket-v1';

/**
 * ONCE per box, at the first start with ticketed toolbox pages (L1113): every grant a toolbox's page holds from BEFORE
 * is ended (it held the person's whole role column, and its toolbox was the page's own claim), and each person is told
 * ONCE, in their chat, how to connect again (`/scherm <toolbox>`). Basis's own screens are left alone.
 *
 * "From before" is read from the grant itself: its latest token's end minus the grant's life is when it was issued,
 * and the pass ends only grants issued before the pass first STARTED (the time is kept first, the done mark after).
 * A pass that was cut short therefore runs again at the next start without ending a page paired with a ticket since.
 * @param {{listGrants: Function, revokeView: Function, notify?: Function, marker: {get: Function, set: Function}, grantTtlMs: number, now?: () => number}} a
 * @returns {Promise<{ran: boolean, ended: number, told: number}>}
 */
export async function endPreTicketToolboxGrants({ listGrants, revokeView, notify = null, marker, grantTtlMs, now = Date.now }) {
  let mark = null;
  try { mark = parseUntrustedJson((await marker.get(TOOLBOX_TICKET_UPGRADE_KEY)) ?? 'null'); } catch { mark = null; }
  if (mark?.done) return { ran: false, ended: 0, told: 0 };
  const started = typeof mark?.started === 'number' ? mark.started : now();
  if (typeof mark?.started !== 'number') await marker.set(TOOLBOX_TICKET_UPGRADE_KEY, JSON.stringify({ started }));
  const issuedAt = (g) => {
    const ends = (Array.isArray(g?.tokens) ? g.tokens : []).map((t) => Number(t?.expiresAt)).filter(Number.isFinite);
    return ends.length ? Math.max(...ends) - Number(grantTtlMs) : -Infinity;   // no token: as old as it gets
  };
  let ended = 0;
  const toTell = new Map();   // person -> a toolbox to name
  for (const g of ((await listGrants()) ?? [])) {
    if (!g?.toolbox || !g.viewPubKey || issuedAt(g) >= started) continue;
    if (!(await revokeView(g.viewPubKey))) continue;
    ended += 1;
    if (g.actingAs && !toTell.has(g.actingAs)) toTell.set(g.actingAs, String(g.toolbox));
  }
  for (const [person, toolbox] of toTell) { try { await notify?.(person, 'circle.bot.screen_toolbox_grant_ended', { toolbox }); } catch { /* ended either way */ } }
  await marker.set(TOOLBOX_TICKET_UPGRADE_KEY, JSON.stringify({ started, done: new Date(now()).toISOString() }));
  return { ran: true, ended, told: toTell.size };
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
 * @param {(viewPubKey: string) => void} [a.expectRefusal]  registers that ONE refusal to a screen whose own offer this bot
 *   read (the send gate lets exactly it leave; the box composes the agent's `inviteExchange.expectScreenRefusal`)
 * @param {() => {appUrl: string|null, botAddress: string|null, relayUrl: string|null}} a.where
 * @param {(initData: string) => Promise<{ok: boolean, telegramId?: string, hash?: string, reason?: string}>} [a.verifyLaunch]
 *   checks Telegram's launch data (the bot's token is in it; `verifyTelegramLaunch`)
 * @param {(telegramId: string) => Promise<string|null>} [a.personOfTelegram]  the ADMITTED person with this Telegram id
 * @param {(person: string) => {label: string, webApp: string}|null} [a.launchButton]  the "Open het scherm" button for
 *   this person's private chat (a Telegram person, an app address Telegram opens), or null
 * @param {(person: string) => string} [a.launchLabel]  what `/schermen` calls a Telegram-launched screen
 * @param {(name: string) => Promise<boolean>} [a.toolboxOn]  is this toolbox on here
 * @param {(name: string) => Promise<{page: string, ops: string[]}|null>} [a.toolboxPage]  an ON toolbox's placed page:
 *   its address and the ops the operator placed for it (L1113); null when it has none
 * @param {() => number} [a.now]
 */
export function createBotScreens({ threads, isAdmitted, columnOf, grant, revokeView, listGrants, notify = null, ask = null, tellRefused = null, expectRefusal = null, sendPrivately, where, verifyLaunch = null, personOfTelegram = null, launchButton = null, launchLabel = () => 'Telegram', toolboxOn = null, toolboxPage = null, now = Date.now, rand = Math.random }) {
  const mine = async (person) => ((await listGrants()) ?? []).filter((g) => g?.actingAs === person);
  // when each person last connected a screen: a code tapped again within the offer's window says "connected"
  const connectedAt = new Map();
  // a launch's hash, used: kept until no launch that old is taken anyway
  const usedLaunches = new Map();
  const spend = (hash) => {
    const t = now();
    for (const [h, until] of usedLaunches) if (until < t) usedLaunches.delete(h);
    if (usedLaunches.has(hash)) return false;
    usedLaunches.set(hash, t + 2 * TELEGRAM_LAUNCH_MAX_AGE_S * 1000);
    return true;
  };
  // THE SCREEN DOOR, the bot's: the one pending offer per person on their thread row, a nonce granted once
  const door = createScreenDoor({
    pending: { get: (person) => threads.screenOfferOf(person), set: (person, rec) => threads.setScreenOffer(person, rec) },
    used: memoryUsedNonces({ now }), now, rand,
  });
  const buttonsFor = (person) => { const b = typeof launchButton === 'function' ? launchButton(person) : null; return b ? [b] : null; };

  // A TOOLBOX PAGE'S TICKETS (L1113): one per `/scherm <toolbox>`, one use, as short-lived as a pairing, bound to the
  // person who asked and the toolbox it was asked for. The page hands it back in its offer; the toolbox the grant is for
  // is read from HERE, never from the offer (an offer is the page's own, unsigned claim). In memory: a restart ends the
  // links in flight, and the person asks for a new one.
  const tickets = new Map();   // sha256(ticket) -> {person, toolbox: string | null (null: Basis's own screen), until}
  /** A fresh ticket for this person: for a toolbox's page, or (toolbox null) Basis's own screen on the paste route. */
  async function mintTicket(person, toolbox) {
    const ticket = randomNonce();
    const until = now() + SCREEN_PAIRING_TTL_MS;
    tickets.set(await sha256Hex(ticket), { person, toolbox: toolbox ?? null, until });
    return { ticket, until };
  }
  async function spendTicket(person, ticket) {
    const t = now();
    for (const [h, rec] of tickets) if (rec.until < t - SCREEN_PAIRING_TTL_MS) tickets.delete(h);
    const h = await sha256Hex(String(ticket));
    const rec = tickets.get(h);
    if (!rec || rec.person !== person) return { ok: false, reason: 'toolbox-ticket-unknown' };
    tickets.delete(h);   // one use, whatever happens next
    if (rec.until < t) return { ok: false, reason: 'toolbox-ticket-expired' };
    return { ok: true, toolbox: rec.toolbox };
  }

  /**
   * What a grant holds. Basis's own screen: the person's role column, without useTool (ledger L1049). A toolbox's page:
   * useTool for ITS toolbox plus the ops its operator placed, each only if the person's column holds it (L1113): the
   * page never holds more than the person, nor more than the operator named.
   */
  async function opsFor(person, toolbox) {
    const column = await columnOf(person);
    if (!toolbox) return column.filter((op) => op !== 'tools.useTool');
    const placed = typeof toolboxPage === 'function' ? await toolboxPage(String(toolbox)) : null;
    const allowed = new Set(['tools.useTool', ...(placed?.ops ?? [])]);
    return column.filter((op) => allowed.has(op));
  }

  /** The grant, for an offer the person vouched for (the code they picked, or a launch Telegram signed): their role's column, as them. */
  async function grantTo(person, { viewPubKey, label, nonce, toolbox = null }) {
    // a toolbox's page holds useTool for ITS toolbox (the grant records it; the door checks each call) and its placed ops
    const ops = await opsFor(person, toolbox);
    if (!ops.length) return { ok: false, reason: 'nothing-to-grant' };
    const r = await grant({ viewPubKey, ops, actingAs: person, label, nonce, ...(toolbox ? { toolbox } : {}) });
    if (r?.ok === false) return { ok: false, reason: r.error ?? 'grant-failed' };
    try { await notify?.(person, 'circle.bot.screen_connected', { n: ops.length }); } catch { /* the grant stands; /schermen shows it */ }
    return { ok: true, person, ops };
  }

  // A screen is told it was refused, never awaited: a screen that does not greet back would hold the person's reply
  // for the handshake ladder (23 s); best-effort — the screen times out on its own.
  // only ever for a screen whose own offer was read here (a stored offer, a launch from that key): its one refusal
  const refuseSoon = (viewPubKey) => {
    try { expectRefusal?.(viewPubKey); } catch { /* without the registration the gate holds it; the screen's offer times out */ }
    Promise.resolve().then(() => tellRefused?.(viewPubKey)).catch(() => {});
  };

  /** The question, for an offer from either route: the code to pick from three, in the person's private door. */
  async function askAbout(person, { viewPubKey, nonce, label, toolbox: claimed = null, ticket = null, route = 'relay' }) {
    if (typeof ask !== 'function') return { ok: false, reason: 'no-private-door' };
    // a page that names a toolbox pairs only for one that is ON here; refused in words before anything is asked
    if (claimed && !(typeof toolboxOn === 'function' && await toolboxOn(String(claimed)))) return { ok: false, reason: 'toolbox-not-on', toolbox: String(claimed) };
    // A TOOLBOX'S PAGE pairs only with the ticket its link carried (L1113): the ticket names the toolbox; an offer that
    // names one without a ticket, or another one than its ticket, is refused before anything is asked. The person's pick
    // of the code still follows: the ticket proves the page, the code proves the person.
    // EVERY PASTED OFFER carries a live ticket (Fable's review): a page that drops its ticket and names no toolbox would
    // otherwise be paired as Basis's own screen and hold the person's whole column. What a grant holds is read from the
    // ticket's MARK (Basis's own, or a toolbox), never from what the offer says or leaves out. The relay route without a
    // ticket is Basis's own screen link, already bound to the person by its one-use nonce.
    let toolbox = null;
    if (ticket) {
      const spent = await spendTicket(person, ticket);
      if (!spent.ok) return spent;
      if (claimed && String(claimed) !== (spent.toolbox ?? '')) return { ok: false, reason: 'toolbox-ticket-mismatch', toolbox: String(claimed) };
      if (spent.toolbox && !(typeof toolboxOn === 'function' && await toolboxOn(spent.toolbox))) return { ok: false, reason: 'toolbox-not-on', toolbox: spent.toolbox };
      toolbox = spent.toolbox;
    } else if (claimed) {
      return { ok: false, reason: 'toolbox-needs-ticket', toolbox: String(claimed) };
    } else if (route === 'paste') {
      return { ok: false, reason: 'pairing-needs-ticket' };
    }
    // the door keeps it as the person's one pending offer: a second offer drops the first, and its screen is told —
    // unless it IS this screen (a reload, a second /scherm on the same browser): the screen asking now must not be the
    // one told it was refused, or it gives up on the offer it just made
    const asked0 = await door.ask(person, { viewPubKey, nonce, label: screenLabel(label) ?? 'scherm', ...(toolbox ? { toolbox } : {}) });
    if (!asked0.ok) return asked0;
    const previous = asked0.previous;
    if (previous && previous.viewPubKey !== viewPubKey) refuseSoon(previous.viewPubKey);
    // the question names what asks and, for a toolbox's page, for which toolbox ('<label> wil koppelen voor toolbox <naam>')
    // and what it will hold, so the question is as wide as the grant (L1113)
    const ops = toolbox ? await opsFor(person, toolbox) : null;
    const asked = await ask(person, { codes: asked0.codes, replaced: Boolean(previous), label: screenLabel(label) ?? 'scherm', ...(toolbox ? { toolbox: String(toolbox), ops } : {}) });
    if (!asked?.ok) { door.drop(person); return { ok: false, reason: asked?.reason ?? 'not-reachable' }; }
    return { ok: true, pending: true, person };
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
      const until = now() + SCREEN_PAIRING_TTL_MS;
      threads.setScreenNonce(person, { hash: await sha256Hex(nonce), until });
      const link = encodeScreenLink(appUrl, { botAddress, relayUrl, nonce, botName });
      const sent = await sendPrivately(person, text(link, Math.round(SCREEN_PAIRING_TTL_MS / 60000)), remembered ?? '', buttonsFor(person));
      if (!sent?.ok) { threads.setScreenNonce(person, null); return { ok: false, reason: sent?.reason ?? 'not-reachable' }; }
      return { ok: true, until };
    },

    /**
     * The paste route (`/scherm` for the admin, by default): the person gets the address a screen opens to make its own
     * connect code — no secret travels through the chat; the screen's offer comes back pasted (`/koppel-scherm`).
     */
    async startPaste(person, text, remembered = '') {
      const { appUrl, botAddress, relayUrl, botName = null } = where() ?? {};
      if (!appUrl || !botAddress) return { ok: false, reason: 'no-app-url' };
      if (typeof sendPrivately !== 'function') return { ok: false, reason: 'no-private-door' };
      // Basis's own screen on the paste route carries a ticket too (marked as Basis's own): a pasted offer pairs only
      // with one, so a page cannot get the whole column by leaving out its toolbox (L1113)
      const { ticket } = await mintTicket(person, null);
      const link = encodeScreenStartLink(appUrl, { botAddress, relayUrl, botName, ticket });
      const sent = await sendPrivately(person, text(link, Math.round(SCREEN_PAIRING_TTL_MS / 60000)), remembered ?? '', buttonsFor(person));
      return sent?.ok ? { ok: true } : { ok: false, reason: sent?.reason ?? 'not-reachable' };
    },

    /**
     * A screen's offer PASTED by the person into their own chat (`/koppel-scherm <offer>`). The person is the one who
     * pasted it; a pasted offer can be planted ("paste this into your bot") as a link can be stolen — so nothing is
     * granted here either: the same question, the code to pick from three.
     */
    async pasted(person, { viewPubKey, nonce, label = null, toolbox = null, ticket = null }) {
      if (typeof viewPubKey !== 'string' || !viewPubKey || typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'not-an-offer' };
      if (typeof isAdmitted !== 'function' || !(await isAdmitted(person))) return { ok: false, reason: 'not-admitted' };
      return askAbout(person, { viewPubKey, nonce, label, toolbox, ticket, route: 'paste' });
    },

    /**
     * `/scherm <toolbox>`: the link to that toolbox's own page (the address its operator placed), with a one-use ticket,
     * sent to the person's PRIVATE door only. The page hands the ticket back in its offer; the pairing then asks the
     * person for the code as always (L1113). `text(link)` words it in the person's language.
     */
    async toolboxStart(person, toolbox, text, remembered = '') {
      const name = String(toolbox ?? '').trim();
      const { botAddress, relayUrl, botName = null } = where() ?? {};
      if (!botAddress) return { ok: false, reason: 'no-app-url' };
      if (typeof sendPrivately !== 'function') return { ok: false, reason: 'no-private-door' };
      if (typeof isAdmitted !== 'function' || !(await isAdmitted(person))) return { ok: false, reason: 'not-admitted' };
      const placed = typeof toolboxPage === 'function' ? await toolboxPage(name) : null;
      if (!placed?.page) return { ok: false, reason: 'toolbox-no-page', toolbox: name };
      const { ticket, until } = await mintTicket(person, name);
      const link = encodeScreenStartLink(placed.page, { botAddress, relayUrl, botName, ticket, toolbox: name });
      // the thread remembers a line WITHOUT the link: a live ticket does not belong in memory (as `start()`)
      const sent = await sendPrivately(person, text(link, Math.round(SCREEN_PAIRING_TTL_MS / 60000)), remembered ?? '', null);
      if (!sent?.ok) return { ok: false, reason: sent?.reason ?? 'not-reachable' };
      return { ok: true, until };
    },

    /**
     * A screen's offer arrived (over the relay, from `from`): the nonce names the person; one use, in time; the key
     * that sends the offer is the key it names. NOTHING is granted yet: the person is asked, privately, with the code.
     */
    async offer({ from, viewPubKey, nonce, label = null, toolbox = null, ticket = null }) {
      if (typeof viewPubKey !== 'string' || !viewPubKey || viewPubKey !== from) return { ok: false, reason: 'wrong-sender' };
      if (typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'no-nonce' };
      const hash = await sha256Hex(nonce);
      const person = threads.screenNonceOwner(hash);
      if (!person) return { ok: false, reason: 'unknown-nonce' };
      const pending = threads.screenNonceOf(person);
      threads.setScreenNonce(person, null);   // one use, whatever happens next
      if (!pending || pending.until < now()) return { ok: false, reason: 'expired' };
      if (typeof isAdmitted !== 'function' || !(await isAdmitted(person))) return { ok: false, reason: 'not-admitted' };
      return askAbout(person, { viewPubKey, nonce, label, toolbox, ticket });
    },

    /**
     * The person's answer to the question, from the door it came through: only their PRIVATE door counts (a yes in a
     * group is not accepted). Ja → the grant (their role's column, as them) and the notice; Nee, or too late → nothing.
     */
    async confirm(person, answer, { isPrivate = false } = {}) {
      const offer = door.pendingOf(person);
      if (!offer) {
        // the code tapped again right after the screen connected: say it is connected, not that nothing is waiting
        const at = connectedAt.get(person);
        return at != null && now() - at < SCREEN_PAIRING_TTL_MS ? { ok: true, already: true } : { ok: false, reason: 'nothing-pending' };
      }
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      // the door's one try: answered (or late), the offer is gone either way; only the code the screen shows grants —
      // a wrong code, "none of these", or a bare yes drops the offer and its screen is told
      const picked = await door.answer(person, answer);
      if (!picked.ok) {
        refuseSoon(offer.viewPubKey);
        return picked.reason === 'pairing-expired' ? { ok: false, reason: 'expired' } : { ok: true, declined: true };
      }
      if (typeof isAdmitted !== 'function' || !(await isAdmitted(person))) return { ok: false, reason: 'not-admitted' };
      const r = await grantTo(person, { viewPubKey: offer.viewPubKey, label: offer.label, nonce: offer.nonce, toolbox: offer.toolbox ?? null });
      if (r.ok) connectedAt.set(person, now());
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
      const refuse = async (reason) => { refuseSoon(viewPubKey); return { ok: false, reason }; };
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
      door.drop(person);
      threads.setTelegramScreen(person, null);
      let n = 0;
      for (const g of await mine(person)) if (await revokeView(g.viewPubKey)) n += 1;
      return n;
    },
  };
}
