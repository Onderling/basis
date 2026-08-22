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
 * @param {(circleId:string, statement:object, recipientWebids:string[]) => Promise<*>} [o.fanStatement]
 *   fan the signed statement THROUGH THE WAIST (the circle broadcast op), narrowed to those
 *   recipients. Preferred over the direct `sendPeer` loop: the fan-out core sends under the
 *   per-circle address, which is the only identity a receiver accepts inside a circle. Narrowed by
 *   WEBID, because that is the key the fan-out core's `only` set matches on — see
 *   `recipientWebidsFromRoster`.
 * @param {(event:object) => (Array<string>|Promise<Array<string>>)} [o.resolveRecipientWebids]
 *   the same recipients as webids, for the `fanStatement` narrowing.
 * @returns {{ append: (event:object) => Promise<void> }}
 */
export function makeKeyEventLogSink({ groupId = null, resolveRecipientAddrs, sendPeer, recordLocal = null, sendOptions, emitStatement = null, statementSubtype = null, fanStatement = null, resolveRecipientWebids = null } = {}) {
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
      // (3) fan to the event's recipients only (the remaining members).
      let addrs = [];
      try { addrs = await resolveRecipientAddrs(event); } catch { addrs = []; }
      addrs = Array.isArray(addrs) ? addrs : [];

      // THROUGH THE WAIST when the caller wires it — the circle fan-out core, narrowed to those
      // recipients. This is what the other lanes do, and it matters for more than tidiness: the
      // core sends under the member's PER-CIRCLE address, while a direct peer send goes out under
      // the canonical identity, which every receiver refuses inside a circle ("only the per-circle
      // key may speak"). Fanning direct meant a rotation arrived and was thrown away at each peer.
      if (typeof fanStatement === 'function' && statement) {
        let webids = [];
        if (typeof resolveRecipientWebids === 'function') {
          try { webids = (await resolveRecipientWebids(event)) ?? []; } catch { webids = []; }
        }
        try {
          await fanStatement(groupId ?? event.groupId ?? null, statement,
            Array.isArray(webids) && webids.length ? webids : null);
          return;
        } catch { /* fall through to the direct fan below */ }
      }
      // The direct peer fan: the log-less degrade (no lane, so no statement to hand the waist), and
      // the fallback for a composition that wires no `fanStatement`.
      await Promise.all(addrs.map((addr) =>
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
 * A roster row does NOT generally carry a sealing key — `listGroupMembers` surfaces one only when the
 * joiner supplied it at redemption, which the live join flow does not. A member's sealing key is a
 * deterministic function of their network key, so `deriveSealingKey` is INJECTED (the caller passes
 * `sealingPublicKeyFromNetworkKey` from `@onderling/pod-client`) and used whenever the row has none —
 * the same injection shape, and for the same layering reason, as `basis/src/v2/shareRecipients.js`.
 * Without it this resolved to an empty recipient list for every real circle, so every rotation fanned
 * to nobody while looking entirely healthy at both ends.
 *
 * @param {object} event                            a `group-key-event` (its `recipients` are sealing pubkeys).
 * @param {Array<object>} [members]                 the circle roster rows.
 * @param {object} [o]
 * @param {(networkKey: string) => string} [o.deriveSealingKey]  `sealingPublicKeyFromNetworkKey`.
 * @returns {Array<string>}                         the recipient members' peer addresses.
 */
export function recipientAddrsFromRoster(event, members = [], { deriveSealingKey = null } = {}) {
  return recipientRowsFromRoster(event, members, { deriveSealingKey })
    .map((m) => m?.circleAddress ?? m?.pubKey ?? m?.signingPublicKey ?? m?.addr ?? m?.webid)
    .filter(Boolean);
}

/**
 * The same matched recipients, as WEBIDs. The circle fan-out core narrows a broadcast with an
 * `only` set keyed on webid — not on address — so a fan through the waist needs this shape and the
 * direct peer fan needs the addresses above. Two projections of one match, rather than two matchers.
 *
 * @param {object} event
 * @param {Array<object>} [members]
 * @param {object} [o]
 * @param {(networkKey: string) => string} [o.deriveSealingKey]
 * @returns {Array<string>}
 */
export function recipientWebidsFromRoster(event, members = [], { deriveSealingKey = null } = {}) {
  return recipientRowsFromRoster(event, members, { deriveSealingKey })
    .map((m) => m?.webid ?? m?.pubKey ?? m?.addr)
    .filter(Boolean);
}

/** The one match: roster rows whose sealing key is among the event's recipients. */
function recipientRowsFromRoster(event, members = [], { deriveSealingKey = null } = {}) {
  const recips = new Set(Array.isArray(event?.recipients) ? event.recipients : []);
  const out = [];
  for (const m of (Array.isArray(members) ? members : [])) {
    // The stored key wins when the row has one; otherwise derive it from the member's network key.
    // Both the per-circle address and the canonical pubKey are tried: which of the two a member's
    // key was sealed to depends on when they joined.
    const candidates = [m?.sealingPublicKey, m?.sealingPubKey, m?.publicKey];
    if (typeof deriveSealingKey === 'function') {
      for (const net of [m?.circleAddress, m?.pubKey, m?.signingPublicKey, m?.webid]) {
        if (typeof net !== 'string' || !net) continue;
        try { candidates.push(deriveSealingKey(net)); } catch { /* not a network key — next */ }
      }
    }
    if (!candidates.some((k) => k && recips.has(k))) continue;
    out.push(m);
  }
  return out;
}
