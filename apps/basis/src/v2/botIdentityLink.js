/**
 * botIdentityLink — the bot's side of `/koppel`: a Telegram person links their Basis identity to their row.
 *
 * `/koppel` alone sends the person the link their Basis app opens (no secret in it). The app shows an offer — their
 * person key, this bot's address, a nonce — which they paste into their PRIVATE chat (`/koppel <offer>`). Checked before
 * any question: it names THIS bot, the key is on no other row (relinking the same row says so). Then the question, in
 * the private chat, says what linking means and asks which of three codes the app shows (`/koppel-code`). The right
 * code: the row gains the key, a line in the chat, and the bot's statement to the app's key. Identity only: nothing
 * else is granted. `/ontkoppel` drops the key and every screen grant minted to it.
 */
import { codeChoices } from './botScreens.js';
import { parseLinkOffer, linkCode, encodeLinkStartLink, IDENTITY_LINK_SUBTYPE } from './identityLink.js';

/** How long a pasted offer waits for its code (the screen's ten minutes). */
const OFFER_FOR_MS = 10 * 60 * 1000;

/**
 * @param {object} a
 * @param {ReturnType<import('./botUsers.js').createBotUsers>} a.users
 * @param {() => string|null} a.botAddress
 * @param {(person: string, q: {text: string, buttons: Array<{id: string, label: string}>}) => Promise<{ok: boolean}>} a.ask
 * @param {(person: string, text: string) => Promise<{ok: boolean}>} a.sendPrivately
 * @param {(key: string, payload: object) => Promise<void>} a.tellApp  a peer message to the app's key (signed by the bot)
 * @param {() => Promise<Array<{viewPubKey: string}>>} a.listGrants
 * @param {(viewPubKey: string) => Promise<boolean>} a.revokeView
 * @param {() => {appUrl: string|null, botAddress: string|null, relayUrl: string|null, botName?: string|null}} a.where
 * @param {() => number} [a.now]
 * @param {() => number} [a.rand]
 */
export function createIdentityLink({ users, botAddress, ask, sendPrivately, tellApp, listGrants, revokeView, where, now = Date.now, rand = Math.random }) {
  const pending = new Map();   // person → { key, nonce, until }
  return {
    /** `/koppel` alone: the link the person's Basis app opens, to their private door. */
    async start(person, text) {
      const { appUrl, botAddress: bot, relayUrl, botName = null } = where() ?? {};
      if (!appUrl || !bot) return { ok: false, reason: 'no-app-url' };
      return sendPrivately(person, text(encodeLinkStartLink(appUrl, { botAddress: bot, relayUrl, botName })));
    },

    /**
     * `/koppel <offer>`: checked, then the question. Refused before any question: not an offer, another bot's, a key on
     * another row; the same key on the same row says so.
     */
    async pasted(person, offerText, question) {
      const o = parseLinkOffer(offerText);
      if (!o.ok) return { ok: false, reason: 'not-an-offer' };
      if (o.botAddress !== botAddress()) return { ok: false, reason: 'another-bot' };
      const rows = await users.list();
      const row = rows.find((r) => r.id === person);
      if (!row) return { ok: false, reason: 'not-admitted' };
      if (row.pubKey === o.personKey) return { ok: true, already: true };
      if (rows.some((r) => r.id !== person && (r.id === o.personKey || r.pubKey === o.personKey))) return { ok: false, reason: 'key-on-another-row' };
      if (row.pubKey) return { ok: false, reason: 'row-has-a-key' };
      pending.set(person, { key: o.personKey, nonce: o.nonce, until: now() + OFFER_FOR_MS });
      const codes = codeChoices(await linkCode(o.personKey, o.nonce), rand);
      const asked = await ask(person, question(codes));
      if (!asked?.ok) { pending.delete(person); return { ok: false, reason: asked?.reason ?? 'not-reachable' }; }
      return { ok: true, pending: true };
    },

    /** `/koppel-code <code>`, from the private door only: the right code links; anything else drops the offer. */
    async confirm(person, answer, { isPrivate = false } = {}) {
      const p = pending.get(person);
      if (!p) return { ok: false, reason: 'nothing-pending' };
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      pending.delete(person);   // answered (or late): gone either way
      if (p.until < now()) return { ok: false, reason: 'expired' };
      if (String(answer ?? '').trim().toUpperCase() !== await linkCode(p.key, p.nonce)) return { ok: true, declined: true };
      const r = await users.linkKey(person, p.key);
      if (!r.ok) return r;
      // the bot's statement to the app (the envelope is signed by the bot): which bot, which row, which key — it grants nothing
      try { await tellApp(p.key, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: botAddress(), row: person, key: p.key, at: now() } }); } catch { /* the link stands; the app hears it on its next visit */ }
      return { ok: true, linked: true };
    },

    /** `/ontkoppel`, from the private door only: the key goes, and every screen grant minted to it. */
    async unlink(person, { isPrivate = false } = {}) {
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      const r = await users.unlinkKey(person);
      if (!r.ok) return r;
      for (const g of (await listGrants().catch(() => [])) ?? []) {
        if (g?.viewPubKey === r.key) { try { await revokeView(r.key); } catch { /* the grant's TTL ends it */ } }
      }
      try { await tellApp(r.key, { subtype: IDENTITY_LINK_SUBTYPE, unlinked: true, statement: { bot: botAddress(), row: person, key: r.key, at: now() } }); } catch { /* best-effort */ }
      return { ok: true };
    },
  };
}
