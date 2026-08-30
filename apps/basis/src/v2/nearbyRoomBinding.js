/**
 * basis v2 — binding the Nearby room to the wire, and holding the room while the screen is away.
 *
 * The room's objects and rules exist (`nearbyAsks.js`, `nearbyRoom.js`, `nearbyInvites.js`), the carrier
 * exists (`nearbyAskChannel.js` — one thin seam over `sendTo`), and the controller (`nearbyScreen.js`) takes
 * them as dependencies. What neither shell ever did was hand them over (found 2026-08-30 on the phone):
 * "Ask the room", "Show my card", room chat and broadcast invites returned `no-channel` on both shells.
 *
 * This is that hand-over, shared so both shells — and a Node companion — compose the same thing:
 *
 *   • OUTBOUND: one `createAskChannel` over `sendPeerMessage`, fanning to the room's current peers. The
 *     controller speaks it for every kind (`broadcast`, `broadcastKind`, `sendAnswer`).
 *   • INBOUND: one router by subtype. Each payload goes through the module that OWNS its shape
 *     (`receiveAsk`, `receiveAnswer`, `receiveCard`, `receiveChatMessage`, `receiveInvite`) — the field
 *     set rebuilt, never spread; `from` taken from the WIRE, never the payload — and then to whoever
 *     subscribed. An unknown subtype is not ours: `onPeerMessage` returns false.
 *
 * THE ROOM OUTLIVES THE SCREEN (Frits, after the two-phone walk of 2026-08-30). The screen subscribes only
 * while it is open, but the room is the people around you, not your tab: an ask that arrived while you
 * were in a thread, the card someone showed, the line someone said — all were gone when the screen came
 * back. So the binding HOLDS the room's state and replays it to the next subscriber:
 *   • asks — live ones (own expiry, room cap), dropped once this device answered them;
 *   • cards — the latest per peer, while that peer is still listed;
 *   • chat — recent lines (bounded), while the peers are listed; nothing is kept once the room empties
 *     (decision G: "nothing here is kept, leaving forgets it" still holds — leaving the ROOM, not the tab);
 *   • invites — live ones (their own short expiry).
 * And it RE-TELLS ITSELF TO A NEWCOMER: when a peer appears, they get my live asks, my card (if shown) and
 * my live invites, so arriving late means seeing the room as it is. Chat is not re-told — a conversation
 * you were not in is not yours to receive.
 *
 * PRESENCE. A room of key fragments is unreadable. On arrival each device also sends `nearby-presence`
 * `{ label }` — the face this device chose for the room (`myFace`), a handle at minimum — and the screen
 * puts it on the row. It is a label, never an identifier (PLAN-nearby §3: two Annas are shown as two).
 *
 * HEARD, NOT SENT. Every room payload carries a `msgId` (the object's own id), which is what the app's
 * delivery honesty already keys on: the receiving shell answers a landed ask/card/chat/invite with the
 * SAME `delivery-receipt` it answers chat with (`makeReceiptSender`, the person's "confirm receipt"
 * setting included), and the sender's shell applies it to the SAME delivery map. The binding adds only
 * the count — which peers confirmed which msgId — because a room ask goes to many and "heard by 2" is
 * the number the asker wants. No second receipt path: `setLandedHook` is the receipt sender, `onReceipt`
 * is fed from the shell's existing receipt handler, `deliveryMap` is the shell's map.
 *
 * WHO MAY SPEAK. No roster vouches for a stranger, and the circle sender authorisation lets anything
 * correctly signed through to the canonical address by design (that door is how a stranger ever becomes a
 * contact). The room's own rule is proximity, decided on THIS device from THIS device's peer list: a
 * `nearby-*` payload is delivered only if its wire `from` is someone the surface lists right now.
 * Enforceable here because the list is ours (enforceability.md).
 *
 * The room address is the wire's address for now (`myAddress`): on mDNS the TXT record already names the
 * key. The per-session ephemeral address of PLAN-nearby §3 is rung-4 work, recorded, not faked here.
 */
import { createAskChannel, ASK_MESSAGE, ANSWER_MESSAGE } from './nearbyAskChannel.js';
import { isAskLive, ASKS_MAX_KEPT } from './nearbyAsks.js';
import { receiveCard, receiveChatMessage, CARD_MESSAGE, CHAT_MESSAGE, CHAT_MAX_KEPT } from './nearbyRoom.js';
import { receiveInvite, isInviteLive, INVITE_MESSAGE } from './nearbyInvites.js';
import { receiveReceipt, deliveryAfterSend } from './deliveryState.js';

export const PRESENCE_MESSAGE = 'nearby-presence';
export const PRESENCE_MAX_LABEL = 40;

/** Every subtype the room speaks — the shells' routers must carry all of them (a fitness test pins it). */
export const NEARBY_ROOM_SUBTYPES = Object.freeze([
  ASK_MESSAGE, ANSWER_MESSAGE, CARD_MESSAGE, CHAT_MESSAGE, INVITE_MESSAGE, PRESENCE_MESSAGE,
]);

/** A presence payload, rebuilt field by field; `from` from the wire. */
export function receivePresence(payload, fromAddress, now = () => Date.now()) {
  if (payload?.subtype !== PRESENCE_MESSAGE) return null;
  const raw = payload.presence;
  if (!raw || typeof raw !== 'object') return null;
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, PRESENCE_MAX_LABEL) : '';
  return Object.freeze({ from: fromAddress ?? null, label: label || null, at: now() });
}

/**
 * @param {object} deps
 * @param {(address: string, payload: object) => Promise<*>} deps.sendPeerMessage  the agent's peer send
 * @param {() => Array<{pubKey?: string, id?: string}>} deps.listPeers            the room's current peers
 * @param {(fn: (peers: Array) => void) => (() => void)} [deps.subscribeToPeers]  arrivals → newcomer sync
 * @param {() => string|null} [deps.myAddress]   what the peer sees as `from` — the wire's answer
 * @param {() => ({label?: string}|null)|Promise<{label?: string}|null>} [deps.myFace]  the face I present
 * @param {() => number} [deps.now]
 * @param {(err: Error, phase: string) => void} [deps.onError]
 */
export function createNearbyRoomBinding({
  sendPeerMessage, listPeers = () => [], subscribeToPeers = null, myAddress = () => null, myFace = null,
  now = () => Date.now(), onError = null, deliveryMap: deliveryMapInput = null,
} = {}) {
  let deliveryMap = deliveryMapInput;
  if (typeof sendPeerMessage !== 'function') throw new TypeError('nearbyRoomBinding: sendPeerMessage required');

  const report = (err, phase) => { try { onError?.(err, phase); } catch { /* diagnostics only */ } };
  const peerId = (p) => p?.pubKey ?? p?.id ?? null;
  const peersNow = () => { try { return listPeers() ?? []; } catch { return []; } };
  const inRoom = (from) => typeof from === 'string' && !!from && peersNow().some((p) => peerId(p) === from);

  // ── The held room ─────────────────────────────────────────────────────────────────────────────────────
  const heldAsks    = new Map();   // ask.id → ask (theirs)
  const heldCards   = new Map();   // from → card
  const heldChat    = [];          // recent lines
  const heldInvites = new Map();   // circleId → invite
  const presence    = new Map();   // from → { label }
  const mine = { asks: new Map(), card: null, invites: new Map() };   // what I said, for newcomers

  const sweep = () => {
    const listed = new Set(peersNow().map(peerId));
    for (const [id, ask] of heldAsks) if (!isAskLive(ask, now)) heldAsks.delete(id);
    for (const [id, ask] of mine.asks) if (!isAskLive(ask, now)) mine.asks.delete(id);
    for (const [cid, inv] of heldInvites) if (!isInviteLive(inv, now)) heldInvites.delete(cid);
    for (const [cid, inv] of mine.invites) if (!isInviteLive(inv, now)) mine.invites.delete(cid);
    for (const from of heldCards.keys()) if (!listed.has(from)) heldCards.delete(from);
    for (const from of presence.keys())  if (!listed.has(from)) presence.delete(from);
    if (listed.size === 0) heldChat.length = 0;    // the room emptied: leaving forgets
  };

  // ── Outbound ──────────────────────────────────────────────────────────────────────────────────────────
  const msgIdOf = (payload) => payload?.ask?.id ?? payload?.card?.id ?? payload?.message?.id ?? payload?.answer?.id
    ?? (payload?.invite ? `inv:${payload.invite.circleId}:${payload.invite.expiresAt}` : null) ?? null;
  const heard = new Map();        // msgId → Set<from>
  const heardSubs = new Set();
  const notifyHeard = (msgId) => {
    const n = heard.get(msgId)?.size ?? 0;
    for (const fn of heardSubs) { try { fn({ msgId, heard: n }); } catch (err) { report(err, 'deliver:heard'); } }
  };
  const askChannel = createAskChannel({
    listPeers,
    sendTo: (address, payload) => {
      const msgId = msgIdOf(payload);
      const stamped = msgId ? { msgId, ...payload } : payload;
      if (msgId) {
        if (!heard.has(msgId)) heard.set(msgId, new Set());
        try { if (deliveryMap?.get?.(msgId) == null) deliveryMap?.set?.(msgId, deliveryAfterSend()); } catch { /* the map is a mirror */ }
      }
      return sendPeerMessage(address, stamped);
    },
    now,
    onError,
  });
  // Remember what I put in the room, so a newcomer can be told; and forget an ask I answered, so the next
  // open does not replay a question already settled.
  const broadcastRaw     = askChannel.broadcast.bind(askChannel);
  const broadcastKindRaw = askChannel.broadcastKind.bind(askChannel);
  const sendAnswerRaw    = askChannel.sendAnswer.bind(askChannel);
  askChannel.broadcast = async (ask) => {
    const r = await broadcastRaw(ask);
    if (ask?.id && isAskLive(ask, now)) mine.asks.set(ask.id, ask);
    return r;
  };
  askChannel.broadcastKind = async (subtype, body) => {
    const r = await broadcastKindRaw(subtype, body);
    if (subtype === CARD_MESSAGE && body?.card) mine.card = body.card;
    if (subtype === INVITE_MESSAGE && body?.invite?.circleId) mine.invites.set(body.invite.circleId, body.invite);
    return r;
  };
  askChannel.sendAnswer = async (answer, toAddress) => {
    const r = await sendAnswerRaw(answer, toAddress);
    if (r?.ok && answer?.askId) heldAsks.delete(answer.askId);
    return r;
  };

  // ── Subscribers ───────────────────────────────────────────────────────────────────────────────────────
  const subs = { ask: new Set(), answer: new Set(), card: new Set(), chat: new Set(), invite: new Set(), presence: new Set() };
  const replay = { ask: () => [...heldAsks.values()], card: () => [...heldCards.values()], chat: () => [...heldChat],
    invite: () => [...heldInvites.values()], presence: () => [...presence.values()], answer: () => [] };
  const subscribe = (kind) => (fn) => {
    if (typeof fn !== 'function') return () => {};
    subs[kind].add(fn);
    sweep();
    for (const v of replay[kind]()) { try { fn(v); } catch (err) { report(err, `deliver:${kind}`); } }
    return () => { subs[kind].delete(fn); };
  };
  const deliver = (kind, value) => {
    for (const fn of subs[kind]) { try { fn(value); } catch (err) { report(err, `deliver:${kind}`); } }
  };
  const hold = {
    ask:      (a) => { sweep(); heldAsks.set(a.id, a); while (heldAsks.size > ASKS_MAX_KEPT) heldAsks.delete(heldAsks.keys().next().value); },
    card:     (c) => { heldCards.set(c.from, c); },
    chat:     (m) => { heldChat.push(m); while (heldChat.length > CHAT_MAX_KEPT) heldChat.shift(); },
    invite:   (i) => { heldInvites.set(i.circleId, i); },
    presence: (p) => { presence.set(p.from, p); },
  };

  // ── Inbound ───────────────────────────────────────────────────────────────────────────────────────────
  let landedHook = null;   // the shell's receipt sender: ({ msgId, fromPeerAddr, source }) => Promise
  const confirm = (from, payload) => {
    const msgId = typeof payload?.msgId === 'string' ? payload.msgId : null;
    if (!msgId || typeof landedHook !== 'function') return;
    try { Promise.resolve(landedHook({ msgId, fromPeerAddr: from, source: 'receiver' })).catch((err) => report(err, 'receipt')); }
    catch (err) { report(err, 'receipt'); }
  };
  const land = (kind, value, from, payload) => {
    if (!value) return;
    hold[kind]?.(value);
    deliver(kind, value);
    confirm(from, payload);
  };
  const gated = (fn) => (from, payload) => {
    if (inRoom(from)) fn(from, payload);
    else report(new Error(`not in the room: ${String(from).slice(0, 12)}`), `refuse:${payload?.subtype}`);
  };
  const handlers = {
    [ASK_MESSAGE]:      gated((from, payload) => land('ask',      askChannel.receiveAsk(payload, from), from, payload)),
    [ANSWER_MESSAGE]:   gated((from, payload) => { const a = askChannel.receiveAnswer(payload, from); if (a) { deliver('answer', a); confirm(from, payload); } }),
    [CARD_MESSAGE]:     gated((from, payload) => land('card',     receiveCard(payload, from, now), from, payload)),
    [CHAT_MESSAGE]:     gated((from, payload) => land('chat',     receiveChatMessage(payload, from, now), from, payload)),
    [INVITE_MESSAGE]:   gated((from, payload) => land('invite',   receiveInvite(payload, from, now), from, payload)),
    [PRESENCE_MESSAGE]: gated((from, payload) => land('presence', receivePresence(payload, from, now))),
  };

  // ── Newcomers ─────────────────────────────────────────────────────────────────────────────────────────
  const known = new Set();
  const sendTo = async (address, payload, phase) => {
    try { await sendPeerMessage(address, payload); } catch (err) { report(err, phase); }
  };
  async function greet(address) {
    let face = null;
    try { face = await (typeof myFace === 'function' ? myFace() : null); } catch { face = null; }
    if (face?.label) await sendTo(address, { subtype: PRESENCE_MESSAGE, presence: { label: String(face.label) } }, 'greet:presence');
    sweep();
    for (const ask of mine.asks.values())      await sendTo(address, { subtype: ASK_MESSAGE, ask }, 'greet:ask');
    if (mine.card)                             await sendTo(address, { subtype: CARD_MESSAGE, card: mine.card }, 'greet:card');
    for (const invite of mine.invites.values()) await sendTo(address, { subtype: INVITE_MESSAGE, invite }, 'greet:invite');
  }
  let greetChain = Promise.resolve();
  const onPeers = (peers) => {
    const ids = new Set((peers ?? []).map(peerId).filter(Boolean));
    for (const id of ids) if (!known.has(id)) { known.add(id); greetChain = greetChain.then(() => greet(id)); }
    for (const id of known) if (!ids.has(id)) known.delete(id);
    sweep();
  };
  let unsubscribePeers = null;
  if (typeof subscribeToPeers === 'function') {
    try { unsubscribePeers = subscribeToPeers(onPeers) ?? null; } catch (err) { report(err, 'subscribeToPeers'); }
  }

  return {
    askChannel,
    subscribeToAsks:     subscribe('ask'),
    subscribeToAnswers:  subscribe('answer'),
    subscribeToCards:    subscribe('card'),
    subscribeToChat:     subscribe('chat'),
    subscribeToInvites:  subscribe('invite'),
    subscribeToPresence: subscribe('presence'),
    myRoomAddress: () => { try { return myAddress() ?? null; } catch { return null; } },
    /** The room's inbound side in the shape both shells' peer routers use (`handlers[subtype](from, payload)`). */
    handlers,
    /** Or call it directly: true when the payload was one of ours (delivered or refused), false otherwise. */
    onPeerMessage(from, payload) {
      const h = handlers[payload?.subtype];
      if (!h) return false;
      try { h(from, payload); } catch (err) { report(err, `receive:${payload.subtype}`); }
      return true;
    },
    /** The controller's dependency bag, ready to spread into `createNearbyScreen({...})`. */
    screenDeps() {
      return {
        askChannel,
        subscribeToAsks:     this.subscribeToAsks,
        subscribeToCards:    this.subscribeToCards,
        subscribeToChat:     this.subscribeToChat,
        subscribeToInvites:  this.subscribeToInvites,
        subscribeToPresence: this.subscribeToPresence,
        myRoomAddress:       this.myRoomAddress,
      };
    },
    /** The shell's receipt sender goes here — the SAME one chat uses. */
    setLandedHook(fn) { landedHook = typeof fn === 'function' ? fn : null; },
    /** The shell's delivery map — the SAME one chat uses; attachable after creation. */
    setDeliveryMap(map) { deliveryMap = map ?? null; },
    /**
     * Fed from the shell's existing `delivery-receipt` handler (which also advances the shell's map):
     * counts which peers confirmed which room msgId. Returns true when the receipt was for something we
     * sent into the room.
     */
    onReceipt(from, payload) {
      const r = receiveReceipt(payload, from);
      if (!r?.messageId || !heard.has(r.messageId)) return false;
      const set = heard.get(r.messageId);
      if (typeof from === 'string' && !set.has(from)) { set.add(from); notifyHeard(r.messageId); }
      return true;
    },
    /** How many peers confirmed a room msgId so far. */
    heardBy: (msgId) => heard.get(msgId)?.size ?? 0,
    subscribeToHeard(fn) { if (typeof fn !== 'function') return () => {}; heardSubs.add(fn); return () => { heardSubs.delete(fn); }; },
    /** Diagnostics / tests. */
    heldAsks:  () => { sweep(); return [...heldAsks.values()]; },
    heldCards: () => { sweep(); return [...heldCards.values()]; },
    heldChat:  () => { sweep(); return [...heldChat]; },
    presenceOf: (from) => presence.get(from) ?? null,
    /** Wait for in-flight newcomer greetings (tests). */
    settled: () => greetChain,
    close() {
      try { unsubscribePeers?.(); } catch { /* best-effort */ }
      for (const s of Object.values(subs)) s.clear();
      heldAsks.clear(); heldCards.clear(); heldChat.length = 0; heldInvites.clear(); presence.clear(); known.clear();
      heard.clear(); heardSubs.clear();
    },
  };
}
