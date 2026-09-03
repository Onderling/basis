/**
 * addressedDeliver — the ONE addressed send (connectivity Phase 2, §5 / C3).
 *
 * Two 1:1 DM paths used to exist:
 *   1. `apps/basis/.../contactThreadChannel` — `contact-msg`/`contact-reply`
 *      over the injected `sendToPeer` (`agent.sendPeerMessage`), EPHEMERAL: the
 *      turn was only ever pushed into an in-memory `contactThreads` Map, so a
 *      reload lost the whole bot/contact conversation (this was **G18**).
 *   2. wireChat `chat.send` (`@onderling/chat-p2p`) — `chat-message` over
 *      `agent.transportFor(...).sendOneWay`, PERSISTED: it writes a durable
 *      `chat-message` itemStore item (`source.{threadId,fromWebid,nonce,…}`)
 *      and dedupes resends on a `nonce`, so its threads survive restarts.
 *
 * This module collapses the two into ONE primitive:
 *
 *   `deliver(envelope, { to })`  — send the Envelope to the one peer AND (when
 *   an itemStore is wired) persist the turn to a durable thread + dedup on the
 *   message id. A DM is just `deliver` to an audience-of-one; the Envelope's
 *   `kind` (the wire subtype) distinguishes contact-msg vs contact-reply vs
 *   chat-message. Preserving `kind` keeps every existing receiver/bot working.
 *
 * The DURABLE HALF is lifted from wireChat's send-side persistence: the same
 * `type:'chat-message'` item with a `source` carrying the routing/dedup fields,
 * and the same seen-set idempotency (here keyed on the Envelope id, which
 * doubles as a DM's dedup nonce). Making the contact path route through this is
 * the defined durability upgrade — NOT a byte-identical no-op.
 *
 * Transport-agnostic BY CONSTRUCTION: the actual send is the injected `send`
 * (so item-store never imports a transport); the wire projection is the injected
 * `toWire` (so each caller keeps its exact wire shape + subtype). item-store
 * owns only the persistence + dedup half — the half it already owns for wireChat.
 *
 * Built on C10's canonical Envelope (see `chatEnvelope.js` §3):
 *   Envelope { id, author, kind, ts, body?, extras? }
 *     id     = the message id (also the DM dedup nonce)
 *     author = the sender (webid / actor)
 *     kind   = the wire subtype (contact-msg / contact-reply / chat-message)
 *     body   = the text
 *     extras = threadKey (the LOCAL thread group id), threadId (the sender's own
 *              view, echoed on the wire), replyTo, peerAddr, buttons, and the
 *              wire-only presentation fields a projection may carry.
 */

/** The durable DM turn item type (parity with wireChat's persisted chat item). */
export const DM_ITEM_TYPE = 'chat-message';

/**
 * Build the one addressed-send core shared by the 1:1 DM paths: send an Envelope
 * to ONE peer via the injected `send`, then (optionally) persist + dedup the
 * turn. Returns `{ deliver, persistInbound, seenNonces }`. Transport-agnostic —
 * the send and the wire/item projections are injected, so item-store imports no
 * transport and each caller keeps its exact wire shape + subtype.
 *
 * @param {object} deps
 * @param {(toAddr: string, wire: object) => any} deps.send
 *   the injected addressed send to ONE peer (e.g. `agent.sendPeerMessage`).
 * @param {(envelope: object, toAddr: string) => object} [deps.toWire]
 *   project the Envelope onto the caller's exact wire payload (preserves subtype).
 *   Absent → the Envelope itself is sent.
 * @param {(envelope: object, ctx: { to: string|null, direction: 'out'|'in' }) => (object|null|Promise<object|null>)} [deps.toItem]
 *   project the Envelope onto the caller's EXACT persisted item draft (the symmetric
 *   twin of `toWire`, for the durable half). Absent → the default DM item (below).
 *   Return a falsy value to skip persistence for this turn (send-only subtypes).
 *   May be async so a caller can do per-item IO (e.g. writing attachment bytes)
 *   inside the projection — it runs only AFTER a successful send.
 * @param {object | (() => object|Promise<object>) | Promise<object> | null} [deps.itemStore]
 *   an `{ addItems, listOpen }` store (wireChat's item-store surface). Omitted →
 *   the send stays ephemeral (back-compat). May be a value, a Promise, or a thunk
 *   returning either, so a caller can wire a store that builds asynchronously.
 * @param {string | null} [deps.localActor]
 * @param {string | null} [deps.localStableId]
 * @param {Set<string>} [deps.seenNonces]   shared dedup set (out + in).
 */
export function createAddressedDeliver({
  send,
  toWire,
  toItem,
  itemStore = null,
  localActor = null,
  localStableId = null,
  seenNonces = new Set(),
  blobStore = null,
} = {}) {
  if (typeof send !== 'function') {
    throw new Error('createAddressedDeliver: `send` (addressed send fn) is required');
  }

  async function resolveStore() {
    let s = typeof itemStore === 'function' ? itemStore() : itemStore;
    s = await s;
    return s && typeof s.addItems === 'function' ? s : null;
  }

  /** Default persist projection: the durable 1:1 DM item (the contact-thread shape). */
  function defaultToItem(envelope, { to, direction }) {
    const ex = (envelope && typeof envelope.extras === 'object' && envelope.extras) || {};
    const threadKey = ex.threadKey ?? ex.threadId ?? to ?? null;
    return {
      type: DM_ITEM_TYPE,
      text: envelope?.body ?? '',
      visibility: 'household',
      source: {
        dm:           true,           // marks a 1:1 DM turn (vs a circle chat-message)
        threadKey,                    // the LOCAL thread group id (the contact id)
        threadId:     ex.threadId ?? null,
        subtype:      envelope?.kind ?? null,
        direction,                    // 'out' (I sent) | 'in' (I received)
        fromWebid:    envelope?.author ?? localActor ?? null,
        fromStableId: localStableId ?? null,
        peerAddr:     to ?? null,
        replyTo:      ex.replyTo ?? null,
        ...(Array.isArray(ex.buttons) ? { buttons: ex.buttons } : {}),
        // A DM'd FILE (a peer-wire photo, a document) is part of the turn: the thread is its durable
        // home. The item carries the DESCRIPTION — `{id, name, mime, size}` — and never the bytes.
        // Bytes in here would be bytes in a SNAPSHOT: this store is persisted as one serialised value
        // per device, and on Android that value is a single row behind a ~2 MB read window whose failure
        // returns an EMPTY map that the next save writes back over the row. One photo would take the whole
        // thread store with it. The bytes go to `blobStore` under the file id (see `stripBytes`).
        ...(ex.file && typeof ex.file === 'object' ? { file: stripBytes(ex.file) } : {}),
        sentAt:       typeof envelope?.ts === 'number' ? envelope.ts : Date.now(),
        nonce:        envelope?.id ?? null,
      },
    };
  }
  const projectItem = typeof toItem === 'function' ? toItem : defaultToItem;

  /** The description of a file, without its payload — what a snapshot store may hold. */
  function stripBytes(file) {
    const { dataB64, ...rest } = file ?? {};
    return rest;
  }

  /**
   * Hand a turn's bytes to the blob store before the item is written, keyed by the file id. Best-effort
   * by design: if it throws, the turn is still persisted — a thread that shows a file card whose bytes
   * are missing is honest and recoverable; a thread that lost the message is not. With no blobStore
   * wired the bytes are simply dropped rather than persisted inline, because inline is the failure this
   * seam exists to prevent.
   */
  async function stashBytes(envelope) {
    const file = envelope?.extras?.file;
    if (!file || typeof file !== 'object' || typeof file.dataB64 !== 'string' || !file.id) return;
    if (!blobStore || typeof blobStore.put !== 'function') return;
    try { await blobStore.put(file.id, file.dataB64); } catch { /* the turn still lands */ }
  }

  /** Re-attach bytes to projected turns (the read side's inverse of `stashBytes`). */
  async function attachBytes(turns) {
    if (!blobStore || typeof blobStore.get !== 'function') return turns;
    for (const t of turns) {
      if (!t?.file?.id || typeof t.file.dataB64 === 'string') continue;
      try {
        const b64 = await blobStore.get(t.file.id);
        if (typeof b64 === 'string' && b64) t.file = { ...t.file, dataB64: b64 };
      } catch { /* the card renders from its description alone */ }
    }
    return turns;
  }

  /** Persist one turn (out or in) as a durable item, dedup on the msg id. */
  async function persistTurn(envelope, { to, direction }) {
    const store = await resolveStore();
    if (!store) return { itemId: null };
    await stashBytes(envelope);       // bytes out first, so the draft below can only carry the description
    // Project the item FIRST — a falsy draft means "send-only, don't persist"
    // (so a send-only subtype never touches the dedup set either). The
    // projection may be async (a caller may write attachment bytes inside it);
    // it runs only here, after the send has already succeeded.
    const draft = await projectItem(envelope, { to, direction });
    if (!draft) return { itemId: null };
    const nonce = envelope?.id ?? null;
    if (nonce && seenNonces.has(nonce)) return { itemId: null, deduped: true };
    if (nonce) seenNonces.add(nonce);
    const [item] = await store.addItems([draft], { actor: envelope?.author ?? localActor ?? 'me' });
    return { itemId: item?.id ?? null };
  }

  /**
   * Send the Envelope to the one peer, then persist the outbound turn.
   * @returns {Promise<{ sent: any, itemId: string|null, deduped?: boolean }>}
   */
  async function deliver(envelope, { to } = {}) {
    if (!to) throw new Error('deliver: `to` (peer address) is required');
    const wire = typeof toWire === 'function' ? toWire(envelope, to) : envelope;
    const sent = await send(to, wire);
    const { itemId, deduped } = await persistTurn(envelope, { to, direction: 'out' });
    return { sent, itemId, ...(deduped ? { deduped: true } : {}) };
  }

  /**
   * Persist an INBOUND turn (a received reply / peer DM) so the thread is
   * durable in both directions. No send. Dedup shares `seenNonces` with
   * `deliver`, so a resent/relayed inbound never double-persists.
   * @returns {Promise<{ itemId: string|null, deduped?: boolean }>}
   */
  async function persistInbound(envelope, { to } = {}) {
    const peer = to ?? envelope?.extras?.peerAddr ?? null;
    return persistTurn(envelope, { to: peer, direction: 'in' });
  }

  return { deliver, persistInbound, seenNonces, attachBytes };
}

/**
 * Rehydrate a durable DM thread: project persisted DM items back into the
 * ordered turn shape the contact-thread UI renders (`{ origin, text, … }`).
 * The inverse read of `createAddressedDeliver`'s persistence, so a reload
 * reconstructs the conversation (the G18 fix, read side).
 *
 * @param {Array<{ id?:string, text?:string, addedAt?:number, source?:object }>} items
 * @param {{ threadKey?: string }} [opts]  filter to one thread (the contact id).
 * @returns {Array<{ origin:'user'|'bot', text:string, messageId:string, ts:number, replyTo?:string, buttons?:Array }>}
 */
export function chatTurnsFromItems(items, { threadKey } = {}) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const s = it?.source;
    if (!s || s.dm !== true) continue;                       // only DM turns
    if (threadKey != null && s.threadKey !== threadKey) continue;
    out.push({
      origin:    s.direction === 'out' ? 'user' : 'bot',
      text:      it.text ?? '',
      messageId: s.nonce ?? it.id ?? '',
      ts:        typeof s.sentAt === 'number' ? s.sentAt : (it.addedAt ?? 0),
      ...(s.replyTo ? { replyTo: s.replyTo } : {}),
      ...(Array.isArray(s.buttons) ? { buttons: s.buttons } : {}),
      ...(s.file && typeof s.file === 'object' ? { file: s.file } : {}),
    });
  }
  out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  return out;
}
