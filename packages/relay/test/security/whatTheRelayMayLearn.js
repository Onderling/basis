/**
 * WHAT THE RELAY MAY LEARN — the privacy claim, written as data two guards read.
 *
 * The claim we most want to be able to make in public is:
 *
 *   > the relay knows which **addresses** exist and who controls them —
 *   > never which **circles** exist and who belongs to them.
 *
 * That sentence is the header of `packages/relay/src/server.js` and §2 of
 * `plans/DESIGN-boundary-authentication.md`. It had the weakest evidence of anything we say: its
 * journey (`J-B15`) asks a person to sit at a relay and write down what they saw, and **a person
 * cannot demonstrate a negative by doing something**. So the claim needs a test, and the test needs
 * the claim written down in a form it can check. That is this file.
 *
 * It is deliberately data, not assertions: the same "exceptions are data the guard reads" shape as
 * `docs/conventions/web-mobile-exceptions.md`, so an exception cannot be made without writing the
 * reason next to it.
 *
 * Two guards read it:
 *   • `circleBlindDecisions.test.js` — static: which lines of `packages/relay/src/**` may touch
 *     circle knowledge at all, and what kind of decision each one feeds.
 *   • `whatTheRelayLearns.test.js`   — dynamic: run a real relay through a real multi-circle
 *     session, record everything crossing its boundary, and diff against `DERIVABLE_FACTS`.
 *
 * ── THE HONEST PART ──────────────────────────────────────────────────────────────────────────────
 * A relay learns a great deal that is not about circles: who talks to whom by address, when, how
 * often, how big. It cannot not learn that — it is the thing forwarding the bytes. The claim is
 * about CIRCLES, and a guard that pretended otherwise would be worse than none, because it would
 * fail on ordinary traffic and teach everyone to ignore it. `DERIVABLE_FACTS` therefore states the
 * metadata plainly and completely; the teeth are in `FORBIDDEN_KNOWLEDGE` and in the fact that
 * anything NOT on either list fails the test.
 */

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * PART 1 — the static side: where circle knowledge is allowed to appear in the relay's source.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The identifiers (and one wire-frame string) that CARRY circle knowledge. A line of relay source
 * mentioning any of these is a line that knows a circle might exist, and must be accounted for
 * below. Scanned case-insensitively on word boundaries, over COMMENT-STRIPPED source — prose about
 * circles is exactly what we want people to keep writing.
 */
export const CIRCLE_KNOWLEDGE_TOKENS = Object.freeze([
  // The relay's own group state and the things that read it. `clientsByGroup`, `memberSet` and
  // `group-publish` name state that NO LONGER EXISTS (removed 2026-07-31 with the fan-out) — they
  // stay on this list on purpose: an allow-listed token that matches nothing is a tripwire for the
  // day someone reintroduces it, and it costs nothing to keep.
  'clientsByGroup', 'groupByAddress', 'groupMsgsToday', 'tickGroupMsg', 'senderGroup', 'memberSet',
  'groupAuth', 'acceptedGroups', 'groupProof', 'groupId', 'GroupAuthVerifier', 'verifyGroupProof',
  'memberPubKey', 'revokedMembers', 'msgsPerDay', 'group-publish', 'group_only',
  // The blob-gate ACL: a durable actor-set per blob (see KNOWN_HOLES).
  'grantMany', 'actorId', 'canRead',
  // Tripwires for anything NEW that names the concept out loud.
  'group', 'circle', 'circleId', 'roster', 'member', 'members', 'membership',
]);

/**
 * The closed vocabulary of what a circle-aware line may be FOR.
 *
 * There is deliberately no `membership-authorization` value. That is the whole point: if a future
 * line's honest classification is "it decides whether this person belongs to this circle", there is
 * nowhere to put it, and the guard fails until someone either removes the line or argues the
 * vocabulary open — in front of Frits, not silently in a diff.
 */
export const DECISION_KINDS = Object.freeze({
  OPERATOR_SERVING_POLICY:  'operator-serving-policy',
  OPERATOR_RESOURCE_POLICY: 'operator-resource-policy',
  BOOKKEEPING:              'bookkeeping',
  OPERATOR_LOG:             'operator-log',
});
// `FAN_OUT_DELIVERY` was here until 2026-07-31. It classified exactly one thing — the
// `group-publish` fan-out — and when that went, the slot went with it. Left standing it would be
// an empty pigeonhole inviting the next fan-out to file itself as already-approved; the vocabulary
// is supposed to shrink as the relay learns less. Re-adding it means arguing it open in the open.

/**
 * Modules whose ENTIRE job is one of the above. Listing a module rather than its lines is a real
 * loss of resolution, so it is allowed only where the module has a single stated purpose, its own
 * test file, and no route into the relay's register/forward decisions except the one line-listed
 * call in `server.js`.
 */
export const CIRCLE_AWARE_MODULES = Object.freeze([
  {
    file: 'GroupAuthVerifier.js',
    decision: DECISION_KINDS.OPERATOR_SERVING_POLICY,
    why: 'This module IS the operator policy "my relay serves these circles" (`acceptedGroups`), '
       + 'demoted from a security mechanism on 2026-07-31. It verifies a proof an operator asked '
       + 'for; it holds no roster, learns nothing at runtime, and short-circuits to ok=true when no '
       + 'acceptedGroups are configured — which is every relay we run. Its own guard is '
       + '`test/GroupAuthVerifier.test.js`. The line that matters for the claim is the ONE call '
       + 'site in server.js, which is line-listed below.',
  },
  {
    file: 'blobAclStore.js',
    decision: DECISION_KINDS.BOOKKEEPING,
    why: 'A key→Set<actorId> store for the blob gate. It is the storage half of KNOWN_HOLES entry '
       + '"blob-gate-acl" — see there for what it means and why it is not on the claim\'s good side. '
       + 'Listed at module level because every line of it is the same fact.',
  },
  {
    file: 'blobGateMount.js',
    decision: DECISION_KINDS.BOOKKEEPING,
    why: 'The HTTP routes in front of that store (`/grant`, the read gate). Same hole, mounted only '
       + 'when an operator passes `blobGate` to startRelay — see KNOWN_HOLES.',
  },
]);

/**
 * Every circle-aware line in the rest of `packages/relay/src/**`, grouped by the decision it feeds.
 *
 * Matched against comment-stripped, whitespace-normalised source, as a multiset — so a NEW circle
 * read fails, a MOVED one does not, and an EDITED one fails until someone re-reads the reason above
 * it. That last property is the one worth the maintenance: this list shrinks as the dumb-relay work
 * lands, and each shrink should be a deliberate act.
 */
export const CIRCLE_AWARE_CALL_SITES = Object.freeze([
  {
    what: 'The operator\'s serving policy is configured at startup',
    file: 'server.js',
    decision: DECISION_KINDS.OPERATOR_SERVING_POLICY,
    why: '`acceptedGroups` is a cost/serving decision an operator makes about their own machine — '
       + '"I host these circles". It is not a membership boundary: a circle can ride NKN, or be '
       + 'pod-backed with no relay in the path, so gating membership here is a speed bump you '
       + 'bypass by changing transport (`docs/conventions/enforceability.md`). Every relay we run '
       + 'leaves it unset, and unset means the whole of this list below is unreachable.',
    exitPath: 'Nothing depends on it. It could be deleted the day an operator prefers an address '
            + 'allow-list or an unadvertised url — DESIGN-boundary-authentication §7.',
    lines: [
      "import { GroupAuthVerifier } from './GroupAuthVerifier.js';",
      'acceptedGroups,',
      'const groupAuth = new GroupAuthVerifier({',
      'acceptedGroups: acceptedGroups ?? [],',
    ],
  },
  {
    what: 'The group state the one surviving group-aware path reads',
    file: 'server.js',
    decision: DECISION_KINDS.BOOKKEEPING,
    why: 'Two in-memory maps, empty in open mode because nothing populates them without an '
       + 'accepted group proof. `groupByAddress` and `groupMsgsToday` feed the per-day quota '
       + '(below), and that is now the whole list: `clientsByGroup` — the groupId → members set — '
       + 'went with the `group-publish` fan-out on 2026-07-31, so the relay no longer holds a set '
       + 'of who is in a circle even in principle. Declaring these is not knowledge; it is where '
       + 'knowledge would go if an operator configured some.',
    exitPath: 'They go when the quota goes.',
    lines: [
      'const groupByAddress = new Map();',
      'const groupMsgsToday = new Map();',
      'const tickGroupMsg = (groupId, cap) => {',
      'const rec = groupMsgsToday.get(groupId);',
      'groupMsgsToday.set(groupId, { day: today, count: 1 });',
    ],
  },
  {
    what: 'register: the serving policy is asked, before anything is accepted',
    file: 'server.js',
    decision: DECISION_KINDS.OPERATOR_SERVING_POLICY,
    why: 'The ONE circle-aware input to the register accept/reject decision, and it is the '
       + 'operator\'s own config rather than anything derived about the connecting device. In open '
       + 'mode `verifyBound` short-circuits to ok=true without reading the proof at all. The rest '
       + 'of the accept/reject decision — missing address, the per-connection address ceiling, and '
       + 'since 2026-07-31 the proof of possession itself — is circle-blind by construction, which '
       + '`circleBlindDecisions.test.js` asserts separately. Note what this branch can no longer '
       + 'do: it cannot register anybody. `clients.set` is not reachable from it.',
    exitPath: 'Deleting `acceptedGroups` deletes this call.',
    lines: [
      'const { address, groupProof, rotationProof } = msg;',
      'const auth = groupAuth.verifyBound({',
      'proof: groupProof,',
    ],
  },
  {
    what: 'register: the serving policy\'s ANSWER is carried from the challenge to the proof',
    file: 'server.js',
    decision: DECISION_KINDS.BOOKKEEPING,
    why: 'Registration became two frames on 2026-07-31 (proof of possession, Decision 3), so the '
       + 'answer the operator\'s own config gave in frame one has to survive until frame two — '
       + 'otherwise it would be asked twice and could answer differently, or the client would have '
       + 'to resend a group proof it already sent. It writes down a groupId the operator configured '
       + 'themselves, on a path that only exists when they did; it is never read back as an '
       + 'accept/reject input (the only reader is the day-quota bookkeeping below). In open mode — '
       + 'every relay we run — it stores null, because `auth.group` is null.',
    exitPath: 'Goes with `acceptedGroups`; without a serving policy there is no answer to carry.',
    lines: [
      'meterGroupId: auth.group?.groupId ?? null,',
    ],
  },
  {
    what: 'register-proof: bookkeeping AFTER the registration has already been accepted',
    file: 'server.js',
    decision: DECISION_KINDS.BOOKKEEPING,
    why: 'This line runs after `clients.set(address, socket)` — the point at which the client is '
       + 'already registered. It therefore cannot influence whether it was, which is asserted '
       + 'structurally rather than left to the reader. One line, down from five: three went with '
       + 'the `group-publish` fan-out on 2026-07-31 and one moved up into the challenge above when '
       + 'registration became two frames. What is written here is per-address ("which meter does '
       + 'this one spend against"), never per-circle.',
    exitPath: 'Goes with the `msgsPerDay` quota — nothing else reads what this line writes, so '
            + 'deleting the quota deletes it.',
    lines: [
      'groupByAddress.set(address, challenge.meterGroupId);',
    ],
  },
  {
    what: 'send: the per-day message quota',
    file: 'server.js',
    decision: DECISION_KINDS.OPERATOR_RESOURCE_POLICY,
    why: 'A cost cap on a circle the operator already chose to serve — how many messages per day, '
       + 'not who may speak. It reads `groupByAddress`, so it is genuinely circle-aware, and it is '
       + 'named here rather than waved past. It sits entirely BEFORE the routing decision '
       + '(`clients.get(to)`), so where a message goes is decided without it.',
    exitPath: 'Delete the block; the per-connection token bucket (circle-blind) already bounds a '
            + 'flood, and the quota is inert without `acceptedGroups`.',
    lines: [
      'const senderGroup = registeredAddress ? groupByAddress.get(registeredAddress) : null;',
      'if (senderGroup) {',
      'const cfg = groupAuth.acceptedGroups.find(g => g.groupId === senderGroup);',
      'const cap = cfg?.quotas?.msgsPerDay;',
      'const tick = tickGroupMsg(senderGroup, cap);',
    ],
  },
  {
    what: 'The one log line that can print a group id',
    file: 'server.js',
    decision: DECISION_KINDS.OPERATOR_LOG,
    why: 'The relay can write a group id to its own stdout — but only a group id the operator put '
       + 'in their own config and only on a path that config enables. It never derives one, and it '
       + 'never writes an address in full (`shortId` truncates) or any payload. With `acceptedGroups` '
       + 'unset — every relay we run — this line is unreachable, which the dynamic guard '
       + 'checks by capturing stdout through a whole multi-circle session. Three of these lines '
       + 'went with the fan-out on 2026-07-31; this quota rejection is the last one left.',
    exitPath: 'Drop the `group=` interpolation; the line stays useful without it.',
    lines: [
      'logLine(`[relay] quota-rejected ${shortId(registeredAddress)} send (group=${senderGroup} cap=${cap})`);',
    ],
  },
  {
    what: 'disconnect: tearing the group state down with the socket',
    file: 'server.js',
    decision: DECISION_KINDS.BOOKKEEPING,
    why: 'Forgetting, which is the good direction: when a socket closes, every address it held goes '
       + 'out of the routing table and out of the quota lookup with it. Nothing is decided here and '
       + 'nothing is read for a decision — the line exists so a departed device leaves no residue '
       + 'that could accumulate into a history of who was in a circle with whom. It used to be '
       + 'three lines; the two that emptied the groupId → members set went with the fan-out.',
    exitPath: 'Goes when the map goes — this is teardown for state listed above, not state of its own.',
    lines: [
      'for (const addr of registeredAddresses) groupByAddress.delete(addr);',
    ],
  },
]);

/**
 * Everything the relay writes to durable storage, column by column.
 *
 * Listed exhaustively rather than pattern-matched, because the leak we actually found is not called
 * `circle_id` — it is called `actorId` (see KNOWN_HOLES). A guard that greps for the word "circle"
 * in a schema would have passed straight over it. A new column fails until someone writes down what
 * it holds.
 */
export const PERSISTED_COLUMNS = Object.freeze([
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'id',           holds: 'opaque request id' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'callerPubKey', holds: 'an address' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'targets',      holds: 'addresses — who was asked. Co-recipiency, not circle membership: the caller chose this list, and the relay is told it because it has to deliver to it.' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'expected',     holds: 'a count' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'deadline',     holds: 'a timestamp' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'payload',      holds: 'the multi-recipient payload AS GIVEN. Sealed if the caller sealed it; the relay neither seals nor inspects.' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'createdAt',    holds: 'a timestamp' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'requests',  column: 'closed',       holds: 'a flag' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'responses', column: 'requestId',    holds: 'opaque request id' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'responses', column: 'fromPubKey',   holds: 'an address' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'responses', column: 'response',     holds: 'the response AS GIVEN' },
  { file: 'queueStores/SqliteQueueStore.js', table: 'responses', column: 'at',           holds: 'a timestamp' },
  { file: 'push/PushTokenStore.js',          table: 'push_tokens', column: 'address',    holds: 'an address' },
  { file: 'push/PushTokenStore.js',          table: 'push_tokens', column: 'token',      holds: 'a push token' },
  { file: 'push/PushTokenStore.js',          table: 'push_tokens', column: 'platform',   holds: 'ios/android' },
  { file: 'push/PushTokenStore.js',          table: 'push_tokens', column: 'registeredAt', holds: 'a timestamp' },
  { file: 'blobAclStore.js',                 table: 'blob_acl',  column: 'key',          holds: 'an opaque blob ref' },
  { file: 'blobAclStore.js',                 table: 'blob_acl',  column: 'actorId',      holds: '⚠ A MEMBER LIST. See KNOWN_HOLES "blob-gate-acl" — the rows for one key are the circle members the uploader granted, under a stable cross-circle identity.' },
  { file: 'blobAclStore.js',                 table: 'blob_acl',  column: 'grantedAt',    holds: 'a timestamp' },
]);

/**
 * ── KNOWN HOLES ──────────────────────────────────────────────────────────────────────────────────
 * Places where a relay CAN learn a circle-shaped fact. Not exceptions to be waved through: each one
 * says what it leaks, what has to be true for it to be reachable, and what closes it. The guards
 * assert the reachability condition, so a hole that quietly becomes reachable by default fails.
 *
 * TWO ENTRIES LEFT THIS LIST ON 2026-07-31, by being closed rather than reclassified:
 *   • `group-publish-names-a-circle-on-the-wire` — the frame is gone from the relay's protocol, and
 *     with it the `clientsByGroup` map it fanned out over. A broadcast is now N `send` frames from
 *     the client, which is the only party entitled to the roster. What guards it now is not a note
 *     here but the absence of an entry in `WIRE_FRAMES` (an unmapped frame fails the harness) and
 *     `circleBlindDecisions.test.js`'s assertion that the string is absent from `server.js`.
 *   • `verbose-log-prints-full-address` — the plaintext canary no longer guesses from an
 *     English-ish vowel ratio (which fired on ordinary base64 addresses) and no longer prints an
 *     80-character excerpt. It matches the sealed CONTRACT — payload must be `{_box}` — and puts its
 *     excerpt through `shortId` like every other relay log line. `verbose.js` + `verbose.test.js`.
 * They are recorded here rather than deleted silently, because a hole that vanishes without a note
 * reads the same as a hole nobody noticed.
 */
export const KNOWN_HOLES = Object.freeze([
  {
    id: 'blob-gate-acl',
    leaks: 'A durable co-membership record under a STABLE, CROSS-CIRCLE identity. '
         + '`POST <route>/grant { key, actors: [...] }` writes one row per (blob, actor) into '
         + '`blob_acl`, and the actors are — in the documented flow — "the circle members at upload '
         + 'time" (`blobAclStore.js` header). Two actors sharing a key are co-members of whatever '
         + 'circle that blob was shared into, and `actorId` is a pod WebID, not a per-circle '
         + 'address, so it links a person across every circle they upload into. It survives '
         + 'restarts. This is the exact thing J-B15 says the relay must never learn, and it is '
         + 'stronger than anything in server.js: durable, identified, and a roster in all but name.',
    reachableOnlyIf: 'startRelay is passed a `blobGate` option. Absent it, no route is mounted, no '
                   + 'ACL store exists, and a request to the mount path is an ordinary 404.',
    guard: 'whatTheRelayLearns.test.js asserts (a) the default relay mounts nothing and (b) that a '
         + 'relay WITH the gate does hold the co-membership record — a demonstration, so the hole '
         + 'is a measured fact rather than a note.',
    exitPath: 'Grant against a per-circle address instead of a WebID, and/or make the ACL a '
            + 'capability the reader presents (a signed grant) rather than a list the relay keeps. '
            + 'Either removes the roster from the relay. Neither is designed yet — this is a '
            + 'finding, not a plan.',
    filedIn: 'plans/DECISIONS-FOR-REVIEW.md, 2026-07-31, 🔴',
  },
  {
    id: 'one-socket-many-addresses',
    leaks: 'That several per-circle addresses belong to one device — because they register on one '
         + 'socket, and share one push token.',
    reachableOnlyIf: 'Always, on a relay a device registers more than one circle address with.',
    guard: 'Already walked and guarded: `test/perCircleAddressingConcession.test.js` (J-R1). It is '
         + 'listed here so the claim is not read as denying it.',
    exitPath: 'A socket per circle, at a cost in connections; or several relays, which is J-R2 and '
            + 'already works (`test/twoRelaysNoLinkage.test.js`).',
    filedIn: 'docs/decisions.md 2026-07-27 — accepted knowingly.',
  },
  {
    id: 'live-proxy-of-a-registration-challenge',
    leaks: 'Nothing by itself — it is the residue of the hole that closed. Proof of possession '
         + 'binds a registration to a nonce THIS relay issued, which kills capture-and-replay: a '
         + 'proof is useless at another relay and at another time. It does not kill a LIVE PROXY. A '
         + 'hostile relay a client is connected to can fetch a challenge from a THIRD relay, hand it '
         + 'over as its own, and forward the answer — registering that client\'s address there and '
         + 'taking over its inbound traffic on a relay the client never chose.',
    reachableOnlyIf: 'The client is connected to a hostile relay AND the address is (or would be) '
                   + 'used on another relay at the same time. Costly and targeted, unlike the claim '
                   + 'anyone could make before Decision 3.',
    guard: 'None yet, and that is stated rather than implied. Closing it needs the signed message to '
         + 'name WHICH relay it is for — an audience — which needs a relay to have an identity it '
         + 'can prove. Relays have no key today, and a url an operator configures is a knob whose '
         + 'wrong value is invisible, which is the failure mode Decision 3 exists to avoid.',
    exitPath: 'Add an audience field to `addressPossessionMessage` the day a relay has a verifiable '
            + 'identity of its own (a key, or a proven url).',
    filedIn: 'plans/DECISIONS-FOR-REVIEW.md, 2026-07-31, 🟡 · packages/core/src/identity/addressPossession.js header.',
  },
]);
// `unproven-registration` was the third entry here until 2026-07-31, and it read: *"anyone may
// register any address"* — the relay believed `{type:'register', address}` and `clients.set`
// overwrote whatever was there, so a fresh socket could take over another member's inbound traffic
// (measured on hardware, 2026-07-30). It is closed rather than reclassified: registration is
// challenge-first, an address is a public key, and the only path to a routing-table entry runs
// through a signature over a fresh single-use nonce. Recorded here rather than deleted silently,
// because a hole that vanishes without a note reads the same as a hole nobody noticed — and what
// remains of it is the entry above, which is a different and much narrower thing.

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * PART 2 — the dynamic side: what a relay may derive from a session, and what it may never.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ── THE CLAIM, IN EXECUTABLE FORM ────────────────────────────────────────────────────────────────
 *
 * Every fact the adversary harness derives from a real multi-circle session must reduce to one of
 * these. A fact that reduces to none of them fails the test — that is what converts "we looked and
 * saw nothing" into "we enumerated what is derivable".
 *
 * Read this as the promise. If it says more than we are willing to promise in public, the promise
 * is wrong, not the list.
 */
export const DERIVABLE_FACTS = Object.freeze([
  {
    id: 'socket-exists',
    fact: 'A connection opened at time T and closed at time T′. The relay is the endpoint; it cannot '
        + 'not know this.',
  },
  {
    id: 'addresses-on-a-socket',
    fact: 'Which addresses were registered on that connection, in which order, and therefore that '
        + 'they belong to one device. An address is a public key and reveals nothing about which '
        + 'circle it is for — but two of them on one socket are linked to each other. This is the '
        + 'J-R1 concession, taken knowingly.',
  },
  {
    id: 'address-possession',
    fact: 'That whoever is on this socket HOLDS THE KEY behind each address it registered — because '
        + 'the relay handed out a fresh nonce and got back a signature over it (Decision 3, '
        + '2026-07-31). This is a fact the relay gains, so it is listed here rather than treated as '
        + 'free: before it, "which addresses exist and who controls them" was a claim; now it is '
        + 'checked. It teaches the relay nothing NEW about a person — a signature verified against '
        + 'the address itself carries no identity the address did not already carry, no circle, and '
        + 'nothing linkable across relays (the nonce is this relay\'s, this session\'s, and single '
        + 'use). What it costs is one round trip.',
  },
  {
    id: 'signing-key',
    fact: 'Which KEY signed each envelope it forwards — carried in the header since Decision 1 '
        + '(2026-07-31), because a receiver that looks the key up by the claimed `_from` is '
        + 'authenticating the message against whatever that name maps to. Stated as a fact the relay '
        + 'gains rather than argued away, and the honest accounting has two halves. **Today it is '
        + 'redundant:** a per-circle address IS its signing key (one derivation — L2), so on circle '
        + 'traffic `_signedBy` equals `_from`, and on canonical traffic it equals the pubkey `_from` '
        + 'and `_to` already carry. The relay learns no string it did not already hold. **What it '
        + 'costs if L2 is answered "two derivations"** is a SECOND per-circle identifier in the '
        + 'header: still per-circle, still unlinkable across circles, but one more stable handle per '
        + 'member per circle that a relay can count and correlate over time within one circle. That '
        + 'is the price of the answer, and it belongs on this list the day it is paid rather than in '
        + 'the argument that pays it.',
  },
  {
    id: 'push-token',
    fact: 'At most one push token per connection, applied to every address on it. Same linkage as '
        + 'above, and durable across restarts by design (G15).',
  },
  {
    id: 'message-hop',
    fact: 'That address A handed the relay a frame addressed to B, at a time, of a size, carrying '
        + 'the envelope\'s cleartext routing header (see ENVELOPE_HEADER_FIELDS) and a topic label '
        + 'if the sender attached one. Traffic analysis over these — who talks to whom, how often, '
        + 'when — is fully available to the relay and is NOT claimed against.',
  },
  {
    id: 'queue-depth',
    fact: 'That a recipient was offline, how many frames are buffered for it, and that a drain '
        + 'happened when it came back.',
  },
  {
    id: 'peer-list',
    fact: 'The set of addresses currently registered — which the relay broadcasts to every '
        + 'registered client, so it is not even private to the operator. Only registered clients '
        + 'receive it; an unregistered lurker learns nothing.',
  },
  {
    id: 'refusal',
    fact: 'That it refused a frame, and which rule refused it (SENDER_NOT_REGISTERED, OVER_RATE, '
        + 'TOO_MANY_ADDRESSES, …).',
  },
  {
    id: 'give-up',
    fact: 'That a message it queued was never collected, and that it told the SENDER so. This is a '
        + 'presence fact and is listed as one rather than argued away: it says the recipient did not '
        + 'connect during the whole TTL window. It is here because the sender needs it (their message '
        + 'did not arrive) and because it is the COARSE version — after 24 h, unsolicited, not '
        + 'probeable. The fine-grained version, telling a sender that a message was queued rather than '
        + 'delivered, would let anyone test whether any address is online on demand; that frame is '
        + 'deliberately absent, and `undeliveredNotice.test.js` fails if it appears.',
  },
]);

/**
 * The other half, and the half with teeth. If any of these appears anywhere in the recorded corpus —
 * inbound frames, outbound frames, the relay's own stdout, its verbose hop log — the claim is false
 * and the test says so.
 */
export const FORBIDDEN_KNOWLEDGE = Object.freeze([
  'that a circle exists at all',
  'any circle id',
  'any circle name',
  'any roster or member list',
  'that two addresses the relay holds belong to the same circle (beyond the one-socket concession)',
  'any message content',
  'any human-readable name',
]);

/**
 * Wire frames that may cross the relay boundary, and which derivable fact each one is.
 *
 * An unmapped frame type fails the harness. That is the point: adding a frame to the relay protocol
 * should force someone to say what it tells the relay. `allowedKeys` is checked too, so a frame
 * growing a `circleId` field fails even if its type is already listed.
 */
export const WIRE_FRAMES = Object.freeze({
  // client → relay
  'register':                   { fact: 'addresses-on-a-socket', allowedKeys: ['type', 'address', 'groupProof', 'rotationProof'] },
  // Registration became two frames on 2026-07-31 (Decision 3). `register` now only ASKS; the relay
  // answers with a nonce and registers nothing until the answer verifies against the address. Both
  // new frames carry an address the relay was going to be told anyway plus opaque random bytes, so
  // neither widens what a relay may learn — but they are listed, because an unmapped frame fails
  // this harness and that is exactly the property that must survive the protocol growing.
  'register-proof':             { fact: 'address-possession',    allowedKeys: ['type', 'address', 'nonce', 'proof'] },
  'send':                       { fact: 'message-hop',           allowedKeys: ['type', 'to', 'envelope', 'topic'] },
  'peer-list':                  { fact: 'peer-list',             allowedKeys: ['type', 'peers'] },
  'register-push-token':        { fact: 'push-token',            allowedKeys: ['type', 'token', 'platform'] },
  'unregister-push-token':      { fact: 'push-token',            allowedKeys: ['type'] },
  // `group-publish` / `group-publish-ack` were here until 2026-07-31. They are deliberately NOT
  // listed: an unmapped frame fails the harness, so if the fan-out ever comes back, the frame
  // crossing the boundary is what fails first — which is the guarantee the removal was for.
  'multi-request':              { fact: 'message-hop',           allowedKeys: ['type', 'targets', 'payload', 'timeoutMs'] },
  'multi-response-from-target': { fact: 'message-hop',           allowedKeys: ['type', 'id', 'response'] },
  // relay → client
  'challenge':                  { fact: 'address-possession',    allowedKeys: ['type', 'address', 'nonce'] },
  // `registered` gained `address` with the same change: one socket registers several, so a client
  // has to know WHICH one was acked to be able to refuse an ack it never answered a challenge for
  // (the client-audits-the-relay half). It names an address the client just sent us.
  'registered':                 { fact: 'addresses-on-a-socket', allowedKeys: ['type', 'address'] },
  'message':                    { fact: 'message-hop',           allowedKeys: ['type', 'envelope'] },
  'error':                      { fact: 'refusal',               allowedKeys: ['type', 'message', 'reason'] },
  // 2026-07-31 — the relay tells a sender it gave up on a queued message (TTL or a cap ended it).
  // Carries the SENDER'S OWN message id back to them plus why, and nothing about the recipient. The
  // frame the relay deliberately does NOT have is the other one: a `queued` notice would turn "is this
  // person connected right now?" into a free query for anyone, which is the presence oracle this
  // product refuses everywhere else (`deliveryState.js` dropped `reached-device` for the same reason).
  'undelivered':                { fact: 'give-up',               allowedKeys: ['type', 'id', 'reason'] },
  'push-token-registered':      { fact: 'push-token',            allowedKeys: ['type'] },
  'push-token-unregistered':    { fact: 'push-token',            allowedKeys: ['type'] },
  'multi-deliver':              { fact: 'message-hop',           allowedKeys: ['type', 'id', 'from', 'payload'] },
  'multi-response':             { fact: 'message-hop',           allowedKeys: ['type', 'id', 'responses', 'partial'] },
});

/**
 * The envelope header fields the relay is allowed to see in cleartext.
 *
 * This is the sharpest single line of the claim: a circle id added to the envelope header would be
 * visible to every relay on the path, forever, and would be the easiest possible way to lose the
 * property by accident. Anything outside this set on an envelope crossing the boundary fails.
 *
 * `_to` is here with a caveat rather than a clean conscience: `SecurityLayer.encrypt` rewrites it to
 * the recipient's pubKey (`SecurityLayer.js:304`), so on a canonical-key circle it puts a stable
 * cross-circle identifier in the header. That is finding 3′ and Decision 4's job, not this file's —
 * but the harness sends with PER-CIRCLE identities, which is what makes `_to` harmless there, and it
 * asserts it rather than assuming it.
 */
export const ENVELOPE_HEADER_FIELDS = Object.freeze([
  '_v', '_p', '_id', '_re', '_from', '_to', '_topic', '_ts', '_sig', '_rotationProof', 'payload',
  // Added 2026-07-31 by Decision 1: the key that signed the envelope, carried so the receiver
  // verifies against it instead of against whatever key the claimed `_from` maps to. See the
  // `signing-key` derivable fact — it is listed as something the relay reads, not argued away.
  '_signedBy',
]);

/** The only key a sealed payload may carry. Anything else is content the relay can read. */
export const SEALED_PAYLOAD_KEYS = Object.freeze(['_box']);
