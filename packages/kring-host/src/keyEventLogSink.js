// keyEventLogSink.js — the no-pod DISTRIBUTION sink for a circle's group-key rotations.
//
// The control-agent (packages/pod-client/src/sealing/controlAgent.js) already emits the versioned group
// key AS a log key-event whenever it is handed a `keyEventLog` sink — on establish, grant, and rotation.
// This module is that sink for a LIVE circle: it is what turns "the mechanism exists" into "the mechanism
// fires on a real membership change". On every emitted key-event the sink
//   (1) records it in the local no-pod key-event log, so THIS device folds the new version into its own
//       key chain (the source content sealing reads with no pod), and
//   (2) FANS it to the circle's remaining members over the SAME peer channel content rides. The event is
//       sealed multi-recipient to the then-current members only, so a removed member — absent from the
//       event's `recipients` — never receives a version it can fold and cannot open post-removal content
//       (backward secrecy, no pod). The pod key resource is still written as defence-in-depth; the LOG is
//       the source for a no-pod circle.
//
// Environment-neutral by construction: the caller injects HOW to resolve the recipient members' peer
// addresses and HOW to send, so the web shell (circle roster via `listGroupMembers` + agent.sendPeerMessage)
// and the node harness (the member nodes + the same sendPeerMessage) share ONE fan implementation — the
// payload shape and the fan loop are defined here exactly once (no web/mobile/test drift).

/** The peer-message `type`/`subtype` a fanned key-event rides under, so a receiver routes it to its
 *  key-event log (the no-pod key-chain carrier). Matches what the sealed-circle receive handler keys on. */
export const KEY_EVENT_PEER_TYPE = 'group-key-event';

/**
 * Build a `keyEventLog` sink to hand a control-agent (its `append(event)` is called on every key
 * establish/grant/rotation). Records locally + fans to the event's recipients.
 *
 * THE SIGNED-LANE ROUTE (the recorded architecture: key rotations are spine statements): when the
 * caller injects `emitStatement` + `statementSubtype`, the sink hands each raw key-event to the
 * key LANE's emitter — which signs it with the circle key, chains it per author, and appends it
 * to the device log — and fans the resulting STATEMENT instead of the bare event. The receiver
 * verifies signature + chain + the rotateKey authority at its rail before anything folds. A raw
 * un-statement fan happens ONLY when no emitter is wired (a log-less composition's honest
 * degrade); with an emitter wired, a key-event that cannot be signed is NOT fanned — fail closed,
 * an unsigned rotation must never reach a peer that would have to trust it bare.
 *
 * @param {object} o
 * @param {string} [o.groupId]                              circle id stamped on the fanned payload.
 * @param {(event:object) => (Array<string>|Promise<Array<string>>)} o.resolveRecipientAddrs  the peer
 *   addresses to fan this key-event to — the remaining members (the departed is absent from the event's
 *   `recipients`, so a roster-match naturally excludes them). See `recipientAddrsFromRoster`.
 * @param {(addr:string, payload:object, opts?:object) => any} o.sendPeer  the peer transport send.
 * @param {(event:object) => void} [o.recordLocal]          record the event in this device's local log.
 * @param {object} [o.sendOptions]                          per-send options (e.g. hold-forward for offline).
 * @param {(groupId:string, event:object) => Promise<object|null|undefined>} [o.emitStatement]  the key
 *   lane's emitter (sign + chain + append to the device log); returns the signed statement to fan.
 *   Contract: `undefined` means NO LANE in this composition (a late-wired shell whose bundle has no
 *   key rail) → the raw degrade below applies; `null` means the lane REFUSED to sign → fail closed.
 * @param {string} [o.statementSubtype]  the wire subtype a fanned statement rides (injected — this
 *   package must not depend up on the lane module that declares it).
 * @returns {{ append: (event:object) => Promise<void> }}
 */
export function makeKeyEventLogSink({ groupId = null, resolveRecipientAddrs, sendPeer, recordLocal = null, sendOptions, emitStatement = null, statementSubtype = null } = {}) {
  if (typeof resolveRecipientAddrs !== 'function') throw new Error('makeKeyEventLogSink: resolveRecipientAddrs required');
  if (typeof sendPeer !== 'function') throw new Error('makeKeyEventLogSink: sendPeer required');
  return {
    async append(event) {
      if (!event) return;
      // (1) local fold source — this device records every key-event it emits so its own chain advances.
      if (typeof recordLocal === 'function') { try { recordLocal(event); } catch { /* best-effort */ } }
      // (2) the signed lane: append as a spine statement; fan the STATEMENT. Fail closed on no signer.
      let payload = null;
      let statement;
      if (typeof emitStatement === 'function' && typeof statementSubtype === 'string' && statementSubtype) {
        try { statement = await emitStatement(groupId ?? event.groupId ?? null, event); } catch { statement = null; }
      }
      if (statement) {
        payload = { subtype: statementSubtype, circleId: groupId ?? event.groupId ?? null, event: statement };
      } else if (statement === null) {
        return;   // the lane exists and REFUSED to sign — an unsigned rotation never reaches a peer bare
      } else {
        // No lane in this composition (`undefined`) — the log-less honest degrade: the pre-lane raw fan.
        payload = { type: KEY_EVENT_PEER_TYPE, subtype: KEY_EVENT_PEER_TYPE, groupId: groupId ?? event.groupId ?? null, event };
      }
      // (3) fan to the event's recipients only (the remaining members) over the peer channel.
      let addrs = [];
      try { addrs = await resolveRecipientAddrs(event); } catch { addrs = []; }
      await Promise.all((Array.isArray(addrs) ? addrs : []).map((addr) =>
        Promise.resolve(sendPeer(addr, payload, sendOptions)).catch(() => { /* best-effort per recipient */ })));
    },
  };
}

/**
 * Resolve the peer addresses of a key-event's recipients from a circle roster: each member whose sealing
 * public key is among the event's `recipients`, addressed by its per-circle address (unlinkable) or its
 * signing pubKey. A removed member is NOT a recipient of the rotation event, so they are excluded here
 * without any special-casing. Tolerates the several roster shapes in play (trail projection vs.
 * control-agent roster vs. the node harness's member nodes).
 *
 * @param {object} event                            a `group-key-event` (its `recipients` are sealing pubkeys).
 * @param {Array<object>} [members]                 the circle roster rows.
 * @returns {Array<string>}                         the recipient members' peer addresses.
 */
export function recipientAddrsFromRoster(event, members = []) {
  const recips = new Set(Array.isArray(event?.recipients) ? event.recipients : []);
  const out = [];
  for (const m of (Array.isArray(members) ? members : [])) {
    const seal = m?.sealingPublicKey ?? m?.sealingPubKey ?? m?.publicKey;
    if (!seal || !recips.has(seal)) continue;
    const addr = m?.circleAddress ?? m?.pubKey ?? m?.signingPublicKey ?? m?.addr ?? m?.webid;
    if (addr) out.push(addr);
  }
  return out;
}
