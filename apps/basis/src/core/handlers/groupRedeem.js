/**
 * Inbound group-redeem handlers. Bundle H Phase 2 — lifted
 * from `apps/basis/web/main.js:679` + `:789` (fallback
 * over NKN).
 *
 * Two paired flows:
 *
 *   - `makeHandleGroupRedeemRequest` (ADMIN side) — verifies a
 *     joiner's membership code via `stoop.verifyMembershipCodeForPeer`
 *     + replies with `group-redeem-response`.  On success, fires
 *     `propagateMeshIntros` so newly-consenting members see each
 *     other's addresses.  The reply also carries the ADMIN's OWN
 *     per-circle address + proof — see `ownProvenCircleAddress`.
 *
 *   - `makeHandleGroupRedeemResponse` (JOINER side) — looks up the
 *     pending request by `requestId` in a caller-owned `pendingMap`
 *     and resolves its promise so the /join-group flow can complete.
 *     The pending map is platform state (web's Map lives in main.js);
 *     we inject it for parity.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(addr: string, payload: object) => Promise<*>}                  args.sendPeer
 * @param {(args: {groupId: string, newPeerAddr: string, newPeerDisplay?: string, newPeerShared?: boolean}) => Promise<*>} [args.propagateMeshIntros]
 * @param {(args: {circleId: string, newMemberWebid: string}) => Promise<*>} [args.propagateCircleAddresses]
 *   B2 — hand the circle the newcomer's PROVEN per-circle address, and the newcomer the circle's.
 *   The admin is the only party that can reach both sides at this moment; see
 *   `v2/circleAddressAnnounce.js` for why carrying these is not vouching for them.
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {(groupId: string) => (string|null)}                             [args.circleAddressFor]  the admin's own per-circle address presenter
 * @param {(groupId: string, address: string) => (string|null)}            [args.signCircleAddress] …and its proof-of-possession signer
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 */
export function makeHandleGroupRedeemRequest({
  callSkill, sendPeer, propagateMeshIntros, propagateCircleAddresses, publishEvent,
  circleAddressFor, signCircleAddress, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleGroupRedeemRequest: callSkill required');
  if (typeof sendPeer  !== 'function') throw new Error('makeHandleGroupRedeemRequest: sendPeer required');

  return async function handleGroupRedeemRequest(fromAddr, payload) {
    const { requestId, groupId, code, shareCard, peerDisplay, circleAddress, circleAddressProof, personaProperties, rulesAccepted } = payload ?? {};
    if (!requestId || !groupId || !code) {
      logger.warn?.('[peer] group-redeem-request missing fields', payload);
      return;
    }
    let reply;
    try {
      const result = await callSkill('stoop', 'verifyMembershipCodeForPeer', {
        groupId, code,
        requesterWebid: fromAddr,
        ...(shareCard   ? { shareCard: true } : {}),
        ...(peerDisplay ? { peerDisplay }     : {}),
        // Identity 5B/C — the JOINER's per-circle address + its cross-circle link PROOF,
        // forwarded from their request envelope. The admin skill verifies the proof and
        // records the address only if it holds (SENSITIVE — a "continue as an existing self"
        // linkage must be provable, never a bare claim a co-member could forge).
        ...(circleAddress ? { circleAddress } : {}),
        ...(circleAddressProof ? { circleAddressProof } : {}),
        // task #80 — the joiner's acceptance, recorded verbatim onto the admin-signed join statement.
        ...(typeof rulesAccepted === 'string' && rulesAccepted ? { rulesAccepted } : {}),
        // Property layer — the joiner's disclosed persona properties, forwarded to the admin's roster.
        ...(personaProperties && Object.keys(personaProperties).length ? { personaProperties } : {}),
      });
      if (result?.error) {
        reply = { error: result.error };
      } else {
        reply = { ok: true, codeId: result.codeId, validUntil: result.validUntil };
        // Per-circle addressing RIDES BACK (2026-07-30). Until now it was one-directional: the joiner
        // presented + proved its per-circle address and the admin recorded it, so the admin could reach
        // the joiner while the joiner held no per-circle address for the ADMIN and fell through to their
        // global signing key — which, with the per-user address-fallback setting off (the default), is
        // refused outright (`resolveMemberAddress` → `blocked-by-setting`). Measured on hardware:
        // admin→joiner chat worked, joiner→admin did not.
        //
        // The redeem RESPONSE is the moment to fix it: both sides are talking, on a channel the joiner
        // already trusts, and one field closes the loop. It is PROVEN, not asserted — the joiner runs the
        // same `verifyCircleLink` check the admin runs on the way in, so a co-member who has merely SEEN
        // the admin's address in another circle cannot inject it here.
        //
        // (The general refresh path — addresses on the roster-updated broadcast — is deliberately NOT
        // built here: it is the same mechanism as "re-announce", and the two belong together.)
        const own = ownProvenCircleAddress(groupId, { circleAddressFor, signCircleAddress });
        if (own) Object.assign(reply, own);
      }
    } catch (err) {
      reply = { error: err?.message ?? String(err) };
    }
    try {
      await sendPeer(fromAddr, {
        type:    'p2p-chat',
        subtype: 'group-redeem-response',
        requestId,
        ...reply,
        sentAt:  Date.now(),
      });
      publishEvent?.({
        app: 'stoop', type: 'notification',
        payload: {
          message: reply.ok
            ? `📥 ${String(fromAddr).slice(0, 16)}… joined ${groupId} (peer-confirmed)`
            : `⚠ rejected join attempt for ${groupId}: ${reply.error}`,
        },
      });
      if (reply.ok && typeof propagateCircleAddresses === 'function') {
        // B2 — the join is the moment per-circle addressing becomes knowable for a member nobody
        // else can address yet. Fire-and-forget for the same reason the intros are: the joiner's
        // membership is already real, and a failed propagation must not turn into a failed join.
        // It only means someone keeps being reached the old way until the next announce.
        propagateCircleAddresses({ circleId: groupId, newMemberWebid: fromAddr })
          .catch((err) => logger.warn?.('[circle-address] post-join propagation failed', err));
      }
      if (reply.ok && typeof propagateMeshIntros === 'function') {
        propagateMeshIntros({
          groupId,
          newPeerAddr:    fromAddr,
          newPeerDisplay: peerDisplay,
          newPeerShared:  !!shareCard,
        }).catch((err) => logger.warn?.('[mesh-intro] propagation failed', err));
      }
    } catch (err) {
      logger.error?.('[peer] group-redeem-response send failed', err);
    }
  };
}

/**
 * THIS device's own per-circle address for `groupId`, together with its proof of possession — or `null`
 * when either seam is missing or the address cannot be signed for.
 *
 * Deny-by-default, and shared by BOTH directions of the redeem so they cannot drift: the JOINER presents
 * it on a fresh join (the request), the ADMIN returns it (the response). Both are the same claim —
 * "this is the address I answer on in this circle, and here is a signature by the key behind it" — and
 * both are verified by the receiver with `verifyCircleLink`. Proving possession of your OWN per-circle
 * address leaks nothing: the address is derived per-circle from a secret profile seed, so it is
 * uncorrelatable with any other circle's.
 *
 * @param {string} groupId
 * @param {{circleAddressFor?: Function, signCircleAddress?: Function}} seams
 * @returns {{circleAddress: string, circleAddressProof: string}|null}
 */
export function ownProvenCircleAddress(groupId, { circleAddressFor, signCircleAddress } = {}) {
  if (typeof circleAddressFor !== 'function' || typeof signCircleAddress !== 'function') return null;
  try {
    const circleAddress = circleAddressFor(groupId);
    const circleAddressProof = circleAddress ? signCircleAddress(groupId, circleAddress) : null;
    return (circleAddress && circleAddressProof) ? { circleAddress, circleAddressProof } : null;
  } catch {
    return null;   // no address available → present none, exactly as before
  }
}

/**
 * JOINER-side outbound: sends a `group-redeem-request` envelope to
 * the admin's peer address + awaits the matching response with a
 * timeout.  Returns a function that the joinGroup wizard can pass
 * as `sendPeerRedeem` to `finalSubmit`.  Mirror of web's
 * `sendGroupRedeemRequest` in `apps/basis/web/main.js:532`.
 *
 * final piece of the cross-instance
 * group-redeem flow on mobile.  The same `pendingMap` is wired into
 * `makeHandleGroupRedeemResponse` so inbound responses resolve the
 * promise.
 *
 * @param {object} args
 * @param {(addr: string, payload: object) => Promise<*>} args.sendPeer
 * @param {() => boolean}                                  [args.isPeerConnected]
 * @param {Map<string, {resolve: Function, reject: Function, timer?: any}>} args.pendingMap
 * @param {(groupId: string) => (string|null)}             [args.circleAddressFor]  identity 5B/C — per-circle address presenter
 * @param {number}                                         [args.timeoutMs=30000]
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(args: {adminPeerAddr: string, groupId: string, code: string, shareCard?: boolean, peerDisplay?: string}) => Promise<{ok?: boolean, codeId?: string, validUntil?: number, error?: string}>}
 */
export function makeSendGroupRedeemRequest({
  sendPeer, isPeerConnected, pendingMap, circleAddressFor, signCircleAddress, timeoutMs = 30_000, logger = console,
} = {}) {
  if (typeof sendPeer !== 'function') {
    throw new Error('makeSendGroupRedeemRequest: sendPeer required');
  }
  if (!pendingMap || typeof pendingMap.set !== 'function') {
    throw new Error('makeSendGroupRedeemRequest: pendingMap required (Map-shaped)');
  }
  const peerUp = () =>
    typeof isPeerConnected !== 'function' ? true : !!isPeerConnected();

  return async function sendGroupRedeemRequest({
    adminPeerAddr, groupId, code, shareCard, peerDisplay, personaProperties,
    circleAddress: presentedCircleAddress, circleAddressProof,
    rulesAccepted,   // task #80 — the version string the joiner accepted, forwarded for the admin-signed join
  }) {
    if (!peerUp()) {
      throw new Error('Peer transport not connected. Try /peer-connect first.');
    }
    // Wave B (SENSITIVE — cross-circle linkability): a presented per-circle address is always PROVEN,
    // never merely asserted — `verifyCircleLink` is proof-of-POSSESSION (a signature by the key behind
    // the address), so an address someone merely SAW cannot be replayed to fake a link.
    //
    // Two cases, both proven:
    //   • "continue as an existing self" — the caller (finalSubmit) presents the address it already uses
    //     in the SOURCE circle plus a proof signed with that circle's key. A deliberate, provable link.
    //   • a FRESH join — present this circle's own freshly-derived address (`circleAddressFor`) signed
    //     with ITS key. This claims nothing about any other circle: the address is derived per-circle from
    //     a secret profile seed, so it is uncorrelatable, and proving possession of your OWN new address
    //     leaks nothing.
    //
    // Wave B briefly dropped the fresh case entirely ("an unproven fresh address would only be dropped"),
    // which left every peer-redeemed member with NO per-circle address on the roster while the circle
    // CREATOR got one — the per-circle identity layer silently degraded to webid for exactly those
    // members. The fix is to PROVE the fresh address, not to omit it. Deny-by-default still holds: an
    // address we cannot sign for is not sent, and the admin drops anything unproven or forged.
    let circleAddress = (typeof presentedCircleAddress === 'string' && presentedCircleAddress)
      ? presentedCircleAddress : null;
    let proof = (typeof circleAddressProof === 'string' && circleAddressProof) ? circleAddressProof : null;
    if (!circleAddress) {
      const own = ownProvenCircleAddress(groupId, { circleAddressFor, signCircleAddress });
      if (own) { circleAddress = own.circleAddress; proof = own.circleAddressProof; }
    }
    const linkArg = (circleAddress && proof) ? { circleAddress, circleAddressProof: proof } : {};
    const requestId = `gr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingMap.delete(requestId);
        reject(new Error('Admin did not respond within 30 s. They may be offline — try again later.'));
      }, timeoutMs);
      pendingMap.set(requestId, { resolve, reject, timer });
    });
    try {
      await sendPeer(adminPeerAddr, {
        type:    'p2p-chat',
        subtype: 'group-redeem-request',
        requestId,
        groupId,
        code,
        ...(shareCard   ? { shareCard: true } : {}),
        ...(peerDisplay ? { peerDisplay }     : {}),
        ...linkArg,
        ...(typeof rulesAccepted === 'string' && rulesAccepted ? { rulesAccepted } : {}),
        // Property layer — the joiner's disclosed persona properties (from finalSubmit), forwarded to the admin.
        ...(personaProperties && Object.keys(personaProperties).length ? { personaProperties } : {}),
        sentAt: Date.now(),
      });
    } catch (err) {
      const entry = pendingMap.get(requestId);
      if (entry) {
        try { clearTimeout(entry.timer); } catch { /* defensive */ }
        pendingMap.delete(requestId);
      }
      logger.warn?.('[group-redeem] send failed', adminPeerAddr, err);
      throw new Error(`Failed to reach admin over NKN: ${err?.message ?? err}`);
    }
    return promise;
  };
}

/**
 * @param {object} args
 * @param {Map<string, {resolve: Function, timer?: any}>} args.pendingMap   the live request-id → entry map
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
export function makeHandleGroupRedeemResponse({
  pendingMap, logger = console,
} = {}) {
  if (!pendingMap || typeof pendingMap.get !== 'function') {
    throw new Error('makeHandleGroupRedeemResponse: pendingMap required (Map-shaped)');
  }
  return function handleGroupRedeemResponse(_fromAddr, payload) {
    const requestId = payload?.requestId;
    const entry = pendingMap.get(requestId);
    if (!entry) {
      logger.warn?.('[peer] group-redeem-response with no pending entry', requestId);
      return;
    }
    if (entry.timer) {
      try { clearTimeout(entry.timer); } catch { /* defensive */ }
    }
    pendingMap.delete(requestId);
    entry.resolve(payload);
  };
}
