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
 * existed TWICE — in `governanceLog.js` and again inline in stoop's `broadcastCircleGovernance` — held
 * together only by a fitness test. A shared substrate module is importable by both, which retires the
 * duplication instead of guarding it.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/** Which surface an entry belongs to. `human` shows in a conversation; `system` is plumbing. */
export const LANE = Object.freeze({ HUMAN: 'human', SYSTEM: 'system' });

/** Retention classes. Durations are a per-user setting; these are the buckets they apply to. */
export const RETAIN = Object.freeze({
  SHORT: 'short',   // pure plumbing — roster pings, delivery state
  CHAT: 'chat',     // conversational content whose durable head lives ELSEWHERE (e.g. a task's store row)
  AUDIT: 'audit',   // compacts rather than dropping; a trail that silently forgets looks complete
  // The entry IS the record — NEVER drops, never compacts. Membership (the roster is a fold of these; one
  // compacting away silently changes who-is-in on rebuild) and chat messages (the conversation's record on
  // the device log — dropping them is data destruction, "pod kwijt = ongemak, geen verlies"). Consequence,
  // named: record-class lanes grow without bound, which is the trigger for the log's storage-structure work.
  RECORD: 'record',
});

/*
 * ── The BINDING columns (declared 2026-09-15, read by nothing yet — the "shadow" step) ──────────────
 *
 * Beside the four questions above, a kind now answers four more: which key must have SIGNED it, what it is
 * ABOUT, which verifier a receiver ACCEPTS it with, and whether a person's own devices carry it to each
 * other. Today every rail chooses its verifier at wiring time and nothing declares which; on 2026-09-14 a
 * lane's kind name disagreed with this table about its lane and every statement painted as a bubble. These
 * columns are the declaration. They are pinned against the rails' real verifiers by a fitness test, and the
 * rails will READ them in a later step; until then a wrong cell changes nothing at runtime and fails a test.
 */

/** Which key must have signed an entry of this kind. `local` = this device's own unsigned record, never carried. */
export const SIGNS = Object.freeze({
  ROOT: 'root',                   // the recovery phrase, inside a ceremony
  PERSON: 'person',               // the person's key (today the static profile key; a rotating one is designed)
  DEVICE: 'device',               // the device's root-signed delegation key
  CIRCLE: 'device-in-circle',     // the per-circle address — the roster's proven set
  AGENT_OWNER: 'agent-owner',     // a bot's owner key
  LOCAL: 'local',                 // written by this device about itself; never leaves it
});
/** What an entry of this kind is ABOUT — the axis a revocation or eviction acts on. */
export const SUBJECT = Object.freeze({ PERSON: 'person', DEVICE: 'device', NONE: 'none' });
/** The named verifier a receiver folds the kind with. `none` = never accepted from a peer. */
export const ACCEPTS = Object.freeze({
  ROSTER: 'roster-binding',           // rosterBindingVerifier — the author is a proven per-circle address of a member
  MEMBERSHIP: 'membership-binding',   // membershipBindingVerifier — the roster rule plus the ceremony rule
  KEY: 'key-binding',                 // keyBindingVerifier — the roster rule plus the rotation class
  DEVICE_SET: 'device-set',           // deviceSetBindingVerifier — the person's own root-signed devices
  NONE: 'none',
});
/** Whether a person's own devices carry the kind to each other, and how. */
export const SYNC = Object.freeze({ CIRCLE: 'circle-default', SIBLINGS: 'siblings', NONE: 'none' });

const LOCAL_BINDING = Object.freeze({ signs: SIGNS.LOCAL, subject: SUBJECT.NONE, accepts: ACCEPTS.NONE, syncPolicy: SYNC.NONE });
/** A circle lane's usual binding: signed per circle, about nothing in particular, folded with the roster rule. */
const CIRCLE_BINDING = (over = {}) => Object.freeze({ signs: SIGNS.CIRCLE, subject: SUBJECT.NONE, accepts: ACCEPTS.ROSTER, syncPolicy: SYNC.CIRCLE, ...over });

const K = (lane, wakes, retain, audit, binding = LOCAL_BINDING) => Object.freeze({ lane, wakes, retain, audit, ...binding });

/**
 * The table. A kind absent from it is treated as `system / never wakes / short / not auditable` — the
 * conservative reading, so an unregistered kind cannot wake a phone or masquerade as conversation.
 */
export const ENTRY_KINDS = Object.freeze({
  // ── human-facing ──────────────────────────────────────────────────────────
  'chat-message':    K(LANE.HUMAN, true,  RETAIN.RECORD, false, CIRCLE_BINDING()),   // the conversation's RECORD — never drops
  task:              K(LANE.HUMAN, true,  RETAIN.CHAT, false, LOCAL_BINDING),     // a task LINE in the conversation — derived from a head, never the statement itself
  ask:               K(LANE.HUMAN, true,  RETAIN.CHAT, false, LOCAL_BINDING),   // legacy content kinds: demo seed + noticeboard intents, never a signed statement
  offer:             K(LANE.HUMAN, true,  RETAIN.CHAT, false, LOCAL_BINDING),
  lend:              K(LANE.HUMAN, true,  RETAIN.CHAT, false, LOCAL_BINDING),

  // ── system lane ───────────────────────────────────────────────────────────
  // `governance` carries ONE per-event exception, which stays explicit rather than becoming a second
  // table: a decision OPENING may wake (it needs a vote), individual votes and resolves must not.
  // See `governanceWakes()`.
  governance:        K(LANE.SYSTEM, false, RETAIN.AUDIT, true, CIRCLE_BINDING()),
  report:            K(LANE.SYSTEM, false, RETAIN.AUDIT, true, LOCAL_BINDING),
  // The task lane's signed statements: the carrier of a store head (a full-item snapshot, a removal), verified
  // at the rail and merged into the circle's store. Plumbing — the head is what a screen reads and what a
  // conversation line would be derived from; the statement itself must never paint. Same retention as the
  // human task kind: the store row is the durable head, the statements age out and catch-up re-serves heads.
  'task-statement':  K(LANE.SYSTEM, false, RETAIN.CHAT, false, CIRCLE_BINDING()),
  'delivery-state':  K(LANE.SYSTEM, false, RETAIN.SHORT, false, LOCAL_BINDING),
  'key-event':       K(LANE.SYSTEM, false, RETAIN.RECORD, true, CIRCLE_BINDING({ accepts: ACCEPTS.KEY })),  // the group-key chain refolds from these — a version that compacts away silently stops OLD sealed content opening
  membership:        K(LANE.SYSTEM, false, RETAIN.RECORD, true, { signs: [SIGNS.CIRCLE, SIGNS.ROOT], subject: [SUBJECT.PERSON, SUBJECT.DEVICE], accepts: ACCEPTS.MEMBERSHIP, syncPolicy: SYNC.CIRCLE }),   // the roster refolds from these — never drops
  grants:            K(LANE.SYSTEM, false, RETAIN.RECORD, true, { signs: [SIGNS.DEVICE, SIGNS.PERSON], subject: SUBJECT.NONE, accepts: ACCEPTS.DEVICE_SET, syncPolicy: SYNC.SIBLINGS }),   // the connection-grant set refolds from these — a revoke that compacts away silently re-admits a view

  // ── the agent trail (per-agent action log) ────────────────────────────────
  'agent-action':    K(LANE.SYSTEM, false, RETAIN.AUDIT, true, LOCAL_BINDING),
  'settings-change': K(LANE.SYSTEM, false, RETAIN.AUDIT, true, LOCAL_BINDING),

  // ── compaction output ─────────────────────────────────────────────────────
  // What old audit entries FOLD into instead of being dropped (retention step D): `{from, to, counts,
  // actors, foldedCount}` — the shape of what happened survives, and says how much it folded. Auditable
  // itself so an external append cannot rewrite it (the log's own compactor merges internally, not via
  // append); never pruned — a summary that expires would be the silent forgetting it exists to prevent.
  'audit-summary':   K(LANE.SYSTEM, false, RETAIN.AUDIT, true, LOCAL_BINDING),
});

/**
 * System-lane kinds a CONVERSATION still renders when an entry concerns the viewer — silent on the wire
 * (`wakes: false` stands), shown to the one person it is about. "Silent" had been read as "invisible",
 * and so a removed member was told nothing while every device held the signed statement that said so
 * (2026-08-29). The conversation projection derives the line from the entry; nothing is appended.
 */
export const VIEWER_FACING_SYSTEM_KINDS = Object.freeze(['membership', 'governance']);

/** The conservative default for an unregistered kind — never wakes, never reads as conversation. */
export const UNKNOWN_KIND = K(LANE.SYSTEM, false, RETAIN.SHORT, false, LOCAL_BINDING);   // accepts: none — refused from a peer by construction

/**
 * The binding columns of a kind, with the two that may name several levels normalised to arrays: a
 * membership statement is signed per circle, except a revocation, which the root signs in a ceremony.
 * @returns {{ signs: string[], subject: string[], accepts: string, syncPolicy: string }}
 */
export function bindingOf(kind) {
  const d = entryKind(kind);
  const arr = (v) => (Array.isArray(v) ? v : [v]);
  return { signs: arr(d.signs), subject: arr(d.subject), accepts: d.accepts, syncPolicy: d.syncPolicy };
}

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
 * The retention window PER class, as a DURATION in ms — the ONE table both audit records read: `sa.audit`
 * (the signed security log, in secure-agent) and the agent trail (in basis's `eventLog`). It lives HERE, in
 * the substrate, precisely so both can import it — secure-agent cannot import the basis app, so a copy in
 * `eventLog.js` (where it used to live) could never be the shared source. Durations are a per-user setting;
 * these are the shared DEFAULTS. Past its window an AUDIT entry COMPACTS into an `audit-summary` (never
 * drops); short/chat past theirs are dropped. The audit-retention agreement guard holds both records to reading THIS table.
 */
// Declared through the parameter register (the conventions' rule for tunable constants — these were bare
// literals before, itself a quiet violation). `record` has NO window on purpose: it is not a duration, it
// is the absence of one.
export const RETENTION_DEFAULTS = Object.freeze({
  [RETAIN.SHORT]: param({ key: 'retention.short', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 7 * 24 * 60 * 60 * 1000 }),    // pure plumbing — roster pings, delivery state
  [RETAIN.CHAT]:  param({ key: 'retention.chat',  scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 14 * 24 * 60 * 60 * 1000 }),   // content whose durable head lives elsewhere
  [RETAIN.AUDIT]: param({ key: 'retention.audit', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 14 * 24 * 60 * 60 * 1000 }),   // governance, reports, the agent trail — DETAIL window (key events moved to RECORD — the chain never drops)
});

/** The retention window (ms) for a RETAIN class (falls back to CHAT for an unknown class).
 *  `record` deliberately has no entry here — callers must branch on the class BEFORE asking for a window. */
export function retentionWindowFor(retainClass) {
  return RETENTION_DEFAULTS[retainClass] ?? RETENTION_DEFAULTS[RETAIN.CHAT];
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
