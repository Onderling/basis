/**
 * basis v2 — cards and room chat (Nearby step G).
 *
 * Decision 1 (2026-07-27): **both**, each user-allowable per device. Decision 2: a DM is reachable from the
 * room chat as well as from an answered ask.
 *
 * ── The tension this file has to hold, stated plainly ────────────────────────────────────────────────────
 * §4 of the plan says *you do not wear a badge listing what you own* — and a card is, structurally, a badge.
 * The objection there was to broadcasting an inventory **so that matching can happen**: automatic,
 * invisible, and impossible to decline without leaving. A card is the opposite act. You write it, you
 * choose to show it, and you can see exactly what it says. So both are true at once, and the resolution is
 * in the defaults and the framing rather than in the mechanism:
 *
 *   • **both allows default OFF.** Presence stays "ephemeral address + chosen face" until you decide
 *     otherwise, which is what §3 promises;
 *   • a card is **authored**, never derived. Nothing reads your drivers, offerings or profile to fill one
 *     in — that would recreate the automatic-inventory design behind a friendlier name;
 *   • the UI says who can see it, because "everyone in this room" is not obvious from a text field.
 *
 * ── How the two allows differ, and why ───────────────────────────────────────────────────────────────────
 * They are deliberately NOT the same shape:
 *
 *   • **cards** — the allow governs PUBLISHING mine. You can look at other people's cards without showing
 *     one, exactly as you can browse without announcing (ghost mode). Looking is not disclosure.
 *   • **chat** — the allow governs PARTICIPATING, both directions. A room chat you can read but not write
 *     is a room where you are listening silently to a conversation the others believe is among
 *     participants. That is a different thing from browsing a list of who is present, and the honest
 *     default is that you are either in the conversation or not in it.
 */

export const CARD_MAX_LABEL = 40;
export const CARD_MAX_LINE  = 140;
export const CARD_MAX_TAGS  = 5;
export const CHAT_MAX_TEXT  = 500;
/** Room chat is ephemeral. This is a render cap, not a store — nothing is persisted anywhere. */
export const CHAT_MAX_KEPT  = 100;

/**
 * How many asks a room keeps, and how many one stranger may cost you.
 *
 * Walked 2026-07-29 (S6/J-A11) and it was worse than unbounded memory: **every** incoming ask was matched
 * against the reader's drivers, and matching can call a language model. 200 asks from one peer drove 400
 * judge calls — a remote party spending someone else's compute, or money, by talking.
 *
 * Two separate limits, because they answer different questions:
 *
 *   • `ASKS_MAX_KEPT` — what a room is worth remembering. A room is a transient place; the oldest asks
 *     stop mattering, and an unbounded map in a screen that never unmounts is a leak either way.
 *   • `ASKS_PER_AUTHOR_BURST` / `_REFILL_PER_SEC` — what one person may cost. A token bucket per author,
 *     checked BEFORE the judge runs, so the expensive half is what gets protected. Tuned for a real room:
 *     a person asking a handful of things in a minute is normal; a hundred is not a person.
 */
export const ASKS_MAX_KEPT            = 200;
export const ASKS_PER_AUTHOR_BURST    = 8;
export const ASKS_PER_AUTHOR_REFILL   = 0.2;   // one more every five seconds

export const CARD_MESSAGE = 'nearby-card';
export const CHAT_MESSAGE = 'nearby-chat';

/**
 * The per-device allows. **Both default off** — a room you walk into must not start publishing for you.
 *
 * @param {object} [stored]  whatever the host persisted; unknown/missing fields fall to off
 */
export function roomAllows(stored = {}) {
  return Object.freeze({
    card: stored?.card === true,
    chat: stored?.chat === true,
  });
}

/**
 * Author a card.
 *
 * Everything here is typed by the person. There is deliberately no `fromProfile()` helper: the moment a
 * card can be generated from your stored offerings, the "authored, never derived" rule is one convenience
 * function away from being gone.
 *
 * @param {object} a
 * @param {string} a.label   the face you are showing — a chosen name, not an identity
 * @param {string} [a.line]  one line about why you are here
 * @param {string[]} [a.tags]
 * @returns {{ok: boolean, card?: object, reason?: string}}
 */
export function createCard({ label, line = '', tags = [], from = null, now = () => Date.now() } = {}) {
  const name = typeof label === 'string' ? label.trim() : '';
  if (!name) return { ok: false, reason: 'empty-card' };
  if (name.length > CARD_MAX_LABEL) return { ok: false, reason: 'label-too-long' };

  const body = typeof line === 'string' ? line.trim() : '';
  if (body.length > CARD_MAX_LINE) return { ok: false, reason: 'line-too-long' };

  return {
    ok: true,
    card: Object.freeze({
      label: name,
      line: body,
      tags: Object.freeze(normalizeTags(tags).slice(0, CARD_MAX_TAGS)),
      from,
      createdAt: now(),
    }),
  };
}

/**
 * Validate an inbound card. Same discipline as an inbound ask: this arrives from a stranger on the same
 * network with no relationship, so it is REBUILT rather than trusted, and `from` comes from the wire.
 */
export function receiveCard(payload, fromAddress, now = () => Date.now()) {
  if (payload?.subtype !== CARD_MESSAGE) return null;
  const raw = payload.card;
  if (!raw || typeof raw !== 'object') return null;

  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (!label || label.length > CARD_MAX_LABEL) return null;
  // REFUSE rather than truncate (2026-07-30, S6/J-A14). `label` already refused; `line` used to be cut to
  // 140 characters, so a 5 000-character line arrived as a card that LOOKED like a normal card and was
  // not what its author sent. Truncation mutates content and tells nobody — the reader believes they have
  // the whole of it. A refused card is visibly absent; a shortened one is invisibly wrong.
  const rawLine = typeof raw.line === 'string' ? raw.line.trim() : '';
  if (rawLine.length > CARD_MAX_LINE) return null;
  const line = rawLine;

  return Object.freeze({
    label,
    line,
    tags: Object.freeze(normalizeTags(raw.tags).slice(0, CARD_MAX_TAGS)),
    // The wire wins — a card claiming another person's address would put their name on someone else's face.
    from: fromAddress ?? null,
    receivedAt: now(),
  });
}

/**
 * Compose a room-chat message.
 *
 * Refused when chat is not allowed on this device. That check lives here rather than in the UI because
 * "did the button render" is the wrong place to enforce a disclosure rule — a re-render, a stale prop or a
 * second call site would each be enough to bypass it.
 */
export function createChatMessage({ text, from = null, allows = roomAllows(), now = () => Date.now(), id } = {}) {
  if (!allows?.chat) return { ok: false, reason: 'chat-not-allowed' };
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return { ok: false, reason: 'empty-message' };
  if (body.length > CHAT_MAX_TEXT) return { ok: false, reason: 'message-too-long' };

  const at = now();
  return {
    ok: true,
    message: Object.freeze({
      id: typeof id === 'function' ? id() : `chat-${at}-${Math.abs(hash(body + at))}`,
      text: body, from, createdAt: at,
    }),
  };
}

/** Validate an inbound chat message. */
export function receiveChatMessage(payload, fromAddress, now = () => Date.now()) {
  if (payload?.subtype !== CHAT_MESSAGE) return null;
  const raw = payload.message;
  if (!raw || typeof raw !== 'object') return null;

  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text || text.length > CHAT_MAX_TEXT) return null;
  const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 128 ? raw.id : null;
  if (!id) return null;

  return Object.freeze({ id, text, from: fromAddress ?? null, receivedAt: now() });
}

/**
 * The ephemeral room chat.
 *
 * **No history, ever.** Someone who arrives later sees an empty room, because that is what walking into a
 * café is: you did not hear what was said before you got there. Replaying it would turn an in-the-moment
 * conversation into a record — and a record of a room is a record of who was in it.
 *
 * Leaving clears everything for the same reason the peer list and the ask list clear.
 */
export function createRoomChat({ max = CHAT_MAX_KEPT } = {}) {
  let messages = [];
  const watchers = new Set();
  const emit = () => { for (const w of watchers) { try { w(messages.slice()); } catch { /* one bad watcher */ } } };

  return {
    add(message) {
      if (!message?.id) return;
      if (messages.some((m) => m.id === message.id)) return;   // a re-delivery is not a second message
      messages = [...messages, message].slice(-max);
      emit();
    },
    list: () => messages.slice(),
    /** Leaving the room forgets the conversation. */
    clear() { if (messages.length) { messages = []; emit(); } },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function normalizeTags(tags) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? '').trim().toLowerCase();
    if (tag && tag.length <= 64 && !out.includes(tag)) out.push(tag);
  }
  return out;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}


/**
 * A per-author token bucket for ask ingest — the cheap gate in front of the expensive one.
 *
 * Deliberately local to the room rather than reusing the transport-level limiter in
 * `@onderling/secure-agent`: that one counts ENVELOPES on a socket, and a nearby room's asks arrive over
 * mDNS/BLE where there is no socket to count. Both are wanted; neither replaces the other.
 *
 * Unknown/absent author ⇒ one shared bucket. That is deliberately strict: an ask with no attributable
 * sender is exactly what a flooder would send, so they all draw on the same allowance rather than each
 * getting a fresh one.
 */
export function createAskBudget({
  burst = ASKS_PER_AUTHOR_BURST,
  refillPerSec = ASKS_PER_AUTHOR_REFILL,
  now = () => Date.now(),
} = {}) {
  /** author → { tokens, at } */
  const buckets = new Map();
  const ANON = '\u0000anonymous';
  return {
    /** @returns {boolean} true when this ask may be processed. */
    take(author) {
      const key = (typeof author === 'string' && author) ? author : ANON;
      const t = now();
      const b = buckets.get(key) ?? { tokens: burst, at: t };
      const refilled = Math.min(burst, b.tokens + ((t - b.at) / 1000) * refillPerSec);
      if (refilled < 1) { buckets.set(key, { tokens: refilled, at: t }); return false; }
      buckets.set(key, { tokens: refilled - 1, at: t });
      return true;
    },
    /** Leaving the room forgets everyone's allowance, like the rest of the room state. */
    clear() { buckets.clear(); },
    size: () => buckets.size,
  };
}
