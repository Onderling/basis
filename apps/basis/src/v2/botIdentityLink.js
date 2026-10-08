/**
 * botIdentityLink — the bot's side of `/koppel`: a Telegram person links their Basis identity to their row.
 *
 * `/koppel` alone sends the person the link their Basis app opens (no secret in it). The app shows an offer — a
 * statement by one of the person's DEVICES for this bot (its delegation key's signature, the root-signed delegation
 * beside it), and the chat identity their circles know them by — which they paste into their PRIVATE chat
 * (`/koppel <offer>`). Checked before any question: it names THIS bot, its device chains to the root it names and is
 * not one that root revoked, the root and the chat identity are on no other row, the row is not linked to another
 * root (the same root on the same row says so). Then the question, in the private chat, says what linking means and
 * asks which of three codes the app shows (`/koppel-code`). The right code: the row records the ROOT (and the chat
 * identity, to name the person in the household's circle), a line in the chat, and the bot's statement to the app.
 * Identity only: nothing else is granted. `/ontkoppel` drops the link and every screen grant minted to the chat identity.
 *
 * From then on, what the person's app sends the bot carries a statement from one of their devices over exactly that
 * turn (`verifyTurn`) or that call (`callerOf`); the root it chains to finds the row. A device the root revoked is told
 * here by the root's own tombstone (`revoked`, any party may deliver it), kept per linked root on disk.
 */
import { createNonceWindow, verifyDeviceRevocation, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import { codeChoices } from './botScreens.js';
import { parseLinkOffer, linkCode, encodeLinkStartLink, verifyLinkStatement, IDENTITY_LINK_SUBTYPE, LINK_OPS } from './identityLink.js';

/** How long a pasted offer waits for its code (the screen's ten minutes). */
const OFFER_FOR_MS = 10 * 60 * 1000;

/**
 * How old a TURN's statement may be. A turn to a bot that is away is held and delivered when it is back (the secure
 * agent's hold, a day), so its statement may arrive late; a replay of it is the same message id, which the host's thread
 * store takes once, and a device revoked since is refused by its tombstone whatever the statement's age. The link offer
 * and a call keep the statement's own five minutes: they are answered at once or not at all.
 */
export const LINKED_TURN_WINDOW_MS = param({ key: 'assistant.linkedTurnWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 60 * 60 * 1000 + 5 * 60 * 1000 });
const TOMBSTONES_KEY = 'identity-link-tombstones';

/**
 * The devices each linked root has revoked, as the bot was told (the root's own signed tombstones). Kept in memory for
 * the door's synchronous check, written through to `vault` (sealed on the box) so a restart keeps them. Kept per ROOT,
 * not per row: unlinking a row forgets nothing a later link of the same root must still refuse.
 * @param {{vault: {get: (k: string) => Promise<string|null>, set: (k: string, v: string) => Promise<void>}}} a
 */
export function createLinkTombstones({ vault }) {
  const held = new Map();   // root → Set<deviceId>
  const snapshot = () => JSON.stringify(Object.fromEntries([...held].map(([r, ids]) => [r, [...ids]])));
  return {
    /** Read what was kept (once, at start). */
    async load() {
      let v = null;
      try { v = JSON.parse((await vault.get(TOMBSTONES_KEY)) ?? 'null'); } catch { v = null; }
      if (!v || typeof v !== 'object') return;
      for (const [root, ids] of Object.entries(v)) if (Array.isArray(ids)) held.set(root, new Set(ids.filter((x) => typeof x === 'string')));
    },
    has: (root, deviceId) => held.get(root)?.has(deviceId) === true,
    async add(root, deviceId) {
      if (!held.has(root)) held.set(root, new Set());
      held.get(root).add(deviceId);
      await vault.set(TOMBSTONES_KEY, snapshot());
    },
  };
}

/**
 * @param {object} a
 * @param {ReturnType<import('./botUsers.js').createBotUsers>} a.users
 * @param {() => string|null} a.botAddress
 * @param {ReturnType<typeof createLinkTombstones>} a.tombstones
 * @param {(person: string, q: {text: string, buttons: Array<{id: string, label: string}>}) => Promise<{ok: boolean}>} a.ask
 * @param {(person: string, text: string) => Promise<{ok: boolean}>} a.sendPrivately
 * @param {(key: string, payload: object) => Promise<void>} a.tellApp  a peer message to the app's chat identity (signed by the bot)
 * @param {() => Promise<Array<{viewPubKey: string}>>} a.listGrants
 * @param {(viewPubKey: string) => Promise<boolean>} a.revokeView
 * @param {() => {appUrl: string|null, botAddress: string|null, relayUrl: string|null, botName?: string|null}} a.where
 * @param {() => number} [a.now]
 * @param {() => number} [a.rand]
 */
export function createIdentityLink({ users, botAddress, tombstones, ask, sendPrivately, tellApp, listGrants, revokeView, where, now = Date.now, rand = Math.random, turnWindowMs = LINKED_TURN_WINDOW_MS }) {
  if (!tombstones || typeof tombstones.has !== 'function') throw new TypeError('createIdentityLink: the tombstones are required');
  const pending = new Map();   // person → { root, webid, deviceId, nonce, until }
  const nonces = createNonceWindow({ now });
  const turnNonces = createNonceWindow({ now, windowMs: turnWindowMs });
  /** Verify a linked device's statement for `op` over `args`, here; `root` pins it (null: the answer names it). */
  const check = (statement, op, args, root = null, { windowMs, seen = nonces } = {}) => verifyLinkStatement(statement, {
    node: botAddress(), op, args, root, isRevoked: (r, deviceId) => tombstones.has(r, deviceId), nonces: seen, now,
    ...(windowMs ? { windowMs } : {}),
  });
  const tell = (key, payload) => Promise.resolve(tellApp(key, payload)).catch(() => { /* the link stands; the app hears it on its next offer */ });
  return {
    /** `/koppel` alone: the link the person's Basis app opens, to their private door. */
    async start(person, text) {
      const { appUrl, botAddress: bot, relayUrl, botName = null } = where() ?? {};
      if (!appUrl || !bot) return { ok: false, reason: 'no-app-url' };
      return sendPrivately(person, text(encodeLinkStartLink(appUrl, { botAddress: bot, relayUrl, botName })));
    },

    /**
     * `/koppel <offer>`: checked, then the question. Refused before any question: not an offer (its chat identity did
     * not sign it, its device does not chain to the root it names), another bot's, a revoked device's, stale, a root or
     * chat identity on another row, a row linked to another root. The same root on the same row says so — and tells
     * the app again (an app that lost the first statement made this offer).
     */
    async pasted(person, offerText, question) {
      const o = parseLinkOffer(offerText);
      if (!o.ok) return { ok: false, reason: 'not-an-offer' };
      if (o.botAddress !== botAddress()) return { ok: false, reason: 'another-bot' };
      const v = check(o.statement, LINK_OPS.LINK, { w: o.webid }, o.root);
      if (!v.ok) return { ok: false, reason: v.reason === 'revoked' || v.reason === 'stale' ? v.reason : 'not-an-offer' };
      const rows = await users.list();
      const row = rows.find((r) => r.id === person);
      if (!row) return { ok: false, reason: 'not-admitted' };
      if (row.linkedRoot === o.root) {
        await tell(o.webid, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: botAddress(), row: person, root: o.root, at: now() } });
        return { ok: true, already: true };
      }
      if (rows.some((r) => r.id !== person && (r.linkedRoot === o.root || r.id === o.webid || r.pubKey === o.webid))) return { ok: false, reason: 'key-on-another-row' };
      if (row.linkedRoot) return { ok: false, reason: 'row-has-a-key' };
      pending.set(person, { root: o.root, webid: o.webid, deviceId: v.deviceId, nonce: o.nonce, until: now() + OFFER_FOR_MS });
      const codes = codeChoices(await linkCode(o.root, o.nonce), rand);
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
      if (tombstones.has(p.root, p.deviceId)) return { ok: false, reason: 'revoked' };
      if (String(answer ?? '').trim().toUpperCase() !== await linkCode(p.root, p.nonce)) return { ok: true, declined: true };
      const r = await users.linkKey(person, { root: p.root, webid: p.webid });
      if (!r.ok) return r;
      // the bot's statement to the app (the envelope is signed by the bot): which bot, which row, which root — it grants nothing
      await tell(p.webid, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: botAddress(), row: person, root: p.root, at: now() } });
      return { ok: true, linked: true };
    },

    /** `/ontkoppel`, from the private door only: the link goes, and every screen grant minted to the chat identity. */
    async unlink(person, { isPrivate = false } = {}) {
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      const r = await users.unlinkKey(person);
      if (!r.ok) return r;
      if (r.key) {
        for (const g of (await listGrants().catch(() => [])) ?? []) {
          if (g?.viewPubKey === r.key) { try { await revokeView(r.key); } catch { /* the grant's TTL ends it */ } }
        }
        await tell(r.key, { subtype: IDENTITY_LINK_SUBTYPE, unlinked: true, statement: { bot: botAddress(), row: person, root: r.root, at: now() } });
      }
      return { ok: true };
    },

    /**
     * A turn at the inbox door: the ROOT it is the person's by, or why not. Synchronous (the door's feed is): the
     * statement must be over exactly this turn — its words and its message id — for this bot, from a device that is not
     * revoked, inside the turn's window (a held turn arrives late) and not seen before. Which row that root is is the
     * door's admission's to find.
     * @param {{auth?: object, text: string, messageId?: string}} turn
     * @returns {{ok: true, root: string, deviceId: string}|{ok: false, reason: string}}
     */
    verifyTurn({ auth, text, messageId } = {}) {
      if (!auth) return { ok: false, reason: 'no-statement' };
      const v = check(auth, LINK_OPS.TURN, { text, messageId }, null, { windowMs: turnWindowMs, seen: turnNonces });
      return v.ok ? { ok: true, root: v.root, deviceId: v.deviceId } : { ok: false, reason: v.reason };
    },

    /**
     * A call from the person's app (not a turn): the row whose linked root the statement chains to, or why not.
     * @returns {Promise<{ok: true, row: object}|{ok: false, reason: string}>}
     */
    async callerOf(auth, op, args) {
      const v = check(auth, op, args);
      if (!v.ok) return { ok: false, reason: v.reason };
      const row = (await users.list()).find((r) => r.linkedRoot === v.root) ?? null;
      return row ? { ok: true, row } : { ok: false, reason: 'not-linked' };
    },

    /**
     * A device's revocation — the root's own tombstone, delivered by anyone. Kept when it verifies and its root is linked
     * to a row here; a pending offer from that device is dropped.
     * @returns {Promise<{ok: true}|{ok: false, reason: 'forbidden'|'not-linked'}>}
     */
    async revoked(revocation) {
      if (!verifyDeviceRevocation(revocation)) return { ok: false, reason: 'forbidden' };
      if (!(await users.list()).some((r) => r.linkedRoot === revocation.by)) return { ok: false, reason: 'not-linked' };
      await tombstones.add(revocation.by, revocation.deviceId);
      for (const [person, p] of pending) if (p.root === revocation.by && p.deviceId === revocation.deviceId) pending.delete(person);
      return { ok: true };
    },
  };
}

/**
 * The bot's one op its linked person's app calls directly: hand the bot a companion's card (`assistant-companion`).
 * The call carries a statement from one of the person's devices over exactly that card; the row its root is linked to
 * is the caller, and the door's own call decides — through the same host gate as a typed line — so a member is refused
 * and only the admin's card is taken. Registered on the bot's agent for its peers (`exposeToPeers`).
 * @param {object} a
 * @param {ReturnType<typeof createIdentityLink>} a.link
 * @param {(app: string, op: string, args: object, ctx: object) => Promise<any>} a.doorCall
 * @param {string} a.id  the op id peers call it by (`LINKED_COMPANION_OP`)
 * @param {(e: object) => void} [a.log]
 */
export function linkedCompanionSkill({ link, doorCall, id, log = null }) {
  return {
    id,
    visibility: 'public',   // any peer may present; the device statement is the authority, checked before anything
    description: 'Hand this household bot a companion\'s card, from the app of the person linked as its admin.',
    handler: async (hctx) => {
      const data = (hctx?.parts ?? []).find((p) => p?.data && typeof p.data === 'object')?.data ?? {};
      const card = typeof data.card === 'string' ? data.card : '';
      if (!card) return { ok: false, error: 'bad-args' };
      const who = await link.callerOf(data.auth, LINK_OPS.COMPANION, { card });
      if (!who.ok) {
        try { log?.({ kind: 'linked-companion', ok: false, reason: who.reason }); } catch { /* a log never breaks the call */ }
        return { ok: false, error: who.reason === 'stale' ? 'stale' : 'forbidden' };
      }
      const r = await doorCall('assistant', LINK_OPS.COMPANION, { card }, { caller: who.row.id, threadId: who.row.id, via: 'linked-app' });
      const ok = r?.ok === true;
      try { log?.({ kind: 'linked-companion', ok, ...(ok ? {} : { reason: r?.refusal ? 'not-admin' : (r?.error?.code ?? 'failed') }) }); } catch { /* */ }
      if (ok) return { ok: true };
      return { ok: false, error: r?.refusal ? 'not-admin' : (typeof r?.error?.code === 'string' ? r.error.code : 'failed') };
    },
  };
}
