/**
 * basis v2 — the Nearby screen CONTROLLER (Nearby step E).
 *
 * Four things already exist and each does one job: `buildNearbyModel` projects peers into rows,
 * `nearbyActions` decides what a row may offer, `createProximitySession` owns the advertise-while-open
 * lifecycle, and `createNetworkChangeWatcher` re-announces after a Wi-Fi switch. What was missing is the
 * thing that COMPOSES them.
 *
 * It has to live here rather than in each shell. Composition is logic — which order to open in, what to do
 * when the surface disagrees with the request, when to stop watching — and a shell that hand-rolled it
 * would be the fifth place this repo has grown a second copy of a rule (invariant 1). Web and mobile get
 * the same brain and differ only in how they draw it (invariant 2).
 *
 * ── What the screen is responsible for that the parts are not ────────────────────────────────────────────
 *
 *   • **Saying what the device is actually doing.** The session knows what it ASKED for; only the surface
 *     knows what happened. On an older Android binary "ghost mode" is still advertising, so the screen
 *     shows `visibility()` from the surface report — never `session.isAdvertising()` alone.
 *   • **Refusing to let proximity imply access.** Every row's actions come from `nearbyActions`, which
 *     answers membership from the ROSTER. Being on the same Wi-Fi is not a relationship (rule b).
 *   • **Closing properly.** Leaving the screen must stop advertising, stop watching, and drop the peer
 *     list — in that order, and even if the caller never opened it.
 */
import { buildNearbyModel, }             from './circleNearby.js';
import { createProximitySession, nearbyActions } from './circleProximity.js';
import { makeNearbySessionAdapter }      from './nearbyDiscoverability.js';
import { createNetworkChangeWatcher }    from './networkChangeWatcher.js';
import {
  evaluateIncomingAsk, isAskLive, askActions, createAsk, answerAsk, nearbyThreadDescriptor,
} from './nearbyAsks.js';
import {
  roomAllows, createCard, createChatMessage, createRoomChat, CARD_MESSAGE, CHAT_MESSAGE,
} from './nearbyRoom.js';

/**
 * Row action id → locale key.
 *
 * Shared because BOTH renderers need it and neither may own it: a copy in each is how web starts offering a
 * stranger something mobile does not (invariant 3). A renderer skips ids missing from this map rather than
 * printing them, so a new action from shared code cannot leak an internal identifier into the UI.
 */
export const NEARBY_ACTION_LABELS = Object.freeze({
  'invite-to-circle':   'circle.nearbyScreen.action_invite',
  'request-join':       'circle.nearbyScreen.action_request',
  'open-shared-circle': 'circle.nearbyScreen.action_open',
});

/**
 * Ask action id → locale key. Shared with both renderers for the same reason `NEARBY_ACTION_LABELS` is:
 * a copy per platform is how one shell starts offering something the other does not.
 */
export const NEARBY_ASK_LABELS = Object.freeze({
  'answer-ask':  'circle.nearbyScreen.action_answer',
  'dismiss-ask': 'circle.nearbyScreen.action_dismiss',
});

/**
 * Which visibility banner to show, given `model.visibility`.
 *
 * Ordered by what a person most needs to know, not by what the screen asked for: being announced after
 * asking to be hidden outranks everything, and "this device cannot discover" is an explanation rather than
 * a warning. Returns null when there is nothing to say.
 */
export function nearbyVisibilityKey(visibility) {
  if (!visibility) return null;
  if (visibility.degraded)    return 'still_visible';
  if (visibility.unavailable) return 'unavailable';
  return visibility.publishing ? 'visible' : 'hidden';
}

/**
 * @param {object} deps
 * @param {object} [deps.control]        the discoverability control (`createDiscoverabilityControl`)
 * @param {(onPeers: (peers: object[]) => void) => (() => void)} [deps.subscribeToPeers]
 * @param {(onEvent: () => void) => (() => void)} [deps.subscribeToNetwork]  platform network source
 * @param {() => Array} [deps.mySkills]  published skills, read at render time
 * @param {string} [deps.myPseudonym]
 * @param {(peerId: string) => boolean} [deps.isKnownMember]  the ROSTER answer, never proximity
 * @param {() => boolean} [deps.canInvite]
 * @param {string[]} [deps.supportedActions]  which actions this host can actually SERVICE. Defaults to all.
 * @param {(onAsk: (ask: object) => void) => (() => void)} [deps.subscribeToAsks]  incoming room asks
 * @param {object} [deps.askChannel]     from `createAskChannel` — how an ask reaches the room
 * @param {object} [deps.allows]         per-device room allows `{card, chat}` — BOTH default off (step G)
 * @param {(onCard: (card: object) => void) => (() => void)} [deps.subscribeToCards]
 * @param {(onMessage: (m: object) => void) => (() => void)} [deps.subscribeToChat]
 * @param {() => string|null} [deps.myRoomAddress]  the ephemeral address I present here
 * @param {() => Promise<Record<string,object>>} [deps.getDrivers]  MY drivers — read on-device, never sent
 * @param {Function} [deps.judge]        optional injected LLM judge for semantic matching
 * @param {() => number} [deps.now]
 * @param {string} [deps.restingState]   passed through to the session adapter
 * @param {function} [deps.t]
 * @param {(err: Error, phase: string) => void} [deps.onError]
 * @returns {{open, close, isOpen, model, actionsFor, visibility, subscribe, refresh}}
 */
export function createNearbyScreen({
  control = null,
  subscribeToPeers = null,
  subscribeToNetwork = null,
  mySkills = () => [],
  myPseudonym = null,
  isKnownMember = () => false,
  canInvite = () => false,
  supportedActions = null,
  subscribeToAsks = null,
  askChannel = null,
  allows: allowsInput = null,
  subscribeToCards = null,
  subscribeToChat = null,
  myRoomAddress = () => null,
  getDrivers = null,
  judge,
  now = () => Date.now(),
  restingState,
  t,
  onError = null,
} = {}) {
  const watchers = new Set();

  const adapter = makeNearbySessionAdapter({
    control, restingState, onError,
    // A degradation is not an error and must not be swallowed either: the screen re-renders so the
    // visibility line can change from "hidden" to "still visible" the moment the transports say so.
    onDegraded: () => emit(),
  });

  const session = createProximitySession({
    startAdvertising: adapter.startAdvertising,
    stopAdvertising:  adapter.stopAdvertising,
    subscribe:        subscribeToPeers ?? undefined,
    onError,
  });

  const watcher = createNetworkChangeWatcher({
    subscribe: subscribeToNetwork ?? undefined,
    onChange:  () => { adapter.onNetworkChange(); emit(); },
    onError,
  });

  session.subscribeToPeers(() => emit());

  // ── Asks (step F) ──────────────────────────────────────────────────────────
  // Held here rather than in the session because an ask outlives a peer row: someone can ask and walk out
  // of range, and the question is still worth answering until it expires.
  //
  // Each incoming ask is matched against MY drivers on THIS device. The result kept is a signal — resonant
  // or not, plus the shared-tag reason — never the drivers themselves and never the match internals.
  /** askId → { ask, resonant, reason } */
  const asks = new Map();
  let unsubscribeAsks = null;

  // ── Cards + room chat (step G) ─────────────────────────────────────────────
  // Both behind their own per-device allow, both defaulting OFF. The allows are held here rather than read
  // per render so a stale prop cannot re-enable a disclosure the user turned off.
  let allows = roomAllows(allowsInput);
  /** peer address → their card. One card per person; a new one replaces. */
  const cards = new Map();
  const chat = createRoomChat();
  let unsubscribeCards = null;
  let unsubscribeChat = null;
  chat.subscribe(() => emit());

  async function ingestAsk(ask) {
    if (!ask?.id || !isAskLive(ask, now)) return;
    let evaluated = { resonant: false, reason: null };
    if (typeof getDrivers === 'function') {
      try { evaluated = await evaluateIncomingAsk({ ask, getDrivers, judge, now }); }
      catch (err) { try { onError?.(err, 'evaluateAsk'); } catch { /* diagnostics only */ } }
    }
    asks.set(ask.id, { ask, resonant: !!evaluated.resonant, reason: evaluated.reason ?? null });
    emit();
  }

  function emit() {
    const snapshot = model();
    for (const w of watchers) { try { w(snapshot); } catch { /* one bad watcher */ } }
  }

  /**
   * What the device is ACTUALLY doing, in terms a screen can render.
   *
   * `requested` and `effective` are both reported because they disagree in exactly the case a user needs
   * told about: asked to be hidden, still being announced.
   */
  function visibility() {
    const report = adapter.lastReport();
    const effective = report?.effective ?? 'off';
    return {
      requested:  report?.requested ?? 'off',
      effective,
      publishing: effective === 'browse+publish',
      // TRUE only when we asked to be hidden and are not. This is the one that earns a warning in the UI.
      degraded:   report?.degraded === true,
      // The device simply cannot discover (no radio, no permission). Not a warning — an explanation.
      unavailable: report?.shortfall === true && effective === 'off',
      perTransport: report?.perTransport ?? [],
    };
  }

  /**
   * A roster that cannot answer means NOT a member.
   *
   * Deny-by-default, and it also keeps the screen alive: letting the throw escape would blank the whole
   * list because one lookup failed, which is a worse outcome than showing strangers as strangers.
   */
  function safeIsKnownMember(peerId) {
    try { return !!isKnownMember(peerId); }
    catch (err) { try { onError?.(err, 'isKnownMember'); } catch { /* diagnostics only */ } return false; }
  }

  function model() {
    const built = buildNearbyModel({
      peers: session.peers(),
      mySkills: safeCall(mySkills, []),
      myPseudonym,
      t,
    });
    // Actions are attached per row rather than computed in the renderer, so web and mobile cannot drift on
    // what proximity entitles someone to.
    const rows = built.rows.map((row) => {
      const decided = nearbyActions(row, {
        isKnownMember: safeIsKnownMember,
        canInvite: !!safeCall(canInvite, false),
      });
      // Do not offer what this host cannot do. `nearbyActions` says what proximity ENTITLES someone to;
      // whether the surrounding app can carry it out is a separate question, and a button that quietly does
      // nothing is worse than an absent one — it teaches people the app is broken rather than incomplete.
      // The note stays either way: a stranger is still labelled a stranger.
      const actions = Array.isArray(supportedActions)
        ? decided.actions.filter((a) => supportedActions.includes(a))
        : decided.actions;
      return { ...row, ...decided, actions };
    });
    // Live asks only, newest first. An expired one is not "greyed out" — it is gone, because the room has
    // moved on and an answer to it would arrive to nobody.
    const askRows = [...asks.values()]
      .filter((entry) => isAskLive(entry.ask, now))
      .sort((a, b) => b.ask.createdAt - a.ask.createdAt)
      .map((entry) => ({
        ...entry,
        ...askActions(entry.ask, { resonant: entry.resonant, now }),
      }));

    // Cards are attached to the peer row they belong to, so a face and a card are one thing on screen
    // rather than two lists the user has to reconcile.
    const withCards = rows.map((row) => (cards.has(row.id) ? { ...row, card: cards.get(row.id) } : row));

    return {
      ...built,
      rows: withCards,
      asks: askRows,
      allows,
      // Only present when I have joined the conversation. An empty array would read as "nobody has said
      // anything", which is a different fact from "I am not in this chat".
      chat: allows.chat ? chat.list() : null,
      visibility: visibility(),
      isOpen: session.isOpen(),
    };
  }

  return {
    /** Enter the screen: announce, listen for peers and asks, watch for network changes. */
    open() {
      session.open();      // advertising + peer subscription
      watcher.start();     // only while the screen is up: a closed screen has nothing to re-announce for
      if (typeof subscribeToAsks === 'function' && !unsubscribeAsks) {
        try { unsubscribeAsks = subscribeToAsks((ask) => { ingestAsk(ask); }) ?? null; }
        catch (err) { unsubscribeAsks = null; try { onError?.(err, 'subscribeToAsks'); } catch { /* */ } }
      }
      // Cards are RECEIVED regardless of my own card allow — looking is not disclosure, exactly as
      // browsing without announcing is not (ghost mode). The allow governs publishing mine.
      if (typeof subscribeToCards === 'function' && !unsubscribeCards) {
        try {
          unsubscribeCards = subscribeToCards((card) => {
            if (card?.from) { cards.set(card.from, card); emit(); }
          }) ?? null;
        } catch (err) { unsubscribeCards = null; try { onError?.(err, 'subscribeToCards'); } catch { /* */ } }
      }
      // Chat is different on purpose: the allow governs PARTICIPATING, both directions. Reading a room
      // conversation you have not joined is listening to people who believe they are talking among
      // participants.
      if (allows.chat && typeof subscribeToChat === 'function' && !unsubscribeChat) {
        try { unsubscribeChat = subscribeToChat((m) => chat.add(m)) ?? null; }
        catch (err) { unsubscribeChat = null; try { onError?.(err, 'subscribeToChat'); } catch { /* */ } }
      }
      emit();
    },

    /**
     * Leave the screen. Safe without a matching `open()`, and safe twice — teardown paths are unreliable,
     * and the one thing that must not survive is the advertising.
     */
    close() {
      watcher.stop();
      if (unsubscribeAsks) {
        try { unsubscribeAsks(); } catch (err) { try { onError?.(err, 'unsubscribeAsks'); } catch { /* */ } }
        unsubscribeAsks = null;
      }
      // Asks are dropped with the room, for the same reason the peer list is: a closed screen holding what
      // strangers needed is a quiet record of where someone has been.
      asks.clear();
      for (const [unsub, name] of [[unsubscribeCards, 'cards'], [unsubscribeChat, 'chat']]) {
        if (!unsub) continue;
        try { unsub(); } catch (err) { try { onError?.(err, `unsubscribe:${name}`); } catch { /* */ } }
      }
      unsubscribeCards = null;
      unsubscribeChat = null;
      cards.clear();
      chat.clear();     // leaving the room forgets the conversation — there is no history to come back to
      session.close();
      emit();
    },

    isOpen: () => session.isOpen(),
    model,
    visibility,

    /**
     * Put an ask into the room.
     *
     * Composing and broadcasting are one call because a half-broadcast ask is not a state worth modelling:
     * either it went out or the room did not hear it, and the result says which. It is NOT added to my own
     * ask list — the room is what other people asked; my own question is not news to me.
     */
    async askRoom({ text, tags = [], ttlMs } = {}) {
      const built = createAsk({ text, tags, ttlMs, from: safeCall(myRoomAddress, null), now });
      if (!built.ok) return { ok: false, reason: built.reason };
      if (!askChannel?.broadcast) return { ok: false, reason: 'no-channel', ask: built.ask };
      try {
        const result = await askChannel.broadcast(built.ask);
        // Reports the REAL reach. "Asked 3 of 5 nearby" is honest; "sent" implies everyone heard it.
        return { ok: true, ask: built.ask, ...result };
      } catch (err) {
        try { onError?.(err, 'askRoom'); } catch { /* diagnostics only */ }
        return { ok: false, reason: err?.message ?? 'broadcast-failed', ask: built.ask };
      }
    },

    /**
     * Answer an ask — the disclosure, and the only thing here that reveals me.
     *
     * Point-to-point to the asker. Deliberately no "and tell the room I answered".
     */
    async answer(askId, text) {
      const entry = asks.get(askId);
      if (!entry) return { ok: false, reason: 'unknown-ask' };
      const built = answerAsk({ ask: entry.ask, text, from: safeCall(myRoomAddress, null), now });
      if (!built.ok) return { ok: false, reason: built.reason };
      if (!askChannel?.sendAnswer) return { ok: false, reason: 'no-channel' };

      const sent = await askChannel.sendAnswer(built.answer, entry.ask.from);
      if (!sent.ok) return sent;
      // Answering is a one-way door for THIS ask: I have already revealed myself, so it leaves the room.
      asks.delete(askId);
      emit();
      // The host opens this. It is TRANSIENT by construction — answering climbs to rung 3 (a pairwise
      // channel), not rung 4 (a contact you can reach from home).
      return {
        ok: true,
        opensDirectChannel: true,
        peer: entry.ask.from,
        thread: nearbyThreadDescriptor(entry.ask.from),
      };
    },

    /** The per-device allows, as they stand. */
    allows: () => allows,

    /**
     * Change an allow. Turning chat OFF leaves the conversation immediately and forgets it — a setting that
     * only stops future messages would leave the last ones on screen after you opted out.
     */
    setAllow(key, value) {
      const next = roomAllows({ ...allows, [key]: value === true });
      const wasChat = allows.chat;
      allows = next;
      if (wasChat && !allows.chat) {
        if (unsubscribeChat) {
          try { unsubscribeChat(); } catch { /* best-effort */ }
          unsubscribeChat = null;
        }
        chat.clear();
      } else if (!wasChat && allows.chat && session.isOpen() && typeof subscribeToChat === 'function') {
        try { unsubscribeChat = subscribeToChat((m) => chat.add(m)) ?? null; }
        catch (err) { try { onError?.(err, 'subscribeToChat'); } catch { /* */ } }
      }
      emit();
      return allows;
    },

    /** Publish my card to the room. Refused unless the card allow is on. */
    async showCard({ label, line, tags } = {}) {
      if (!allows.card) return { ok: false, reason: 'card-not-allowed' };
      const built = createCard({ label, line, tags, from: safeCall(myRoomAddress, null), now });
      if (!built.ok) return built;
      if (!askChannel?.broadcastKind) return { ok: false, reason: 'no-channel', card: built.card };
      try {
        const result = await askChannel.broadcastKind(CARD_MESSAGE, { card: built.card });
        return { ok: true, card: built.card, ...result };
      } catch (err) {
        try { onError?.(err, 'showCard'); } catch { /* */ }
        return { ok: false, reason: err?.message ?? 'broadcast-failed' };
      }
    },

    /** Say something in the room chat. The allow is enforced in `createChatMessage`, not here. */
    async say(text) {
      const built = createChatMessage({ text, from: safeCall(myRoomAddress, null), allows, now });
      if (!built.ok) return built;
      if (!askChannel?.broadcastKind) return { ok: false, reason: 'no-channel' };
      try {
        const result = await askChannel.broadcastKind(CHAT_MESSAGE, { message: built.message });
        // Mine appears locally: the room does not echo it back, and a message that vanishes on send reads
        // as a failure.
        chat.add(built.message);
        return { ok: true, message: built.message, ...result };
      } catch (err) {
        try { onError?.(err, 'say'); } catch { /* */ }
        return { ok: false, reason: err?.message ?? 'broadcast-failed' };
      }
    },

    /** Hide an ask for me. Tells the asker nothing — that is the whole point of dismissing. */
    dismissAsk(askId) {
      if (asks.delete(askId)) emit();
    },

    /** Actions for one row id, for a host that renders rows itself. */
    actionsFor(rowId) {
      const row = model().rows.find((r) => r.id === rowId) ?? null;
      return row ? { actions: row.actions, isMember: row.isMember, note: row.note } : null;
    },

    /** Re-render on demand (a skill published, a roster change). */
    refresh: emit,

    /** Watch the model; returns an unsubscribe. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
}

function safeCall(fn, fallback) {
  try { return typeof fn === 'function' ? fn() : fn ?? fallback; }
  catch { return fallback; }
}
