/**
 * basis v2 — binding the Nearby room to the wire.
 *
 * The room's objects and rules exist (`nearbyAsks.js`, `nearbyRoom.js`, `nearbyInvites.js`), the carrier
 * exists (`nearbyAskChannel.js` — one thin seam over `sendTo`), and the controller (`nearbyScreen.js`) takes
 * them as dependencies. What neither shell ever did was hand them over: `askChannel` and the
 * `subscribeTo*` sources were left unset, so "Ask the room", "Show my card", room chat and broadcast
 * invites returned `no-channel` on both shells (found 2026-08-30 on the phone, N13).
 *
 * This is that hand-over, shared so both shells — and a Node companion — compose the same thing:
 *
 *   • OUTBOUND: one `createAskChannel` over `sendPeerMessage`, fanning to the room's current peers. The
 *     controller already speaks it for every kind (`broadcast`, `broadcastKind`, `sendAnswer`).
 *   • INBOUND: one router by subtype. Each payload goes through the module that OWNS its shape
 *     (`receiveAsk`, `receiveAnswer`, `receiveCard`, `receiveChatMessage`, `receiveInvite`) — the field
 *     set rebuilt, never spread; `from` taken from the WIRE, never the payload — and then to whoever
 *     subscribed. An unknown subtype is not ours: `onPeerMessage` returns false and the shell's other
 *     handlers get their turn.
 *
 * Who may speak in the room. No roster vouches for a stranger, and the circle sender authorisation lets
 * anything correctly signed through to the canonical address by design (that door is how a stranger ever
 * becomes a contact). The room's own rule is proximity, decided on THIS device from THIS device's peer
 * list: a `nearby-*` payload is delivered only if its wire `from` is someone the surface lists right now.
 * Enforceable here because the list is ours (enforceability.md); everything else a stranger could do is
 * bounded by the modules — field caps, expiry, the per-author ask budget, `nearbyActions`, the join gate.
 *
 * Answers have no subscriber on the controller — an answer is the start of a direct conversation, so the
 * SHELL subscribes (`subscribeToAnswers`) and opens the transient thread, the same way it does for the
 * answerer's side (`nearbyThreadDescriptor`).
 *
 * The room address. PLAN-nearby §3 wants a per-session ephemeral address. On the wire that exists today
 * the sender is what the transport authenticated (the canonical key on mDNS, whose TXT record already
 * names it), so `myAddress` is honest rather than aspirational: what the peer will actually see as
 * `from`. The ephemeral room address is rung-4 work (address exchange), recorded, not faked here.
 */
import { createAskChannel, ASK_MESSAGE, ANSWER_MESSAGE } from './nearbyAskChannel.js';
import { isAskLive, ASKS_MAX_KEPT } from './nearbyAsks.js';
import { receiveCard, receiveChatMessage, CARD_MESSAGE, CHAT_MESSAGE } from './nearbyRoom.js';
import { receiveInvite, INVITE_MESSAGE } from './nearbyInvites.js';

/** Every subtype the room speaks — the shells' routers must carry all of them (a fitness test pins it). */
export const NEARBY_ROOM_SUBTYPES = Object.freeze([
  ASK_MESSAGE, ANSWER_MESSAGE, CARD_MESSAGE, CHAT_MESSAGE, INVITE_MESSAGE,
]);

/**
 * @param {object} deps
 * @param {(address: string, payload: object) => Promise<*>} deps.sendPeerMessage  the agent's peer send
 * @param {() => Array<{pubKey?: string, id?: string}>} deps.listPeers            the room's current peers
 * @param {() => string|null} [deps.myAddress]   what the peer sees as `from` — the wire's answer
 * @param {() => number} [deps.now]
 * @param {(err: Error, phase: string) => void} [deps.onError]
 */
export function createNearbyRoomBinding({
  sendPeerMessage, listPeers = () => [], myAddress = () => null, now = () => Date.now(), onError = null,
} = {}) {
  if (typeof sendPeerMessage !== 'function') throw new TypeError('nearbyRoomBinding: sendPeerMessage required');

  const report = (err, phase) => { try { onError?.(err, phase); } catch { /* diagnostics only */ } };
  const askChannel = createAskChannel({
    listPeers,
    sendTo: (address, payload) => sendPeerMessage(address, payload),
    now,
    onError,
  });

  // One subscriber set per kind. A throwing subscriber must not stop its siblings or the router.
  const subs = { ask: new Set(), answer: new Set(), card: new Set(), chat: new Set(), invite: new Set() };
  // Asks outlive the moment they arrive. The Nearby screen subscribes only while it is open, and a peer
  // asks whoever it lists — including a phone whose person is in a thread or on another tab right now.
  // Walked 2026-08-30: an ask from the other phone arrived while this one was answering the companion,
  // nobody was subscribed, and it was gone; the asker had been told "asked 2 of 2". So live asks are kept
  // here, bounded by their own expiry and the room's cap, and handed to the next subscriber.
  const heldAsks = new Map();   // ask.id → ask
  const sweepAsks = () => { for (const [id, ask] of heldAsks) if (!isAskLive(ask, now)) heldAsks.delete(id); };
  const subscribe = (kind) => (fn) => {
    if (typeof fn !== 'function') return () => {};
    subs[kind].add(fn);
    if (kind === 'ask') {
      sweepAsks();
      for (const ask of heldAsks.values()) { try { fn(ask); } catch (err) { report(err, 'deliver:ask'); } }
    }
    return () => { subs[kind].delete(fn); };
  };
  const deliver = (kind, value) => {
    if (kind === 'ask' && value?.id) {
      sweepAsks();
      heldAsks.set(value.id, value);
      while (heldAsks.size > ASKS_MAX_KEPT) heldAsks.delete(heldAsks.keys().next().value);
    }
    for (const fn of subs[kind]) { try { fn(value); } catch (err) { report(err, `deliver:${kind}`); } }
  };

  // Subtype → (validate through the owning module, then deliver). Null from a validator = refused; a
  // refused payload is handled (it was ours) and simply dropped.
  const inRoom = (from) => {
    if (typeof from !== 'string' || !from) return false;
    let peers = [];
    try { peers = listPeers() ?? []; } catch { return false; }
    return peers.some((p) => (p?.pubKey ?? p?.id) === from);
  };

  const gated = (fn) => (from, payload) => { if (inRoom(from)) fn(from, payload); else report(new Error(`not in the room: ${String(from).slice(0, 12)}`), `refuse:${payload?.subtype}`); };
  const handlers = {
    [ASK_MESSAGE]:    (from, payload) => { const a = askChannel.receiveAsk(payload, from);    if (a) deliver('ask', a); },
    [ANSWER_MESSAGE]: (from, payload) => { const a = askChannel.receiveAnswer(payload, from); if (a) deliver('answer', a); },
    [CARD_MESSAGE]:   (from, payload) => { const c = receiveCard(payload, from, now);         if (c) deliver('card', c); },
    [CHAT_MESSAGE]:   (from, payload) => { const m = receiveChatMessage(payload, from, now);  if (m) deliver('chat', m); },
    [INVITE_MESSAGE]: (from, payload) => { const i = receiveInvite(payload, from, now);       if (i) deliver('invite', i); },
  };

  for (const k of Object.keys(handlers)) handlers[k] = gated(handlers[k]);

  return {
    askChannel,
    subscribeToAsks:    subscribe('ask'),
    subscribeToAnswers: subscribe('answer'),
    subscribeToCards:   subscribe('card'),
    subscribeToChat:    subscribe('chat'),
    subscribeToInvites: subscribe('invite'),
    myRoomAddress: () => { try { return myAddress() ?? null; } catch { return null; } },
    /**
     * The room's inbound side, in the shape both shells' peer routers use (`handlers[subtype](from,
     * payload)`), so a shell spreads `...binding.handlers` into its map.
     */
    handlers,
    /**
     * Or call it directly: true when the payload was one of ours (delivered or refused), false when it
     * belongs to another handler.
     */
    onPeerMessage(from, payload) {
      const h = handlers[payload?.subtype];
      if (!h) return false;
      // The room is the people the surface lists RIGHT NOW. A room payload from anyone else — a key that
      // reached this address over the relay or NKN, someone who left the LAN a minute ago — is not from
      // the room and is dropped. This is the one authorisation a room has: no roster vouches for a
      // stranger, but proximity is decided on THIS device, from THIS device's list, which is what makes
      // it enforceable here (enforceability.md). Handled (it was ours), never delivered.
      try { h(from, payload); } catch (err) { report(err, `receive:${payload.subtype}`); }
      return true;
    },
    /** The controller's dependency bag, ready to spread into `createNearbyScreen({...})`. */
    screenDeps() {
      return {
        askChannel,
        subscribeToAsks:    this.subscribeToAsks,
        subscribeToCards:   this.subscribeToCards,
        subscribeToChat:    this.subscribeToChat,
        subscribeToInvites: this.subscribeToInvites,
        myRoomAddress:      this.myRoomAddress,
      };
    },
    /** Live asks held for the next subscriber (diagnostics / tests). */
    heldAsks: () => { sweepAsks(); return [...heldAsks.values()]; },
    close() { for (const s of Object.values(subs)) s.clear(); heldAsks.clear(); },
  };
}
