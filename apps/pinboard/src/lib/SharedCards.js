/**
 * SharedCards — the contact links a person hands out ("Share my contact"): `shared-card` rows on the person's
 * OWN-DEVICES store, beside the contact book and never in it.
 *
 * Sharing my contact link is choosing to be reachable by whoever opens it, so the FIRST turn that carries the link's
 * token is let on as if the person had chosen its sender (the door gives it a thread, holds the card, writes no book row
 * until the person answers). Every share mints a NEW link for the persona shared as (Frits 2026-11-12: one link per
 * sharing moment, per persona, used once, valid 30 days); its first opener uses it up, and anyone after lands in
 * requests like any stranger.
 *
 * "Used once" across the person's devices: two devices may each let on a different first opener before they hear of
 * each other. The use is a CLAIM (`assignee` = who, `claimedAt` = when), resolved first-wins by the store's claim
 * channel, so both devices end on the earlier opener; `usedBy` says who won, for the door to demote the loser's thread
 * to a request.
 *
 * Bounded (internal params): how long a link lives, how many UNUSED links a persona keeps (the oldest unused goes).
 * Withdrawing a link deletes its row; a turn carrying it later is decided as any stranger's.
 */

import nacl from 'tweetnacl';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { decodeContactCard } from './contactCard.js';

export const SHARED_CARD_TTL_MS = param({ key: 'pinboard.sharedCardTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * 24 * 60 * 60 * 1000 });
export const SHARED_CARDS_UNUSED_MAX = param({ key: 'pinboard.sharedCardsUnusedMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20 });

const SHARED = 'shared-card';

/** 128 random bits, base64url without padding (22 characters). */
function freshToken() {
  const bytes = nacl.randomBytes(16);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const std = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return std.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

const usedOf = (r) => (typeof r?.assignee === 'string' && r.assignee ? r.assignee : null);
const CARD_PREFIX = 'onderling-contact://';

/** The opener's name from the card their turn carried, only when that card names the link's opener (else null). */
function openerName(r) {
  const by = usedOf(r);
  if (!by || typeof r?.card !== 'string' || !r.card.startsWith(CARD_PREFIX)) return null;
  try {
    const c = decodeContactCard(r.card.slice(CARD_PREFIX.length));
    if (!c || (c.webid !== by && c.pubKey !== by && c.peerAddr !== by)) return null;
    return (typeof c.displayName === 'string' && c.displayName.trim()) ? c.displayName.trim() : (c.handle ?? null);
  } catch { return null; }
}

/** A link as the module returns it: its token, when it was made and ends, and whether (and by whom, when) it was used. */
function view(r) {
  const usedBy = usedOf(r);
  return {
    token: r.token, mintedAt: r.mintedAt, expiresAt: r.expiresAt,
    state: usedBy ? 'used' : 'unused', usedBy, usedAt: usedBy && Number.isFinite(r.claimedAt) ? r.claimedAt : null,
    usedByName: openerName(r),
  };
}

/**
 * @param {object} [args]
 * @param {() => Promise<object>|object} args.store the own-devices store the contact book writes to (`contacts.ownStore`)
 * @param {(persona: string|null) => ({id: string, writer: string}|null)} [args.selfFor] which self a persona names (the
 *   contact book's own resolver); null when this device does not hold that self
 * @param {() => number} [args.now]
 */
export function createSharedCards({ store, selfFor = null, now = Date.now } = {}) {
  if (typeof store !== 'function') throw new TypeError('shared cards: store required (the contact book\'s own-devices store)');
  const getStore = async () => store();
  const self = (persona) => (typeof selfFor === 'function' ? selfFor(persona ?? null) : { id: 'default', writer: 'me' });
  const rowId = (selfId, token) => `${SHARED}:${selfId}:${token}`;
  const rowsOf = async (selfId) => ((await (await getStore()).listByType?.(SHARED)) ?? []).filter((r) => r?.self === selfId);
  const expired = (r) => !(Number.isFinite(r?.expiresAt) && now() <= r.expiresAt);

  // ONE WRITE AT A TIME PER SELF (a mint reads the self's links to keep the bound; a use reads then claims)
  const turnsOf = new Map();
  const inTurn = (key, fn) => {
    const run = (turnsOf.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    const settled = run.catch(() => {});
    turnsOf.set(key, settled);
    settled.then(() => { if (turnsOf.get(key) === settled) turnsOf.delete(key); });
    return run;
  };

  /** Make a new link for the persona shared as. @returns {Promise<{token: string, expiresAt: number}|null>} null: no such self here */
  async function mint({ persona = null } = {}) {
    const me = self(persona);
    if (!me) return null;
    return inTurn(me.id, async () => {
      const st = await getStore();
      const mine = await rowsOf(me.id);
      for (const r of mine.filter(expired)) await st.delete(r.id);
      const unused = mine.filter((r) => !expired(r) && !usedOf(r)).sort((a, b) => (a.mintedAt ?? 0) - (b.mintedAt ?? 0));
      for (const r of unused.slice(0, Math.max(0, unused.length - SHARED_CARDS_UNUSED_MAX + 1))) await st.delete(r.id);
      const token = freshToken();
      const at = now();
      await st.put({ type: SHARED, id: rowId(me.id, token), self: me.id, token, mintedAt: at, expiresAt: at + SHARED_CARD_TTL_MS }, { by: me.writer });
      return { token, expiresAt: at + SHARED_CARD_TTL_MS };
    });
  }

  /** This persona's live links, newest first (an expired one is not listed). */
  async function list({ persona = null } = {}) {
    const me = self(persona);
    if (!me) return [];
    return (await rowsOf(me.id)).filter((r) => !expired(r)).map(view).sort((a, b) => (b.mintedAt ?? 0) - (a.mintedAt ?? 0));
  }

  /**
   * A turn addressed to `persona` carries `token` from opener `by`: let them on if the link is this persona's, live, and
   * unused or already theirs. The use is written as a first-wins claim.
   * @returns {Promise<{ok: true} | {ok: false, reason: 'unknown'|'expired'|'used'|'no-self'}>}
   */
  async function use({ token, by, persona = null, card = null } = {}) {
    if (typeof by !== 'string' || !by) throw new TypeError('shared cards: by (the opener) required');
    const me = self(persona);
    if (!me) return { ok: false, reason: 'no-self' };
    if (typeof token !== 'string' || !token) return { ok: false, reason: 'unknown' };
    return inTurn(me.id, async () => {
      const st = await getStore();
      const r = await st.get(rowId(me.id, token));
      if (!r || r.type !== SHARED || r.self !== me.id || r.token !== token) return { ok: false, reason: 'unknown' };
      if (expired(r)) return { ok: false, reason: 'expired' };
      const usedBy = usedOf(r);
      if (usedBy) return usedBy === by ? { ok: true } : { ok: false, reason: 'used' };
      await st.put({ ...r, assignee: by, claimedAt: now(), ...(typeof card === 'string' && card.startsWith(CARD_PREFIX) ? { card } : {}) }, { by: me.writer });
      return { ok: true };
    });
  }

  /** Who used this persona's link (after the devices' claims resolved), or null. */
  async function usedBy(token, { persona = null } = {}) {
    const me = self(persona);
    if (!me || typeof token !== 'string' || !token) return null;
    return usedOf(await (await getStore()).get(rowId(me.id, token)));
  }

  /** Withdraw a link: its row goes; a turn carrying it later is decided as any stranger's. False when there was none. */
  async function withdraw(token, { persona = null } = {}) {
    const me = self(persona);
    if (!me || typeof token !== 'string' || !token) return false;
    return inTurn(me.id, async () => {
      const st = await getStore();
      const id = rowId(me.id, token);
      if (!(await st.get(id))) return false;
      await st.delete(id);
      return true;
    });
  }

  return { mint, list, use, usedBy, withdraw };
}
