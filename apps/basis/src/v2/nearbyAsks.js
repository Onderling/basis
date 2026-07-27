/**
 * basis v2 — asks and answers in the vicinity room (Nearby step F).
 *
 * The design decision this file exists to enforce (`plans/PLAN-nearby.md` §4):
 * **broadcast the question, never the inventory.**
 *
 * The tempting shape is the wrong one. Hashing your capability tags and broadcasting them protects nothing:
 * tag distribution is Zipfian, so a few hundred common tags are trivially precomputed, and the *rare* ones —
 * the ones worth hiding — are exactly the identifying ones. A hashed broadcast leaks the common half and
 * fingerprints the rest. Private set intersection is the real answer and is too heavy for v1.
 *
 * So it is inverted, the way a physical room already works. You say *"anyone got a bike pump?"* out loud.
 * You do not wear a badge listing what you own.
 *
 *   1. presence carries no inventory — an ephemeral address and a chosen face, nothing else;
 *   2. an **ask** is a transient need someone chooses to put into the room;
 *   3. **matching runs on the RESPONDER's device**, against their own private drivers;
 *   4. **replying is the disclosure.** Nobody learns you can fix a bike unless you answer.
 *
 * ── Reuse, not new machinery ─────────────────────────────────────────────────────────────────────────────
 * The on-device matcher already shipped for personal drivers (`evaluateItemForDrivers` →
 * `matchProfileDrivers`) is exactly step 3, so an ask is shaped as something it can already consume. What is
 * new here is the ask OBJECT, its expiry, and the rule that an answer is a deliberate act.
 */
import { evaluateItemForDrivers, matchReasonText } from '../core/handlers/driverMatchNotify.js';

/** Asks are transient by construction. A need that outlives the room is a noticeboard post, not an ask. */
export const ASK_DEFAULT_TTL_MS = 30 * 60_000;   // 30 minutes
export const ASK_MAX_TTL_MS     = 4 * 60 * 60_000;
export const ASK_MAX_TEXT       = 280;

/**
 * Build an ask for broadcast.
 *
 * **What this deliberately does NOT carry:** anything about what the asker HAS. No driver list, no skill
 * inventory, no persona properties. An ask is a need, and the only thing a room learns from it is that
 * somebody there needs that thing right now. Tags are the asker's own words about the ASK, which is what
 * lets a responder's device match locally without either side publishing a profile.
 *
 * @param {object} a
 * @param {string} a.text                 the question, in the asker's words
 * @param {string[]} [a.tags]             coarse tags FOR THE ASK — never the asker's inventory
 * @param {string} [a.from]               the asker's ephemeral room address (not their stable identity)
 * @param {number} [a.ttlMs]
 * @param {() => number} [a.now]
 * @param {() => string} [a.id]           injectable id, so tests are deterministic
 * @returns {{ok: boolean, ask?: object, reason?: string}}
 */
export function createAsk({ text, tags = [], from = null, ttlMs = ASK_DEFAULT_TTL_MS, now = () => Date.now(), id } = {}) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return { ok: false, reason: 'empty-ask' };
  if (body.length > ASK_MAX_TEXT) return { ok: false, reason: 'ask-too-long' };

  const ttl = Math.min(Math.max(Number(ttlMs) || ASK_DEFAULT_TTL_MS, 60_000), ASK_MAX_TTL_MS);
  const at = now();

  return {
    ok: true,
    ask: Object.freeze({
      id: typeof id === 'function' ? id() : `ask-${at}-${Math.abs(hash(body + at))}`,
      // `text` + `tags` are what the matcher reads. The field names match what `matchProfileDrivers`
      // already consumes, so no adapter layer is needed and no second shape can drift from it.
      text: body,
      tags: normalizeTags(tags),
      from,
      createdAt: at,
      expiresAt: at + ttl,
    }),
  };
}

/** Is this ask still live? A stale ask must never match — the room has moved on. */
export function isAskLive(ask, now = () => Date.now()) {
  if (!ask || typeof ask.expiresAt !== 'number') return false;
  return now() < ask.expiresAt;
}

/**
 * Evaluate an incoming ask against MY drivers, on MY device.
 *
 * Returns a signal, never the authored text of my drivers: `reason` names the shared TAGS (or the judge's
 * sentence), which is the same rule the shipped drivers matcher already holds. An expired ask is not
 * evaluated at all — matching a need that has passed is worse than silence, because it invites an answer
 * nobody is waiting for.
 *
 * @param {object} a
 * @param {object} a.ask
 * @param {() => Promise<Record<string,object>>} a.getDrivers   MY drivers — they never leave the device
 * @param {Function} [a.judge]
 * @param {number} [a.minShared=1]
 * @param {() => number} [a.now]
 * @returns {Promise<{resonant: boolean, reason: string|null, matches: object[], expired: boolean}>}
 */
export async function evaluateIncomingAsk({ ask, getDrivers, judge, minShared = 1, now = () => Date.now() } = {}) {
  if (!ask) return { resonant: false, reason: null, matches: [], expired: false };
  if (!isAskLive(ask, now)) return { resonant: false, reason: null, matches: [], expired: true };

  const matches = await evaluateItemForDrivers({ item: ask, getDrivers, judge, minShared });
  if (!matches.length) return { resonant: false, reason: null, matches: [], expired: false };

  return { resonant: true, reason: matchReasonText(matches[0]), matches, expired: false };
}

/**
 * What a responder may do about an ask.
 *
 * `answer` is offered only on a live ask, and — this is the point of the whole design — it is the ONLY
 * thing that discloses anything. Seeing the ask, matching it, and deciding not to reply leaves the asker
 * knowing nothing. There is deliberately no "notify them that someone nearby matches": that would disclose
 * on the responder's behalf, which is precisely what step 4 forbids.
 */
export function askActions(ask, { resonant = false, now = () => Date.now() } = {}) {
  if (!isAskLive(ask, now)) return { actions: [], note: 'ask-expired' };
  return {
    actions: ['answer-ask', 'dismiss-ask'],
    // Shown to the responder, not sent anywhere: a reminder that replying is what reveals them.
    note: resonant ? 'answer-is-disclosure' : null,
  };
}

/**
 * Build an answer. This is a deliberate act by the responder and the moment they become visible to the
 * asker — so it is a separate function with a separate result, not a side effect of matching.
 *
 * The answer carries the responder's own words and their room address. It does NOT carry the match
 * details: the asker gets a person replying, not a report on which of their tags overlapped. That would
 * disclose the responder's drivers through the back door.
 *
 * @returns {{ok: boolean, answer?: object, reason?: string}}
 */
export function answerAsk({ ask, text, from = null, now = () => Date.now() } = {}) {
  if (!ask?.id) return { ok: false, reason: 'no-ask' };
  if (!isAskLive(ask, now)) return { ok: false, reason: 'ask-expired' };
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return { ok: false, reason: 'empty-answer' };
  if (body.length > ASK_MAX_TEXT) return { ok: false, reason: 'answer-too-long' };

  return {
    ok: true,
    answer: Object.freeze({
      askId: ask.id,
      text: body,
      from,
      // Answering opens the pairwise channel — rung 3 of the escalation ladder. The DM is the CONSEQUENCE
      // of the answer, and the host wires it; naming it here keeps the ladder legible at the seam.
      opensDirectChannel: true,
      createdAt: now(),
    }),
  };
}

/**
 * What answering OPENS — rung 3 of the escalation ladder, described once so both shells open the same
 * thing.
 *
 * **`transient: true` is the load-bearing field.** Answering opens a pairwise channel with the person's
 * EPHEMERAL room address; it does not make them a contact. Rung 4 — becoming reachable from home — is the
 * deliberate exchange of the `{transport → address}` map, and quietly saving a café encounter into the
 * contact list would skip a rung the user never chose to climb. A shell that persists this is the bug.
 *
 * @param {string} peerAddress   the address the answer went to (from the WIRE, never a payload)
 * @param {object} [opts]
 * @param {string} [opts.label]  what to call them on screen — a chosen face, not an identity
 */
export function nearbyThreadDescriptor(peerAddress, { label = null } = {}) {
  if (!peerAddress) return null;
  return Object.freeze({
    peerAddress,
    label: label || peerAddress.slice(0, 8),
    transient: true,
    origin: 'nearby-answer',
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Coarse, deduped, lowercased. Coarse on purpose: a precise tag is an identifier. */
function normalizeTags(tags) {
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw ?? '').trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return Object.freeze(out);
}

/** Tiny non-cryptographic id helper — uniqueness within a room, not a security property. */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}
