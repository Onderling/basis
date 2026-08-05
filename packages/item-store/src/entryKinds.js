/**
 * ENTRY KINDS — the one table that says how a logged entry behaves.
 *
 * Every event in a circle lands in one append-only log (the C15 "one stream" decision), and three separate
 * questions get asked about each entry:
 *
 *   • does it show in a conversation, or is it system plumbing?   → `lane`
 *   • may it wake an offline device?                              → `wakes`
 *   • how long is it kept?                                        → `retain`
 *   • is it auditable — i.e. immutable once written?              → `audit`
 *
 * Until now each answer lived somewhere different: `silent: true` was stamped by hand at every append site,
 * the wake rule was re-derived per call site, and retention was one number for everything. Behaviour that is
 * decided in four places drifts, and the drift is invisible — a silent entry that wakes a phone, or a
 * conversation showing a roster ping, both look like ordinary bugs rather than a missing rule.
 *
 * So: **the KIND carries the behaviour, and this is the only table.** `isSilentEntry` / `shouldWakeForEntry`
 * become lookups rather than conventions.
 *
 * ── Why this lives in a substrate package ────────────────────────────────────────────────────────────────
 * stoop decides whether a fanned governance event may wake a device, and basis decides whether the same
 * event shows in chat. stoop cannot import basis app code (invariant 5), so before this the wake rule
 * existed TWICE — in `governanceLog.js` and again inline in stoop's `broadcastKringGovernance` — held
 * together only by a fitness test. A shared substrate module is importable by both, which retires the
 * duplication instead of guarding it.
 */

/** Which surface an entry belongs to. `human` shows in a conversation; `system` is plumbing. */
export const LANE = Object.freeze({ HUMAN: 'human', SYSTEM: 'system' });

/** Retention classes. Durations are a per-user setting; these are the buckets they apply to. */
export const RETAIN = Object.freeze({
  SHORT: 'short',   // pure plumbing — roster pings, delivery state
  CHAT: 'chat',     // the conversation
  AUDIT: 'audit',   // compacts rather than dropping; a trail that silently forgets looks complete
});

const K = (lane, wakes, retain, audit) => Object.freeze({ lane, wakes, retain, audit });

/**
 * The table. A kind absent from it is treated as `system / never wakes / short / not auditable` — the
 * conservative reading, so an unregistered kind cannot wake a phone or masquerade as conversation.
 */
export const ENTRY_KINDS = Object.freeze({
  // ── human-facing ──────────────────────────────────────────────────────────
  'chat-message':    K(LANE.HUMAN, true,  RETAIN.CHAT, false),
  task:              K(LANE.HUMAN, true,  RETAIN.CHAT, false),
  vraag:             K(LANE.HUMAN, true,  RETAIN.CHAT, false),
  aanbod:            K(LANE.HUMAN, true,  RETAIN.CHAT, false),
  leen:              K(LANE.HUMAN, true,  RETAIN.CHAT, false),

  // ── system lane ───────────────────────────────────────────────────────────
  // `governance` carries ONE per-event exception, which stays explicit rather than becoming a second
  // table: a decision OPENING may wake (it needs a vote), individual votes and resolves must not.
  // See `governanceWakes()`.
  governance:        K(LANE.SYSTEM, false, RETAIN.AUDIT, true),
  report:            K(LANE.SYSTEM, false, RETAIN.AUDIT, true),
  'roster-updated':  K(LANE.SYSTEM, false, RETAIN.SHORT, false),
  'delivery-state':  K(LANE.SYSTEM, false, RETAIN.SHORT, false),
  'key-event':       K(LANE.SYSTEM, false, RETAIN.AUDIT, true),
  membership:        K(LANE.SYSTEM, false, RETAIN.AUDIT, true),

  // ── the agent trail (per-agent action log) ────────────────────────────────
  'agent-action':    K(LANE.SYSTEM, false, RETAIN.AUDIT, true),
  'settings-change': K(LANE.SYSTEM, false, RETAIN.AUDIT, true),

  // ── compaction output ─────────────────────────────────────────────────────
  // What old audit entries FOLD into instead of being dropped (retention step D): `{from, to, counts,
  // actors, foldedCount}` — the shape of what happened survives, and says how much it folded. Auditable
  // itself so an external append cannot rewrite it (the log's own compactor merges internally, not via
  // append); never pruned — a summary that expires would be the silent forgetting it exists to prevent.
  'audit-summary':   K(LANE.SYSTEM, false, RETAIN.AUDIT, true),
});

/** The conservative default for an unregistered kind — never wakes, never reads as conversation. */
export const UNKNOWN_KIND = K(LANE.SYSTEM, false, RETAIN.SHORT, false);

/** Look a kind up. Always returns a descriptor. */
export function entryKind(kind) {
  return (typeof kind === 'string' && ENTRY_KINDS[kind]) || UNKNOWN_KIND;
}

/** Is this kind system plumbing rather than conversation? */
export function isSystemKind(kind) { return entryKind(kind).lane === LANE.SYSTEM; }

/** Kinds a conversation surface shows. Derived, so adding a human kind cannot forget the chat surface. */
export function conversationKinds() {
  return Object.keys(ENTRY_KINDS).filter((k) => ENTRY_KINDS[k].lane === LANE.HUMAN);
}

/** Is this kind auditable — immutable once written (invariant 4b)? */
export function isAuditKind(kind) { return entryKind(kind).audit === true; }

/** Retention class for a kind. */
export function retentionOf(kind) { return entryKind(kind).retain; }

/**
 * The DETAIL WINDOW per retention class — how many most-recent entries stay verbatim before the class's
 * policy applies to the rest (the AUDIT class COMPACTS beyond it; SHORT/CHAT drop the oldest). Durations are
 * a per-user setting (see the RETAIN doc); these are the shared DEFAULTS. This is the ONE table both audit
 * records — `sa.audit` (secure-agent) and the agent trail — read for their window, so neither hardcodes its
 * own number: the `G-A4` "pin-the-agreement" guard holds them to it.
 */
export const RETENTION_WINDOW = Object.freeze({
  [RETAIN.SHORT]: 200,
  [RETAIN.CHAT]:  2000,
  [RETAIN.AUDIT]: 1000,
});

/** The detail-window for a RETAIN class (falls back to SHORT for an unknown class). */
export function retentionWindowFor(retainClass) {
  return RETENTION_WINDOW[retainClass] ?? RETENTION_WINDOW[RETAIN.SHORT];
}

/**
 * May an entry of this kind wake an offline device?
 *
 * `payload` is consulted ONLY for kinds whose table entry is not the whole story — today just `governance`,
 * where a decision opening wakes and the votes that follow do not. Keeping that exception here, next to the
 * table, is what lets stoop and basis stop each deriving it.
 *
 * @param {string} kind
 * @param {object} [payload]  the entry's payload, when the kind needs it
 * @returns {boolean}
 */
export function kindWakes(kind, payload = null) {
  if (kind === 'governance') return governanceWakes(payload);
  return entryKind(kind).wakes === true;
}

/**
 * The governance exception: only a decision OPENING (`propose`) may wake. An individual vote or resolve is
 * routine, and a circle that buzzes on every vote gets muted — after which the decision that mattered is
 * missed anyway.
 */
export function governanceWakes(event) {
  return !!event && event.event === 'propose';
}
