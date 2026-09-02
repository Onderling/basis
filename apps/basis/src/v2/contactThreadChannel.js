/**
 * contactThreadChannel — the CLIENT end of a contact/bot peer link
 * (feedback-extension, the platform half of "journey A").
 *
 * made a bot's named skills dispatchable (a slash command → a router). This
 * is the COMPLEMENT: a free-text conversation with a contact-bot in its own DM
 * thread — the participant sends a turn, the bot replies asynchronously, the
 * reply lands back in that thread. It is the client mirror of the feedback
 * repo's `PeerBridge` (which is the bot SIDE of the same link).
 *
 * TRANSPORT-AGNOSTIC by construction: it rides an injected `sendToPeer(addr,
 * payload)` — i.e. `agent.sendPeerMessage` / `sa.peer.sendTo`, which routes
 * through `core` `RoutingStrategy` (priority: internal > local > mdns >
 * rendezvous > relay > nkn > … > a2a). So the same channel reaches the bot over
 * mDNS on a LAN, a WebRTC rendezvous/relay link on the internet, or NKN as the
 * bootstrap/fallback rung — the channel never names a transport. Inbound replies
 * arrive via the shell's existing `makePeerRouter` subtype dispatch.
 *
 * SUBTYPE-INJECTABLE so the platform stays decoupled from any one bot's wire
 * shape (the repo-boundary rule: the platform ships the generic channel; a bot's
 * project wiring — e.g. feedback's `PeerBridge` with `fp-msg`/`fp-reply` — passes
 * its own subtypes). Defaults to the generic `contact-msg`/`contact-reply`.
 *
 * Pure: no DOM, no RN, no transport import — web and mobile share it; each shell
 * injects `sendToPeer` + registers `replyHandler(onReply)` in its peer router.
 */

import { createAddressedDeliver, chatTurnsFromItems } from '@onderling/item-store';

/** Generic platform subtypes for a contact-thread turn / reply. */
export const DEFAULT_CONTACT_SUBTYPES = { out: 'contact-msg', in: 'contact-reply' };

/**
 * @param {object} deps
 * @param {(addr: string, payload: object) => any} deps.sendToPeer
 *   the shell's peer send (`agent.sendPeerMessage` / `sa.peer.sendTo`).
 * @param {{ out: string, in: string }} [deps.subtypes]
 *   wire subtypes for outbound turns / inbound replies. Default generic; a bot's
 *   project wiring overrides (e.g. `{ out:'fp-msg', in:'fp-reply' }`).
 * @param {() => number} [deps.now]   clock (injectable for tests).
 * @param {() => string} [deps.genId] message-id factory (injectable for tests).
 * @param {object | (() => object|Promise<object>) | null} [deps.itemStore]
 *   Connectivity Phase 2 (C3): an `{ addItems, listOpen }` store (wireChat's
 *   item-store surface). WHEN WIRED, every turn — outbound (`sendTurn`) and
 *   inbound (`persistInbound`) — is persisted to a durable thread + rehydratable
 *   (`rehydrate`), so the contact/bot DM survives a reload (**the G18 fix**).
 *   Omitted → today's ephemeral behaviour (fully back-compatible). May be a
 *   value / Promise / thunk so a shell can wire a store built asynchronously.
 * @param {string | null} [deps.localActor]      my webid (persisted `source.fromWebid`).
 * @param {string | null} [deps.localStableId]
 * @returns {{
 *   sendTurn: (turn: object) => { messageId: string, sent: Promise<any> },
 *   persistInbound: (turn: object) => Promise<{ itemId: string|null }>,
 *   rehydrate: (contactId: string) => Promise<Array<object>>,
 *   replyHandler: (onReply: (reply: object) => void) => ((fromAddr: string, payload: object) => void),
 *   messageHandler: (onMessage: (msg: object) => void) => ((fromAddr: string, payload: object) => void),
 *   subtypes: { out: string, in: string },
 * }}
 */
export function createContactThreadChannel({
  sendToPeer,
  subtypes = DEFAULT_CONTACT_SUBTYPES,
  now = () => Date.now(),
  genId,
  itemStore = null,
  localActor = null,
  localStableId = null,
} = {}) {
  const mkId = typeof genId === 'function'
    ? genId
    : () => `ct-${now()}-${Math.random().toString(36).slice(2, 8)}`;

  // The shared addressed-send core (C3). `sendTurn` now routes through this
  // instead of a bare ephemeral peer-send: it still sends over the injected
  // `sendToPeer`, but ALSO persists the turn (when an itemStore is wired) — the
  // durable half lifted from wireChat. `toWire` reproduces the EXACT legacy
  // contact payload so existing receivers/bots are byte-unaffected; the
  // Envelope's `kind` carries the caller's configured `subtypes.out`.
  const core = createAddressedDeliver({
    send:    (addr, payload) => sendToPeer(addr, payload),
    toWire:  (env) => buildContactWire(env),
    itemStore,
    localActor,
    localStableId,
  });

  /** Project a canonical Envelope onto the legacy contact wire payload. */
  function buildContactWire(env) {
    const payload = {
      subtype:   env.kind,
      threadId:  env.extras?.threadId,
      text:      env.body ?? '',
      messageId: env.id,
      replyTo:   env.extras?.replyTo,
      ts:        env.ts,
    };
    if (env.extras?.displayName) payload.displayName = env.extras.displayName;
    if (env.extras?.webid)       payload.webid       = env.extras.webid;
    return payload;
  }

  /**
   * Send one conversational turn to the contact's bot over the peer transport,
   * AND (when an itemStore is wired) persist it to the durable thread.
   *
   * @param {object} turn
   * @param {string}  turn.peerAddr     the bot's peer address (from the contact record).
   * @param {string}  turn.threadId     the contact-thread id (so the reply routes back here).
   * @param {string}  turn.text         the user's message.
   * @param {string}  [turn.messageId]  caller-supplied id (else generated) — echoed on the reply's `replyTo`.
   * @param {string}  [turn.replyTo]    id of a prior bot message this answers (for IR round-trips).
   * @param {object}  [turn.sender]     `{ displayName?, webid? }` so the bot knows who it's talking to.
   * @returns {{ messageId: string, sent: Promise<any> }}
   *   the (possibly generated) message id + a promise for the SEND-AND-PERSIST
   *   (not the reply, which arrives asynchronously through `replyHandler`).
   */
  function sendTurn({ peerAddr, threadId, text, messageId, replyTo, sender } = {}) {
    if (!peerAddr) throw new Error('contactThreadChannel.sendTurn: peerAddr is required');
    if (typeof sendToPeer !== 'function') throw new Error('contactThreadChannel: sendToPeer is required');
    const id = messageId ?? mkId();
    const envelope = {
      id,
      kind:   subtypes.out,
      ts:     now(),
      author: sender?.webid ?? localActor ?? null,
      body:   text ?? '',
      extras: {
        threadId,
        threadKey: threadId,     // the LOCAL thread group id (the contact id)
        replyTo,
        ...(sender?.displayName ? { displayName: sender.displayName } : {}),
        ...(sender?.webid       ? { webid: sender.webid }             : {}),
      },
    };
    const sent = core.deliver(envelope, { to: peerAddr });
    return { messageId: id, sent };
  }

  /**
   * Persist an INBOUND turn (a bot reply or a peer DM) so the thread is durable
   * in BOTH directions (the shell's inbound router forwards to `onReply`/
   * `onMessage` for the live render, and calls this for durability). Dedup is
   * shared with `sendTurn` so a relay-replayed inbound never double-persists.
   *
   * @param {object} turn
   * @param {string}  turn.contactId    the LOCAL thread group id (== the contact).
   * @param {string}  [turn.fromAddr]   the sender's peer address.
   * @param {string}  [turn.text]
   * @param {string}  [turn.messageId]  the sender's msg id (dedup key).
   * @param {Array}   [turn.buttons]
   * @param {string}  [turn.replyTo]
   * @param {number}  [turn.ts]
   * @returns {Promise<{ itemId: string|null, deduped?: boolean }>}
   */
  function persistInbound({ contactId, fromAddr, text, messageId, buttons, replyTo, ts, file } = {}) {
    const envelope = {
      id:     messageId ?? mkId(),
      kind:   subtypes.in,
      ts:     typeof ts === 'number' ? ts : now(),
      author: fromAddr ?? null,
      body:   text ?? '',
      extras: {
        threadKey: contactId,
        peerAddr:  fromAddr,
        replyTo,
        ...(Array.isArray(buttons) ? { buttons } : {}),
        // A received peer-wire file (photo, document) — the thread is its durable home.
        ...(file && typeof file === 'object' ? { file } : {}),
      },
    };
    return core.persistInbound(envelope, { to: fromAddr });
  }

  /**
   * Rehydrate a contact's durable thread from the itemStore — the ordered turns
   * (`{ origin:'user'|'bot', text, … }`) the contact-thread UI renders. Empty
   * when no itemStore is wired (ephemeral mode) or the thread has no history.
   *
   * @param {string} contactId
   * @returns {Promise<Array<object>>}
   */
  async function rehydrate(contactId) {
    let store = typeof itemStore === 'function' ? itemStore() : itemStore;
    store = await store;
    if (!store || typeof store.listOpen !== 'function') return [];
    let items = [];
    try { items = await store.listOpen({}); } catch { return []; }
    return chatTurnsFromItems(items, { threadKey: contactId });
  }

  /**
   * Build a `makePeerRouter`-compatible handler for the inbound reply subtype.
   * Register it under `subtypes.in` in the shell's peer router; it normalises
   * the bot's reply envelope and forwards it to `onReply`.
   *
   * @param {(reply: { fromAddr: string, threadId?: string, text: string, buttons?: object[], replyTo?: string, messageId?: string }) => void} onReply
   * @returns {(fromAddr: string, payload: object) => void}
   */
  function replyHandler(onReply) {
    return makeInboundHandler(subtypes.in, onReply);
  }

  /**
   * Build a `makePeerRouter`-compatible handler for an INBOUND PEER TURN (S1 #3 —
   * peer↔peer DM). A bot answers with `subtypes.in` (`contact-reply`); a PERSON
   * DMs you with the SAME `subtypes.out` (`contact-msg`) they'd send anywhere —
   * peer DM is symmetric. Register this under `subtypes.out` so a peer's message
   * lands in your thread with them (routed by sender address, since their
   * `threadId` is their own view, not yours). Same normalised shape as a reply.
   *
   * @param {(msg: { fromAddr: string, threadId?: string, text: string, buttons?: object[], replyTo?: string, messageId?: string }) => void} onMessage
   * @returns {(fromAddr: string, payload: object) => void}
   */
  function messageHandler(onMessage) {
    return makeInboundHandler(subtypes.out, onMessage);
  }

  function makeInboundHandler(subtype, cb) {
    return function onContactInbound(fromAddr, payload) {
      if (!payload || payload.subtype !== subtype) return;   // not ours
      if (typeof cb !== 'function') return;
      cb({
        fromAddr,
        threadId:  payload.threadId,
        text:      payload.text ?? '',
        buttons:   Array.isArray(payload.buttons) ? payload.buttons : undefined,
        replyTo:   payload.replyTo,
        messageId: payload.messageId,
      });
    };
  }

  return { sendTurn, persistInbound, rehydrate, replyHandler, messageHandler, subtypes };
}
