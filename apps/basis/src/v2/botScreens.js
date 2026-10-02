/**
 * botScreens — a person on a household bot connects a SCREEN (their own app, in a browser) to act through.
 *
 * `/scherm` gives the person a one-time link (the bot's address and a nonce, ten minutes, for them alone); the screen
 * makes a key and sends the bot its offer with that nonce over the relay; the bot grants that key the person's ROLE
 * COLUMN — one capability token per op, each saying, signed, that it acts as that person — and tells the person in
 * their own chat. A screen's call then reaches the bot's door as that person (the gate, the role, the settings: the
 * same as a typed line). `/schermen` lists the person's screens and drops one; revoking the person drops them all.
 *
 * The link is the one soft spot: whoever holds it within ten minutes can connect a screen as that person (Telegram's
 * servers see it). One use, ten minutes, the notice in the person's own chat and `/schermen` are the mitigation.
 *
 * The nonce is kept as its HASH on the person's thread row (as admission codes are), one pending per person.
 * Pure composition: the grants, the role column and the notice are handed in.
 */
import { sha256Hex } from './botAdmission.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long a `/scherm` link may be used (once). */
export const SCREEN_LINK_TTL_MS = param({ key: 'assistant.screenLinkTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1000 });

const randomNonce = () => {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));

/** The `/scherm` link's fragment: the bot's address, its relay and the nonce. No authority — a screen still needs the grant. */
export function encodeScreenLink(appUrl, { botAddress, relayUrl = null, nonce }) {
  const body = b64url(JSON.stringify({ v: 1, b: botAddress, ...(relayUrl ? { r: relayUrl } : {}), n: nonce }));
  return `${String(appUrl).replace(/[#?].*$/, '').replace(/\/+$/, '')}/#scherm=${body}`;
}
/** @returns {{ok: true, botAddress: string, relayUrl: string|null, nonce: string}|{ok: false, reason: string}} */
export function parseScreenLink(link) {
  const m = /#scherm=([A-Za-z0-9_-]+)/.exec(String(link ?? ''));
  if (!m) return { ok: false, reason: 'not-a-screen-link' };
  let d; try { d = JSON.parse(unb64url(m[1])); } catch { return { ok: false, reason: 'unreadable' }; }
  if (d?.v !== 1) return { ok: false, reason: 'wrong-version' };
  if (typeof d.b !== 'string' || !d.b || typeof d.n !== 'string' || !d.n) return { ok: false, reason: 'incomplete' };
  return { ok: true, botAddress: d.b, relayUrl: typeof d.r === 'string' ? d.r : null, nonce: d.n };
}

/**
 * @param {object} a
 * @param {object} a.threads  the bot's thread rows (`screenNonceOf` / `setScreenNonce` / `screenNonceOwner`)
 * @param {(person: string) => Promise<boolean>} a.isAdmitted  the person is in the book (not revoked)
 * @param {(person: string) => Promise<string[]>} a.columnOf  the op ids (`app.op`) this person's role reaches, minus
 *   what a screen never gets (the shell decides; the admin's own ops are not minted)
 * @param {(person: string, text: string, rememberAs: string|null) => Promise<{ok: boolean, reason?: string}>} a.sendPrivately
 *   the person's PRIVATE door (their own chat, their inbox) — never the chat `/scherm` was typed in, which may be a
 *   group; `rememberAs` is what their thread keeps instead of the link (a secret does not belong in memory)
 * @param {(g: {viewPubKey: string, ops: string[], actingAs: string, label: string, nonce: string}) => Promise<object>} a.grant
 * @param {(viewPubKey: string) => Promise<boolean>} a.revokeView
 * @param {() => Promise<Array<{viewPubKey: string, label: string|null, ops: string[], actingAs?: string}>>} a.listGrants
 * @param {(person: string, key: string, params?: object) => Promise<void>|void} [a.notify]  a line in the person's chat
 * @param {() => {appUrl: string|null, botAddress: string|null, relayUrl: string|null}} a.where
 * @param {() => number} [a.now]
 */
export function createBotScreens({ threads, isAdmitted, columnOf, grant, revokeView, listGrants, notify = null, sendPrivately, where, now = Date.now }) {
  const mine = async (person) => ((await listGrants()) ?? []).filter((g) => g?.actingAs === person);

  return {
    /**
     * `/scherm`: a fresh one-time link for this person (the previous pending one stops working), sent to their PRIVATE
     * door only — a group must never see it. `text(link, minutes)` words it in the person's language; `remembered` is
     * what their thread keeps instead (never the link).
     */
    async start(person, text, remembered = null) {
      const { appUrl, botAddress, relayUrl } = where() ?? {};
      if (!appUrl || !botAddress) return { ok: false, reason: 'no-app-url' };
      if (typeof sendPrivately !== 'function') return { ok: false, reason: 'no-private-door' };
      const nonce = randomNonce();
      const until = now() + SCREEN_LINK_TTL_MS;
      threads.setScreenNonce(person, { hash: await sha256Hex(nonce), until });
      const link = encodeScreenLink(appUrl, { botAddress, relayUrl, nonce });
      const sent = await sendPrivately(person, text(link, Math.round(SCREEN_LINK_TTL_MS / 60000)), remembered ?? '');
      if (!sent?.ok) { threads.setScreenNonce(person, null); return { ok: false, reason: sent?.reason ?? 'not-reachable' }; }
      return { ok: true, until };
    },

    /**
     * A screen's offer arrived (over the relay, from `from`): the nonce names the person; one use, in time; the key
     * that sends the offer is the key it names. Then the grant, and the notice in the person's chat.
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
      const ops = await columnOf(person);
      if (!ops.length) return { ok: false, reason: 'nothing-to-grant' };
      const r = await grant({ viewPubKey, ops, actingAs: person, label: label || 'scherm', nonce });
      if (r?.ok === false) return { ok: false, reason: r.error ?? 'grant-failed' };
      try { await notify?.(person, 'circle.bot.screen_connected', { n: ops.length }); } catch { /* the grant stands; /schermen shows it */ }
      return { ok: true, person, ops };
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
      let n = 0;
      for (const g of await mine(person)) if (await revokeView(g.viewPubKey)) n += 1;
      return n;
    },
  };
}
