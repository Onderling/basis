/**
 * chatRail — chat messages ride THE RAIL (the content re-root, chat).
 *
 * The chat lane's one structural difference from every other lane: its log entries ARE the product
 * surface. A landed entry is the canonical render event the bubbles already read — `toEventLogItem`'s
 * shape, id = msgId, NON-silent so the conversation shows it — with the signed statement attached at
 * `payload.statement`. One entry serves both roles: what you see, and the proof of who said it.
 *
 *   send:    whitelist the wire payload (msgId, ts, text, scope, the media pointer through the wire
 *            projection) → sign with the per-circle key (chained: parent + deps) → append the render
 *            entry locally (keeping LOCAL presentation fields — the full media embed, actor 'me') →
 *            hand the STATEMENT to the fan.
 *   ingest:  verify (signature + declared kind + the key↔ref roster binding — which is also the
 *            EVICTION gate: a removed member has no roster row, so their statements stop landing) →
 *            spoof-guard (a different author may never land on an existing msgId; the log replaces on
 *            id, so without this a valid-but-hostile signature could overwrite someone's message) →
 *            derive the render entry FROM THE VERIFIED BODY (never from any unsigned wrapper) → append.
 *
 * MUTE stays a view filter (the sitting): a muted member's statements still verify and land — the
 * conversation projection hides them (`query({excludeMuted:true})` keys on the entry's actor), and
 * unmuting brings the history back. BLOCK/eviction is the refusal, and it binds here at ingest.
 *
 * msgId remains the join key (receipts, dedup, pod copies) as a field inside the SIGNED payload; the
 * statement hash authenticates, msgId identifies. (Unifying them is a recorded post-retirement candidate.)
 */
import { signSpine, verifySpine, authorHead, frontier } from '@onderling/core';
import { entryKindRegistryFromManifests, toEventLogItem, kindWakes } from '@onderling/item-store';
import { mediaForKringWire } from '@onderling/kring-host/kringBroadcast';
import { chatManifest, CHAT_LANE } from './chatManifest.js';
import { rosterBindingVerifier } from './membershipRail.js';

/** The statement kinds the chat lane carries — DERIVED from the manifest's declared appends. */
export const CHAT_RAIL_KINDS = entryKindRegistryFromManifests(chatManifest).kindsFor(CHAT_LANE);

/** The wire subtypes: the signed fan (distinct from the legacy plain-envelope subtype) + the catch-up
 *  trio for the frontier replay (chat is windowed + consent-gated — never pull-all). */
export const CHAT_STATEMENT_BROADCAST = 'kring-chat-statement';
export const CHAT_CATCHUP_SUBTYPES = Object.freeze({
  request: 'kring-chat-catchup-request',
  batch:   'kring-chat-catchup-batch',
  offer:   'kring-chat-catchup-offer',
});

/**
 * Build the chat rail over the device log.
 *
 * @param {object} a
 * @param {{query:Function, append:Function}} a.eventLog  the device log (the RENDERING append path)
 * @param {(circleId:string)=>Promise<object>} a.circleIdentityFor  per-circle signer (profile-seed derived)
 * @param {string} a.myRef      this member's ref (webid == chat pubKey in the basis binding)
 * @param {Function} a.callSkill  the waist (roster lookups for the key↔ref binding)
 * @param {Function} [a.verifyBinding]  override the roster binding verifier (tests)
 */
export function makeChatRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null }) {
  if (!eventLog || typeof eventLog.query !== 'function' || typeof eventLog.append !== 'function') {
    throw new Error('chatRail: an eventLog with query + append is required');
  }
  if (typeof circleIdentityFor !== 'function') return null;
  const bindingOkForeign = verifyBinding ?? rosterBindingVerifier(callSkill);

  /** The stored signed chat statements for one circle (raw — verification is the read side's job). */
  const storedStatements = (circleId) => eventLog
    .query({})
    .filter((e) => e && e.type === CHAT_LANE && e.payload?.circleId === circleId && e.payload?.statement?.body)
    .map((e) => e.payload.statement)
    .reverse();   // the log is most-recent-first; statements chain oldest-first

  const findEntry = (msgId) => eventLog.query({}).find((e) => e && e.id === msgId && e.type === CHAT_LANE) ?? null;

  /** verifySpine THROWS on structurally-garbage input — a malicious peer gets a refusal, never an exception. */
  const safeVerify = (statement, circleId) => {
    try { return verifySpine(statement, { expectedCircleId: circleId }); }
    catch (err) { return { ok: false, reason: `unverifiable: ${err?.message ?? err}` }; }
  };

  /** Is `author` (a circle key) genuinely `ref`'s key IN this circle? Self-binding, else the roster rows. */
  async function bindingOk(author, ref, circleId) {
    try {
      const mine = await circleIdentityFor(circleId);
      if (mine?.pubKey === author) return myRef === ref;
    } catch { /* fall through to the foreign resolver */ }
    try { return !!(await bindingOkForeign({ author, ref, circleId })); } catch { return false; }
  }

  /**
   * SEND — sign the whitelisted wire payload, append the render entry locally (LOCAL presentation
   * fields kept: the full media embed, the caller's actor label), return `{entry, statement}` for the
   * fan. Returns null when no circle signer resolves.
   */
  async function appendMessage(circleId, { msgId, ts, text, actor, scope, media, embeds, buttons } = {}) {
    if (typeof msgId !== 'string' || !msgId) return null;
    let identity = null;
    try { identity = await circleIdentityFor(circleId); } catch { identity = null; }
    if (!identity?.pubKey || typeof identity.sign !== 'function') return null;
    const at = typeof ts === 'number' ? ts : Date.now();
    // The WIRE payload — the explicit whitelist of what leaves this device, inside the signature.
    const wire = {
      msgId, ts: at,
      ...(typeof text === 'string' ? { text } : {}),
      ...(scope ? { scope } : {}),
      ...(embeds?.length ? { embeds } : {}),
      authorRef: myRef,
    };
    const wireMedia = mediaForKringWire(media);
    if (wireMedia) wire.media = wireMedia;
    const bodies = storedStatements(circleId).map((s) => s.body);
    const parent = authorHead(bodies, identity.pubKey);
    const deps = frontier(bodies).filter((h) => h !== parent);
    const statement = signSpine(identity, { kind: 'message', circleId, subject: msgId, payload: wire, parent, deps });
    // The LOCAL render entry keeps the caller's presentation fields (full media embed incl. sender-local
    // bookkeeping, the local actor label) — only the WIRE copy is whitelisted, and it rides the signature.
    const rendered = toEventLogItem({ msgId, ts: at, circleId, actor: actor ?? myRef, text, scope, media, embeds, buttons });
    const entry = eventLog.append({ ...rendered, payload: { ...rendered.payload, statement } });
    return { entry, statement };
  }

  /**
   * INGEST — the full gate, then the render append. Returns `{ok, entry, existed}` (frontierReplay's
   * progress guard reads `existed`), or `{ok:false, reason}`.
   */
  async function ingest(circleId, statement) {
    const v = statement && safeVerify(statement, circleId);
    if (!v || !v.ok) return { ok: false, reason: v?.reason ?? 'malformed' };
    const b = v.body;
    if (!CHAT_RAIL_KINDS.includes(b.kind)) return { ok: false, reason: `undeclared kind: ${b.kind}` };
    const ref = b.payload?.authorRef;
    if (typeof ref !== 'string' || !ref) return { ok: false, reason: 'missing authorRef' };
    // The roster binding doubles as the EVICTION gate: no roster row → no landing.
    if (!(await bindingOk(b.author, ref, circleId))) return { ok: false, reason: 'unverifiable key-ref binding' };
    const msgId = typeof b.payload.msgId === 'string' && b.payload.msgId ? b.payload.msgId : b.subject;
    if (typeof msgId !== 'string' || !msgId) return { ok: false, reason: 'missing msgId' };
    const existing = findEntry(msgId);
    if (existing) {
      const prevAuthor = existing.payload?.statement?.body?.author ?? null;
      // The log REPLACES on id — so an id already claimed by ANOTHER author is refused outright
      // (a valid signature must not let anyone overwrite someone else's message).
      if (prevAuthor !== null && prevAuthor !== b.author) return { ok: false, reason: 'msgId claimed by another author' };
      if (existing.payload?.statement?.body?.hash === b.hash) return { ok: true, entry: existing, existed: true };
      // Same author, new statement on the same msgId: their own resend/edit — replace stands.
    }
    // Derive the render entry FROM THE VERIFIED BODY — never from any unsigned wrapper around it.
    const p = b.payload;
    const rendered = toEventLogItem({
      msgId, ts: typeof p.ts === 'number' ? p.ts : Date.now(), circleId,
      actor: ref, senderDisplay: ref,
      text: typeof p.text === 'string' ? p.text : '',
      ...(p.scope ? { scope: p.scope } : {}),
      ...(p.media ? { media: p.media } : {}),
      ...(p.embeds?.length ? { embeds: p.embeds } : {}),
    });
    const entry = eventLog.append({ ...rendered, payload: { ...rendered.payload, statement } });
    return { ok: true, entry, existed: false };
  }

  return { appendMessage, ingest, storedStatements };
}

/**
 * The send-side emitter: append + sign locally, then hand the statement to the fan (best-effort —
 * the local write never blocks on delivery). Returns the appended render entry (the caller's bubble).
 */
export function makeChatEmitter({ rail, fan = null }) {
  if (!rail) return null;
  return async function emitChatMessage(circleId, fields) {
    const res = await rail.appendMessage(circleId, fields);
    if (!res) return null;
    if (typeof fan === 'function') {
      try { fan(circleId, res.statement); } catch { /* fan is best-effort — catch-up reconciles */ }
    }
    return res.entry;
  };
}

/** Peer handler for the signed chat fan → the rail's full ingest gate. `onLanded(circleId, entry)` is
 *  the side-effect seam (delivery receipts, the store-mirror bridge while it still exists). */
export function makeChatPeerHandler({ rail, onLanded = null } = {}) {
  if (!rail) throw new Error('makeChatPeerHandler: a chat rail is required');
  return async function onKringChatStatement(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== CHAT_STATEMENT_BROADCAST) return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;
    try {
      const res = await rail.ingest(circleId, statement);
      if (res?.ok && !res.existed && typeof onLanded === 'function') {
        try { await onLanded(circleId, res.entry); } catch { /* side effects are best-effort */ }
      }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}

/** Should this chat statement wake an offline device? Derived from the one shared kind table. */
export const chatStatementWakes = () => kindWakes(CHAT_LANE);
