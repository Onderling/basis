/**
 * MessageRequests — first messages from people the person did not choose: `message-request` rows on the person's
 * OWN-DEVICES store, beside the contact book and never in it.
 *
 * Why beside and not a flag on the book: every reader of the book (the delivery receipt, the person key's allowlist,
 * Contacten) asks "is this someone I chose?". A request row in the book would make each of them filter, and the one that
 * forgets turns a stranger into a contact. Here a stranger is simply not in the book until the person accepts.
 *
 * One request per (self, sender identity): its id is `message-request:<selfId>:<from>`, written AS that self, so it
 * rides that self's own-devices lane only. Its turns are a set that grows by union between the person's devices (the
 * type's `set-union`), keyed by message id; the bound drops the oldest by raising the floor, so every device drops the
 * same turns.
 *
 * Bounded (all internal params): requests per self, turns per request, text per request, how long an ignored request is
 * kept after its last turn. Files are never kept on a request. The stranger door's own budgets (bytes per turn, turns
 * per key per day, stranger turns per hour) sit in front of this, unchanged.
 *
 * What decides that a sender IS a stranger (the door) is not here: this module holds what the door sends it. A BLOCKED
 * sender never reaches it: the secure agent's block set (`/block`, alias-aware) drops their envelopes before any channel
 * sees them. Accept is the book's add of the held card plus `remove` here; block is the block set's add plus `remove`
 * here; the caller does both.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { decodeContactCard } from './contactCard.js';

export const MESSAGE_REQUESTS_MAX = param({ key: 'pinboard.messageRequestsMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });
export const MESSAGE_REQUEST_TURNS_MAX = param({ key: 'pinboard.messageRequestTurnsMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20 });
export const MESSAGE_REQUEST_TEXT_MAX_BYTES = param({ key: 'pinboard.messageRequestTextMaxBytes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 64 * 1024 });
export const MESSAGE_REQUEST_IGNORED_KEEP_MS = param({ key: 'pinboard.messageRequestIgnoredKeepMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * 24 * 60 * 60 * 1000 });

const REQUEST = 'message-request';
const CARD_PREFIX = 'onderling-contact://';

const bytesOf = (s) => new TextEncoder().encode(String(s ?? '')).length;

/** The card a request holds, decoded; null when it does not decode or names nobody. */
function cardOf(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(CARD_PREFIX)) return null;
  try {
    const card = decodeContactCard(payload.slice(CARD_PREFIX.length));
    return card?.webid ? card : null;
  } catch { return null; }
}

/** A request row as the module returns it: the self it is for, the card's (unverified) name, the turns in order. */
function view(row) {
  const turns = [...(row.turns ?? [])].sort((a, b) => (a.ts - b.ts) || String(a.messageId).localeCompare(String(b.messageId)));
  return {
    id: row.id, self: row.self, from: row.from, card: row.card, name: cardOf(row.card)?.displayName ?? null,
    turns, turnsBefore: Number.isFinite(row.turnsBefore) ? row.turnsBefore : null,
    firstAt: row.firstAt ?? null, lastAt: row.lastAt ?? null, state: row.state === 'ignored' ? 'ignored' : 'open',
  };
}

/**
 * @param {object} [args]
 * @param {() => Promise<object>|object} args.store the own-devices store the contact book writes to (`contacts.ownStore`)
 * @param {(persona: string|null) => ({id: string, writer: string}|null)} [args.selfFor] which self a persona names: its
 *   id and its webid (`createdBy`); null when this device does not hold that self (the contact book's own resolver)
 * @param {() => number} [args.now]
 */
export function createMessageRequests({ store, selfFor = null, now = Date.now } = {}) {
  if (typeof store !== 'function') throw new TypeError('message requests: store required (the contact book\'s own-devices store)');
  const getStore = async () => store();
  const self = (persona) => (typeof selfFor === 'function' ? selfFor(persona ?? null) : { id: 'default', writer: 'me' });
  const requestId = (selfId, from) => `${REQUEST}:${selfId}:${from}`;
  const rowsOf = async (type, selfId) => ((await (await getStore()).listByType?.(type)) ?? []).filter((r) => r?.self === selfId);

  /** An ignored request past its keep time is gone: dropped on the next write, never listed. */
  const expired = (r) => r.state === 'ignored' && Number.isFinite(r.lastAt) && now() - r.lastAt > MESSAGE_REQUEST_IGNORED_KEEP_MS;

  // ONE WRITE AT A TIME PER SELF (a hold reads the self's requests to keep the bound)
  const turnsOf = new Map();
  const inTurn = (key, fn) => {
    const run = (turnsOf.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    const settled = run.catch(() => {});
    turnsOf.set(key, settled);
    settled.then(() => { if (turnsOf.get(key) === settled) turnsOf.delete(key); });
    return run;
  };

  /**
   * Hold one turn from a sender who is not known to this self.
   * @returns {Promise<{held: true, request: object} | {held: false, reason: string}>}
   */
  async function hold({ from, card, messageId, text = '', ts, file = null, persona = null } = {}) {
    if (typeof from !== 'string' || !from) throw new TypeError('message requests: from required');
    if (typeof messageId !== 'string' || !messageId) throw new TypeError('message requests: messageId required');
    if (!Number.isFinite(ts)) throw new TypeError('message requests: ts must be a time');
    const me = self(persona);
    if (!me) return { held: false, reason: 'no-self' };
    return inTurn(me.id, async () => {
      if (file) return { held: false, reason: 'file-on-request' };
      if (bytesOf(text) > MESSAGE_REQUEST_TEXT_MAX_BYTES) return { held: false, reason: 'turn-too-large' };
      const st = await getStore();
      const mine = await rowsOf(REQUEST, me.id);
      for (const r of mine.filter(expired)) await st.delete(r.id);
      const live = mine.filter((r) => !expired(r));
      const id = requestId(me.id, from);
      const before = live.find((r) => r.id === id) ?? null;
      // the card: a NEW request needs one (the first message carries it; later turns need not), and any card given must
      // name the sender
      if (card != null || !before) {
        const decoded = cardOf(card);
        if (!decoded) return { held: false, reason: card == null ? 'no-card' : 'malformed-card' };
        if (decoded.webid !== from && decoded.pubKey !== from) return { held: false, reason: 'card-not-sender' };
      }

      // the turns: a union by message id, the oldest dropped to keep both bounds (the floor says how far)
      const byId = new Map((before?.turns ?? []).map((t) => [t.messageId, t]));
      if (!byId.has(messageId) && !(Number.isFinite(before?.turnsBefore) && ts < before.turnsBefore)) byId.set(messageId, { messageId, text: String(text), ts });
      let turns = [...byId.values()].sort((a, b) => (a.ts - b.ts) || a.messageId.localeCompare(b.messageId));
      let floor = Number.isFinite(before?.turnsBefore) ? before.turnsBefore : null;
      const total = () => turns.reduce((n, t) => n + bytesOf(t.text), 0);
      while (turns.length > MESSAGE_REQUEST_TURNS_MAX || total() > MESSAGE_REQUEST_TEXT_MAX_BYTES) {
        turns = turns.slice(1);
        floor = Math.max(floor ?? -Infinity, turns[0].ts);
      }

      // a new request past the bound: the oldest ignored goes first, then the oldest open
      if (!before && live.length >= MESSAGE_REQUESTS_MAX) {
        const byAge = (a, b) => (a.lastAt ?? 0) - (b.lastAt ?? 0);
        const ignored = live.filter((r) => r.state === 'ignored').sort(byAge);
        const open = live.filter((r) => r.state !== 'ignored').sort(byAge);
        for (const r of [...ignored, ...open].slice(0, live.length - MESSAGE_REQUESTS_MAX + 1)) await st.delete(r.id);
      }

      const row = await st.put({
        ...(before ? { createdAt: before.createdAt, createdBy: before.createdBy } : {}),
        type: REQUEST, id, self: me.id, from, card: before?.card ?? card, turns,
        ...(floor !== null ? { turnsBefore: floor } : {}),
        firstAt: turns.length ? Math.min(before?.firstAt ?? Infinity, turns[0].ts) : (before?.firstAt ?? ts),
        lastAt: Math.max(before?.lastAt ?? -Infinity, ts),
        state: before?.state === 'ignored' ? 'ignored' : 'open',
      }, { by: me.writer });
      return { held: true, request: view(row) };
    });
  }

  /** This self's requests (open and ignored, newest last turn first); an ignored one past its keep time is not listed. */
  async function list({ persona = null, state = null } = {}) {
    const me = self(persona);
    if (!me) return [];
    return (await rowsOf(REQUEST, me.id)).filter((r) => !expired(r)).map(view)
      .filter((q) => !state || q.state === state)
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
  }

  async function get(from, { persona = null } = {}) {
    const me = self(persona);
    if (!me) return null;
    const r = (await rowsOf(REQUEST, me.id)).find((x) => x.from === from && !expired(x));
    return r ? view(r) : null;
  }

  /** Mark a request ignored: kept, no longer new, later turns still land, still acceptable. Null when there is none. */
  async function ignore(from, { persona = null } = {}) {
    const me = self(persona);
    if (!me) return null;
    return inTurn(me.id, async () => {
      const r = (await rowsOf(REQUEST, me.id)).find((x) => x.from === from && !expired(x));
      if (!r) return null;
      return view(await (await getStore()).put({ ...r, state: 'ignored' }, { by: me.writer }));
    });
  }

  /** Take a request out (accept, once the card is a contact; block, once the block set holds them). False when there was none. */
  async function remove(from, { persona = null } = {}) {
    const me = self(persona);
    if (!me) return false;
    return inTurn(me.id, async () => {
      const r = (await rowsOf(REQUEST, me.id)).find((x) => x.from === from);
      if (!r) return false;
      await (await getStore()).delete(r.id);
      return true;
    });
  }

  return { hold, list, get, ignore, remove };
}
