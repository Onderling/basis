/**
 * chatRail — chat messages ride THE RAIL (the content re-root, chat).
 *
 * The chat lane's one structural difference from every other lane: its log entries ARE the product
 * surface. A landed entry is the canonical render event the bubbles already read — `toEventLogItem`'s
 * shape, id = msgId, NON-silent so the conversation shows it — with the signed statement attached at
 * `payload.statement`. One entry serves both roles: what you see, and the proof of who said it.
 *
 *   send:    whitelist the wire payload (msgId, ts, text, scope, the embed card through the wire
 *            projection) → sign with the per-circle key (chained: parent + deps) → append the render
 *            entry locally (keeping LOCAL presentation fields — the full embed card, actor 'me') →
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
import { selfRefIn } from './selfRef.js';
import { signSpine, verifySpine, authorHead, frontier } from '@onderling/core';
import { entryKindRegistryFromManifests, toEventLogItem, kindWakes, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { cardForCircleWire } from '@onderling/kring-host/circleBroadcast';
import { chatManifest, CHAT_LANE } from './chatManifest.js';
import { rosterBindingVerifier } from './membershipRail.js';
import { NOT_TAKEN } from '../core/handlers/peerRouter.js';   // a verdict the receive record reads: not taken, so a repeat is handed on again

/** The statement kinds the chat lane carries — DERIVED from the manifest's declared appends. */
export const CHAT_RAIL_KINDS = entryKindRegistryFromManifests(chatManifest).kindsFor(CHAT_LANE);

/** The wire subtypes: the signed fan (distinct from the legacy plain-envelope subtype) + the catch-up
 *  trio for the frontier replay (chat is windowed + consent-gated — never pull-all). */
export const CHAT_STATEMENT_BROADCAST = 'circle-chat-statement';
export const CHAT_CATCHUP_SUBTYPES = Object.freeze({
  request: 'circle-chat-catchup-request',
  batch:   'circle-chat-catchup-batch',
  offer:   'circle-chat-catchup-offer',
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
/** The actors a chat line may carry without a signature: the shells' own optimistic line (`'me'`, web
 *  `LOCAL_ACTOR` and the phone's appendCircleMessage) and the local bot's bubbles and notices (`'bot'`). */
const UNSIGNED_LOCAL_ACTORS = new Set(['me', 'bot']);

export function makeChatRail({ eventLog, circleIdentityFor, myRef, callSkill, verifyBinding = null }) {
  const refIn = selfRefIn(myRef);   // in each circle, the self this device is there
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
      if (mine?.pubKey === author) return refIn(circleId) === ref;
    } catch { /* fall through to the foreign resolver */ }
    try { return !!(await bindingOkForeign({ author, ref, circleId })); } catch { return false; }
  }

  /**
   * SEND — sign the whitelisted wire payload, append the render entry locally (LOCAL presentation
   * fields kept: the full embed card, the caller's actor label), return `{entry, statement}` for the
   * fan. Returns null when no circle signer resolves.
   */
  async function appendMessage(circleId, { msgId, ts, text, actor, scope, card, embeds, buttons } = {}) {
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
      authorRef: refIn(circleId),
    };
    const wireCard = cardForCircleWire(card);
    if (wireCard) wire.card = wireCard;
    const bodies = storedStatements(circleId).map((s) => s.body);
    const parent = authorHead(bodies, identity.pubKey);
    const deps = frontier(bodies).filter((h) => h !== parent);
    const statement = signSpine(identity, { kind: 'message', circleId, subject: msgId, payload: wire, parent, deps });
    // The LOCAL render entry keeps the caller's presentation fields (full embed card incl. sender-local
    // bookkeeping, the local actor label) — only the WIRE copy is whitelisted, and it rides the signature.
    const rendered = toEventLogItem({ msgId, ts: at, circleId, actor: actor ?? refIn(circleId), text, scope, card, embeds, buttons });
    const entry = eventLog.append({ ...rendered, payload: { ...rendered.payload, statement } });
    return { entry, statement };
  }

  /**
   * SIGN AN ALREADY-APPENDED ENTRY — the shells' cutover hook. The send sites append the optimistic
   * render event first (unchanged code); the FAN then calls this to sign it: the wire payload is built
   * from the entry, the statement is attached in place (`append` replaces on id), and the statement is
   * returned for the signed fan. What never fans (bot bubbles, self-scoped lines) is never signed.
   * Returns null when the entry is missing, already signed, or no circle signer resolves.
   */
  async function signEntry(circleId, msgId) {
    const entry = findEntry(msgId);
    if (!entry || entry.payload?.circleId !== circleId) return null;
    if (entry.payload?.statement?.sig) return entry.payload.statement;   // already signed (a retry re-fans it)
    let identity = null;
    try { identity = await circleIdentityFor(circleId); } catch { identity = null; }
    if (!identity?.pubKey || typeof identity.sign !== 'function') return null;
    const p = entry.payload ?? {};
    const wire = {
      msgId, ts: entry.ts,
      ...(typeof p.text === 'string' ? { text: p.text } : {}),
      ...(p.scope ? { scope: p.scope } : {}),
      ...(p.embeds?.length ? { embeds: p.embeds } : {}),
      authorRef: refIn(circleId),
    };
    const wireCard = cardForCircleWire(p.card);
    if (wireCard) wire.card = wireCard;
    const bodies = storedStatements(circleId).map((s) => s.body);
    const parent = authorHead(bodies, identity.pubKey);
    const deps = frontier(bodies).filter((h) => h !== parent);
    const statement = signSpine(identity, { kind: 'message', circleId, subject: msgId, payload: wire, parent, deps });
    eventLog.append({ ...entry, payload: { ...p, statement } });
    return statement;
  }

  /**
   * INGEST — the full gate, then the render append. Returns `{ok, entry, existed}` (frontierReplay's
   * progress guard reads `existed`), or `{ok:false, reason}`.
   */
  /**
   * VERIFY without landing — the gate `ingest` applies up to the roster binding (signature, declared kind,
   * author↔ref binding, which doubles as the eviction gate) and nothing appended. What a device that does not
   * HOLD chat runs before it carries a statement on (sync-policy §11.3: hold nothing, still carry).
   */
  async function verify(circleId, statement) {
    const v = statement && safeVerify(statement, circleId);
    if (!v || !v.ok) return { ok: false, reason: v?.reason ?? 'malformed' };
    const b = v.body;
    if (!CHAT_RAIL_KINDS.includes(b.kind)) return { ok: false, reason: `undeclared kind: ${b.kind}` };
    const ref = b.payload?.authorRef;
    if (typeof ref !== 'string' || !ref) return { ok: false, reason: 'missing authorRef' };
    if (!(await bindingOk(b.author, ref, circleId))) return { ok: false, reason: 'unverifiable key-ref binding' };
    return { ok: true, body: b };
  }
  // NOTE (2026-09-17): `ingest` repeats `verify`'s gate inline rather than awaiting it. Routing it through the
  // extra await made the own-devices relay walk go red (the carry to the always-on device was refused at its
  // sender gate — measured, not understood); the two gates must stay identical, and a test pins that.
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
      const prevBody = existing.payload?.statement?.body ?? null;
      const prevAuthor = prevBody?.author ?? null;
      // The log REPLACES on id — so an id already claimed by ANOTHER author is refused outright
      // (a valid signature must not let anyone overwrite someone else's message).
      if (prevAuthor !== null && prevAuthor !== b.author) return { ok: false, reason: 'msgId claimed by another author' };
      if (prevBody?.hash === b.hash) return { ok: true, entry: existing, existed: true };
      // Same author, different statement on the same msgId (their resend/edit). The winner is decided by
      // the author's OWN CHAIN, never by arrival order — the live fan and a catch-up batch deliver in
      // different orders, and both devices must keep the same version:
      //   • the existing statement is an ANCESTOR of the new one → the new supersedes (a real edit);
      //   • the new one is an ancestor of the existing → a stale re-delivery, dropped as `existed`;
      //   • incomparable (a fork off the same head) → the deterministic hash tiebreak, same everywhere.
      if (prevBody?.hash) {
        const chain = new Map(storedStatements(circleId).map((s) => [s.body.hash, s.body]));
        chain.set(b.hash, b);
        const ancestorOf = (fromHash, target) => {
          let cursor = fromHash; const seen = new Set();
          while (cursor && !seen.has(cursor)) {
            if (cursor === target) return true;
            seen.add(cursor);
            cursor = chain.get(cursor)?.parentHash ?? null;
          }
          return false;
        };
        const newSupersedes = ancestorOf(b.parentHash ?? null, prevBody.hash);
        const staleRedelivery = !newSupersedes && ancestorOf(prevBody.parentHash ?? null, b.hash);
        if (staleRedelivery) return { ok: true, entry: existing, existed: true };
        if (!newSupersedes && String(b.hash).localeCompare(String(prevBody.hash)) < 0) {
          return { ok: true, entry: existing, existed: true };   // the fork's deterministic loser
        }
      }
    }
    // Derive the render entry FROM THE VERIFIED BODY — never from any unsigned wrapper around it.
    const p = b.payload;
    const rendered = toEventLogItem({
      msgId, ts: typeof p.ts === 'number' ? p.ts : Date.now(), circleId,
      actor: ref, senderDisplay: ref,
      text: typeof p.text === 'string' ? p.text : '',
      ...(p.scope ? { scope: p.scope } : {}),
      ...(p.card ? { card: p.card } : {}),
      ...(p.embeds?.length ? { embeds: p.embeds } : {}),
    });
    const entry = eventLog.append({ ...rendered, payload: { ...rendered.payload, statement } });
    return { ok: true, entry, existed: false };
  }

  /** Is a message with this msgId already landed here? (The ref path checks BEFORE a pod read.) */
  const hasEntry = (circleId, msgId) => {
    const e = findEntry(msgId);
    return !!e && e.payload?.circleId === circleId;
  };

  /** What a catch-up sends on must still be what its author signed, checked here, now (as the circle entry rail's). */
  const checkSigned = (circleId, statement) => !!statement && statement.tombstone !== true && safeVerify(statement, circleId)?.ok === true;

  /** A STORED chat entry, judged as an arrival (a history restore runs it before the entry lands). A signed one must
   *  verify, and the text the bubble shows must be the text that was signed. A line with no statement never fanned: it
   *  lands only when it is this person's own (the shells' local actor, or this device's self in the circle) or the
   *  local bot's; one naming anyone else would show as THEIR message, so it is refused like a bad signature. */
  const checkEntry = (entry) => {
    if (!entry || entry.type !== CHAT_LANE) return false;
    const p = entry.payload ?? {};
    if (p.statement === undefined || p.statement === null) {
      return UNSIGNED_LOCAL_ACTORS.has(entry.actor) || (typeof p.circleId === 'string' && entry.actor === refIn(p.circleId));
    }
    if (typeof p.circleId !== 'string' || !checkSigned(p.circleId, p.statement)) return false;
    const asText = (x) => (typeof x === 'string' ? x : '');   // a landing renders no text as '' (ingest above)
    return asText(p.text) === asText(p.statement.body?.payload?.text);
  };

  return { entryKind: CHAT_LANE, appendMessage, signEntry, ingest, verify, storedStatements, hasEntry, checkSigned, checkEntry };
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

/** Peer handler for the signed chat fan → the rail's full ingest gate. `onLanded(circleId, entry, fromPeerAddr,
 *  statement)` is the side-effect seam (delivery receipts, the sibling carry — which re-sends the STATEMENT, so it
 *  rides along beside the log entry). */
export function makeChatPeerHandler({ rail, onLanded = null, resolveRef = null, holds = null, onPassed = null } = {}) {
  if (!rail) throw new Error('makeChatPeerHandler: a chat rail is required');
  return async function onCircleChatStatement(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== CHAT_STATEMENT_BROADCAST) return NOT_TAKEN;
    const { circleId } = payload;
    if (typeof circleId !== 'string' || !circleId) return NOT_TAKEN;
    // THIS DEVICE'S SELECTION (sync-policy §11): `holds(circleId)` → true (land it), false (this device holds
    // no chat for this circle: VERIFY, hand it on to the siblings through `onPassed`, keep nothing), or null
    // (this device holds this KRING not at all: refused on landing, nothing carried — the stale case).
    const h = typeof holds === 'function' ? holds(circleId) : true;
    if (h === null) return NOT_TAKEN;
    try {
      // Two carriages, one subtype: the statement INLINE (`payload.event` — the peer fan and catch-up
      // batches), or a POD REF (`payload.ref`, a pod-signal circle's row pointer) resolved through the
      // injected sealed-pod reader. The row carries the statement and passes the SAME verify gate as a
      // fanned one — the pod is transport, never authority. A ref for a message already landed is
      // dropped WITHOUT a pod read.
      let statement = payload.event ?? null;
      if (!statement && typeof payload.ref === 'string' && payload.ref && typeof resolveRef === 'function') {
        if (typeof payload.msgId === 'string' && payload.msgId && rail.hasEntry(circleId, payload.msgId)) return undefined;   // already landed: taken
        const row = await resolveRef(payload);
        statement = row?.event ?? null;
      }
      if (!statement?.body || !statement?.sig) return NOT_TAKEN;   // a ref the pod could not serve yet stays retryable
      if (h === false) {
        // hold nothing, still carry — and never carry what did not verify (a carrier is not an authority)
        const v = typeof rail.verify === 'function' ? await rail.verify(circleId, statement) : { ok: false };
        if (v?.ok && typeof onPassed === 'function') { try { await onPassed(circleId, statement, fromPeerAddr); } catch { /* best-effort */ } }
        return v?.ok ? undefined : NOT_TAKEN;
      }
      const res = await rail.ingest(circleId, statement);
      if (res?.ok && !res.existed && typeof onLanded === 'function') {
        // fromPeerAddr rides along — the delivery receipt cannot answer a sender it was never told about.
        try { await onLanded(circleId, res.entry, fromPeerAddr, statement); } catch { /* side effects are best-effort */ }
      }
      return res?.ok ? undefined : NOT_TAKEN;   // a refusal stays retryable (see the membership handler)
    } catch { return NOT_TAKEN; /* ingest is best-effort — never throw on a peer message */ }
  };
}

/**
 * The POD-ONLY circle's catch-up: no fan ever happens there — the shared pod IS the meeting point, so
 * on each kick the reader range-queries the pod since just before its newest landed message and ingests
 * every statement row through the rail's full verify gate (idempotent; the overlap only costs dedup).
 * Lane entries stay the record; the pod is the transport for members who were offline.
 *
 * @param {object} a
 * @param {object} a.rail                       the chat rail
 * @param {(circleId:string, q:{sinceTs:number})=>Promise<{items:object[], truncated:boolean}>} a.podReadSince  the
 *   shared custody's sealed-pod range reader (`circlePodReadSince`): one page forward from `sinceTs`, `truncated` when
 *   more rows follow; the catch-up reads on page by page, so a long absence loses nothing
 * @param {(circleId:string)=>Promise<string>|string} [a.dataMoveFor]  the circle's data-move branch; absent →
 *   every listed circle is probed (a pod-less circle's reader just returns nothing)
 * @param {{query: Function}} a.eventLog        for the since-watermark (newest landed chat entry per circle)
 */
/** How far behind its newest landed chat entry the pod read-back starts again (idempotent ingest dedups the overlap). */
export const POD_CATCHUP_OVERLAP_MS = param({ key: 'chat.podCatchUpOverlapMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 * 60 * 1000 });
/** Pages the pod read-back reads per kick (the reader's page is 200 rows); the next kick reads on from where it landed. */
export const POD_CATCHUP_MAX_PAGES = param({ key: 'chat.podCatchUpMaxPages', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });

export function makePodChatCatchUp({ rail, podReadSince, dataMoveFor = null, eventLog } = {}) {
  if (!rail || typeof podReadSince !== 'function') return null;

  async function catchUpCircle(circleId) {
    if (typeof dataMoveFor === 'function') {
      try {
        const move = await dataMoveFor(circleId);
        if (move !== 'pod-only' && move !== 'pod-signal') return { ingested: 0 };
      } catch { return { ingested: 0 }; }
    }
    let sinceTs = 0;
    try {
      for (const e of eventLog?.query?.({}) ?? []) {
        if (e?.type === CHAT_LANE && e.payload?.circleId === circleId && typeof e.ts === 'number' && e.ts > sinceTs) sinceTs = e.ts;
      }
    } catch { sinceTs = 0; }
    let ingested = 0;
    let from = Math.max(0, sinceTs - POD_CATCHUP_OVERLAP_MS);
    // page by page: the reader answers one page forward from `from`; read on from the last row's ts while more follow
    // The watermark is the newest LANDED chat entry: a kick whose pages held only refused rows lands nothing, so the
    // next kick starts from the same watermark and reads those pages again (bounded by the page cap; no cursor kept).
    for (let page = 0; page < POD_CATCHUP_MAX_PAGES; page += 1) {
      let read;
      try { read = await podReadSince(circleId, { sinceTs: from }); }
      catch { return { ingested }; }
      const rows = read?.items ?? [];
      for (const row of rows) {
        const statement = row?.event;
        if (!statement?.body || !statement?.sig) continue;   // a pre-statement row: the migrated era's copy
        try { const r = await rail.ingest(circleId, statement); if (r?.ok && !r.existed) ingested += 1; }
        catch { /* one bad row never blocks the rest */ }
      }
      const last = rows[rows.length - 1]?.ts;
      // done, or no progress (a full page of one ts): the next kick reads on from the newest landed entry
      if (!read?.truncated || !Number.isFinite(last) || last <= from) break;
      from = last;
    }
    return { ingested };
  }

  /** Kick every listed circle (the shells pass their live circle list). Best-effort per circle. */
  async function catchUpAll(circleIds) {
    let ingested = 0;
    for (const cid of (Array.isArray(circleIds) ? circleIds : [])) {
      if (typeof cid !== 'string' || !cid) continue;
      try { ingested += (await catchUpCircle(cid)).ingested; } catch { /* next circle */ }
    }
    return { ingested };
  }

  return { catchUpCircle, catchUpAll };
}

/** Should this chat statement wake an offline device? Derived from the one shared kind table. */
export const chatStatementWakes = () => kindWakes(CHAT_LANE);

/**
 * What is still OWED after a restart — the outbox as a PROJECTION of the one log (recorded
 * 2026-08-18: no duplicate store). A statement is owed when it is MINE (my authorRef inside the
 * signature), recent enough that the hold promise still stands (the hold TTL), and no `delivery-state`
 * receipt for it has landed on the log. Re-fanning these is idempotent end to end: every receiver's
 * rail dedups by entry, and a receipt that arrives meanwhile removes the held copy (receipt-keyed
 * removal) and excludes the message from the next boot's list.
 *
 * @param {object} a
 * @param {{query: Function}} a.eventLog
 * @param {string} a.circleId
 * @param {string} a.myRef
 * @param {number} [a.ttlMs]
 * @returns {Array<{ msgId: string, ts: number, statement: object }>} oldest-first
 */
export function owedChatStatements({ eventLog, circleId, myRef, ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  if (typeof eventLog?.query !== 'function' || !circleId || !myRef) return [];
  let entries = [];
  try { entries = eventLog.query({}) ?? []; } catch { return []; }
  const receipted = new Set();
  for (const e of entries) {
    if (e?.type === 'delivery-state' && typeof e?.payload?.msgId === 'string') receipted.add(e.payload.msgId);
  }
  const now = Date.now();
  return entries
    .filter((e) => e && e.type === CHAT_LANE && e.payload?.circleId === circleId && e.payload?.statement?.body)
    .filter((e) => (now - (e.ts ?? 0)) <= ttlMs)
    .filter((e) => e.payload.statement.body?.payload?.authorRef === myRef)
    .filter((e) => !receipted.has(e.id))
    .map((e) => ({ msgId: e.id, ts: e.ts ?? 0, statement: e.payload.statement }))
    .reverse();   // the log is most-recent-first; re-fan oldest-first
}
