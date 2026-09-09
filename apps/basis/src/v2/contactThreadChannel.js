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
import { applyPresendFloor } from './presendFloor.js';

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
 * @param {(peerAddr: string, threadId: string) => object|null} [deps.floorFor]
 *   the PRE-SEND FLOOR a contact declares (see presendFloor.js): a redaction config, or null. Applied
 *   in `sendTurn` before the turn leaves the device; a turn may also carry its own `floor`.
 * @param {((turn: object) => any) | null} [deps.fanToOwnDevices]
 *   hand a turn to the person's OTHER DEVICES (`contactTurnFan.js`). A DM is addressed to a person
 *   but arrives at one device, so without this the thread reads differently on each of them. Wired
 *   HERE, at the one place every turn in either direction passes, so both shells get it by
 *   construction. Omitted → the turn stays on this device (today's behaviour, and the honest state
 *   for a composition with no peer transport).
 * @param {string | null} [deps.localActor]      my webid (persisted `source.fromWebid`).
 * @param {string | null} [deps.localStableId]
 * @returns {{
 *   sendTurn: (turn: object) => { messageId: string, sent: Promise<any> },
 *   persistInbound: (turn: object) => Promise<{ itemId: string|null }>,
 *   persistOutbound: (turn: object) => Promise<{ itemId: string|null }>,
 *   applyOwnDeviceTurn: (wire: object) => Promise<object>,
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
  blobStore = null,
  floorFor = null,
  fanToOwnDevices = null,
} = {}) {
  const mkId = typeof genId === 'function'
    ? genId
    : () => `ct-${now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Hand a turn to the owner's other devices. Never throws and never delays the caller's own
   * result: a sibling that misses a turn has an incomplete thread, which must not become a failed
   * send or a message this device refuses to store.
   */
  async function fanOwn(turn) {
    if (typeof fanToOwnDevices !== 'function') return;
    try { await fanToOwnDevices(turn); }
    catch (err) {
      if (typeof console !== 'undefined') {
        console.warn(`[contact-turns] could not reach my own devices with this turn: ${err?.message ?? err}`);
      }
    }
  }

  // The shared addressed-send core (C3). `sendTurn` now routes through this
  // instead of a bare ephemeral peer-send: it still sends over the injected
  // `sendToPeer`, but ALSO persists the turn (when an itemStore is wired) — the
  // durable half lifted from wireChat. `toWire` reproduces the EXACT legacy
  // contact payload so existing receivers/bots are byte-unaffected; the
  // Envelope's `kind` carries the caller's configured `subtypes.out`.
  const core = createAddressedDeliver({
    // The bytes of a received file go HERE, not into the thread's snapshot item.
    blobStore,
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
   * @param {object|null} [turn.floor]  a pre-send redaction config for THIS turn (else `floorFor` decides).
   * @returns {{ messageId: string, sent: Promise<any>, text: string, redacted: number }}
   *   the (possibly generated) message id + a promise for the SEND-AND-PERSIST
   *   (not the reply, which arrives asynchronously through `replyHandler`), plus the text that
   *   actually left the device (redacted when a floor applied) and how many items the floor took.
   */
  function sendTurn({ peerAddr, threadId, text, messageId, replyTo, sender, floor } = {}) {
    if (!peerAddr) throw new Error('contactThreadChannel.sendTurn: peerAddr is required');
    if (typeof sendToPeer !== 'function') throw new Error('contactThreadChannel: sendToPeer is required');
    const id = messageId ?? mkId();
    // The pre-send floor: what a contact declared is applied HERE, the one place every shell's turn
    // passes, so nothing raw leaves the device for such a contact — and the durable copy below is the
    // redacted one, so the thread remembers what actually went out.
    const cfg = floor !== undefined ? floor : (typeof floorFor === 'function' ? floorFor(peerAddr, threadId) : null);
    const floored = applyPresendFloor(text ?? '', cfg);
    const envelope = {
      id,
      kind:   subtypes.out,
      ts:     now(),
      author: sender?.webid ?? localActor ?? null,
      body:   floored.text,
      extras: {
        threadId,
        threadKey: threadId,     // the LOCAL thread group id (the contact id)
        replyTo,
        ...(sender?.displayName ? { displayName: sender.displayName } : {}),
        ...(sender?.webid       ? { webid: sender.webid }             : {}),
      },
    };
    // The fan rides the SEND's promise, after the turn has actually gone out and been stored — so a
    // sibling is never shown a message that this device failed to send. What it carries is the
    // redacted text, the same bytes the contact received and the same bytes stored here.
    const sent = Promise.resolve(core.deliver(envelope, { to: peerAddr })).then(async (res) => {
      // A resend of a turn already stored has already been fanned once; fanning it again would put a
      // second copy on every sibling's wire for nothing.
      if (!res?.deduped) {
        await fanOwn({
          direction: 'out', contactId: threadId, peerAddr, replyTo,
          text: floored.text, messageId: id, ts: envelope.ts,
        });
      }
      return res;
    });
    return { messageId: id, sent, text: floored.text, redacted: floored.hits.length };
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
   * @param {boolean} [turn.viaOwnDevice]  this turn ARRIVED from one of my own devices' fan — store
   *   it, do not send it onward. Without this the two devices would hand the same turn back and
   *   forth: each hand-off looks like a fresh arrival to the other.
   * @returns {Promise<{ itemId: string|null, deduped?: boolean }>}
   */
  function persistInbound({ contactId, fromAddr, text, messageId, buttons, replyTo, ts, file, viaOwnDevice = false } = {}) {
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
    return Promise.resolve(core.persistInbound(envelope, { to: fromAddr })).then(async (res) => {
      // Only a turn that actually landed is worth fanning: a duplicate has already been fanned once,
      // and re-fanning it would put a second copy on every sibling's wire for nothing.
      if (!viaOwnDevice && !res?.deduped) {
        await fanOwn({ direction: 'in', contactId, fromAddr, text, messageId, replyTo, ts, buttons, file });
      }
      return res;
    });
  }

  /**
   * Persist an OUTBOUND turn that already went out by another path — a reply to a
   * noticeboard post travels through the chat op, and this records our side of it in
   * the poster's thread so the conversation it starts is visible here too. No send.
   *
   * @param {object} turn
   * @param {string}  turn.contactId    the LOCAL thread group id (== the contact).
   * @param {string}  [turn.peerAddr]   the recipient's peer address.
   * @param {string}  [turn.text]
   * @param {string}  [turn.messageId]  dedup key (else generated).
   * @param {string}  [turn.replyTo]    what this answers (a post id).
   * @param {number}  [turn.ts]
   * @param {boolean} [turn.viaOwnDevice]  arrived from my own device's fan — store, do not re-send.
   * @returns {Promise<{ itemId: string|null, deduped?: boolean }>}
   */
  function persistOutbound({ contactId, peerAddr, text, messageId, replyTo, ts, viaOwnDevice = false } = {}) {
    const envelope = {
      id:     messageId ?? mkId(),
      kind:   subtypes.out,
      ts:     typeof ts === 'number' ? ts : now(),
      author: localActor ?? null,
      body:   text ?? '',
      extras: { threadId: contactId, threadKey: contactId, peerAddr, replyTo },
    };
    return Promise.resolve(core.persistOutbound(envelope, { to: peerAddr ?? contactId })).then(async (res) => {
      if (!viaOwnDevice && !res?.deduped) {
        await fanOwn({ direction: 'out', contactId, peerAddr, text, messageId: envelope.id, replyTo, ts: envelope.ts });
      }
      return res;
    });
  }

  /**
   * Land a turn that one of MY OWN DEVICES fanned here (`contactTurnFan.js` verified the sender
   * before calling this). One function rather than a direction branch in each shell: which of the
   * two persist paths a fanned turn takes is this module's business, not a projector's.
   *
   * It answers what the shell needs to PAINT — the thread it belongs to, which side of the
   * conversation it is, and whether it was already known — so the shell adds a bubble or does
   * nothing, and never has to work out either from the wire.
   *
   * @param {object} wire  a turn from the fan (`contactTurnToWire`'s shape)
   * @returns {Promise<{ contactId: string, origin: 'user'|'bot', deduped: boolean, itemId: string|null,
   *   text: string, messageId?: string, replyTo?: string, ts?: number, buttons?: Array, file?: object,
   *   fromAddr?: string }>}
   */
  async function applyOwnDeviceTurn(wire = {}) {
    const { direction, contactId, peerAddr, fromAddr, text = '', messageId, replyTo, ts, buttons, file } = wire;
    const outbound = direction === 'out';
    const res = outbound
      ? await persistOutbound({ contactId, peerAddr, text, messageId, replyTo, ts, viaOwnDevice: true })
      : await persistInbound({ contactId, fromAddr, text, messageId, buttons, replyTo, ts, file, viaOwnDevice: true });
    return {
      contactId,
      origin:  outbound ? 'user' : 'bot',
      deduped: res?.deduped === true,
      itemId:  res?.itemId ?? null,
      text, messageId, replyTo, ts, buttons, file, fromAddr, peerAddr,
    };
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
    // Re-attach each file's bytes from the blob store, so a renderer reading `turn.file.dataB64`
    // is unchanged by the fact that the item never held them.
    return core.attachBytes(chatTurnsFromItems(items, { threadKey: contactId }));
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

  return { sendTurn, persistInbound, persistOutbound, applyOwnDeviceTurn, rehydrate, replyHandler, messageHandler, subtypes };
}
