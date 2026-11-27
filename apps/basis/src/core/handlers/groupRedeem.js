/**
 * Inbound group-redeem handlers. Bundle H Phase 2 — lifted
 * from `apps/basis/web/main.js:679` + `:789` (fallback
 * over NKN).
 *
 * Two paired flows:
 *
 *   - `makeHandleGroupRedeemRequest` (ADMIN side) — verifies a
 *     joiner's membership code via `pinboard.verifyMembershipCodeForPeer`
 *     + replies with `group-redeem-response`.  On success, hands the
 *     circle the newcomer's proven per-circle address and the newcomer
 *     the circle's (`propagateCircleAddresses`).  The reply also carries the ADMIN's OWN
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

import { inviteRefusalOf } from '../../v2/inviteRefusals.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long a joiner waits for the admin's answer to its redeem; no try of it is made after the wait. */
export const REDEEM_WAIT_MS = param({ key: 'groupRedeem.waitMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });
/** How often, within the wait, a redeem that found no route carrying the joiner's own address is tried again. */
export const REDEEM_RETRY_MS = param({ key: 'groupRedeem.retryMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2_000 });

/** The send path's answer when no transport may carry the send (the secure agent's "not connected"): no route, not a refusal. */
const isNoRouteError = (err) => /Peer transport not connected/i.test(String(err?.message ?? ''));

/**
 * How long the admin waits on its answer to a redeem before it goes on with the admit (the address propagation, the
 * roster step): under the joiner's 30 s wait, so an answer that is stuck is named while the joiner still waits.
 */
export const REDEEM_REPLY_BOUND_MS = param({ key: 'groupRedeem.replyBoundMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20_000 });
/**
 * The admin's own display name IN THIS CIRCLE, read the way every screen reads it: their row on the
 * roster, found by the per-circle address they answer on. No profile store is consulted directly, so this
 * cannot disagree with what the admin's own members list shows. Best-effort — a missing handle is a
 * missing field on the reply, never a failed join.
 */
export async function ownDisplayInCircle(groupId, { callSkill, circleAddressFor } = {}) {
  try {
    const own = typeof circleAddressFor === 'function' ? circleAddressFor(groupId) : null;
    if (!own) return null;
    const r = await callSkill('pinboard', 'listGroupMembers', { groupId });
    const rows = Array.isArray(r?.members) ? r.members : [];
    const me = rows.find((m) => m?.circleAddress === own
      || (Array.isArray(m?.circleAddresses) && m.circleAddresses.includes(own)));
    const h = me?.handle ?? me?.displayName ?? null;
    return typeof h === 'string' && h.trim() ? h.trim() : null;
  } catch { return null; }
}

export function makeHandleGroupRedeemRequest({
  ownDisplayFor = null,
  callSkill, sendPeer, propagateCircleAddresses, publishEvent,
  circleAddressFor, signCircleAddress, logger = console,
  // After a member is ADMITTED: the pair roster promotes its co-member to admin (`pairRoster.js`); best-effort.
  onAdmitted = null,
  // The sender's CANONICAL key (the device-local identity link: a per-circle address → the person's chat key). A code
  // bound to one person is checked against this, resolved here from the verified sender — never read from the body.
  identityOf = null,
  // The agent's invite-exchange registrations (`agent.inviteExchange`): the one reply to a well-formed request (its answer
  // when it proved its code, else its refusal) may go back on the person key (the send gate's person-key allowlist).
  inviteExchange = null,
  replyBoundMs = REDEEM_REPLY_BOUND_MS,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleGroupRedeemRequest: callSkill required');
  if (typeof sendPeer  !== 'function') throw new Error('makeHandleGroupRedeemRequest: sendPeer required');

  return async function handleGroupRedeemRequest(fromAddr, payload) {
    const { requestId, groupId, code, shareCard, peerDisplay, circleAddress, circleAddressProof, personaProperties, rulesAccepted, personKey, profileKind, podWebId } = payload ?? {};
    if (!requestId || !groupId || !code) {
      logger.warn?.('[peer] group-redeem-request missing fields', payload);
      return;
    }
    let reply;
    try {
      const result = await callSkill('pinboard', 'verifyMembershipCodeForPeer', {
        groupId, code,
        requesterWebid: fromAddr,
        requesterKey: (typeof identityOf === 'function' ? identityOf(fromAddr) : null) || fromAddr,
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
        // The joiner's FIRST person key (2026-09-16), forwarded verbatim onto the admin-signed join like the acceptance.
        ...(personKey && typeof personKey === 'object' ? { personKey } : {}),
        // The joiner's own profile kind: it counts only on a code the admin minted for a bot — the admin decides.
        ...(profileKind === 'function' ? { profileKind: 'function' } : {}),
        // Property layer — the joiner's disclosed persona properties, forwarded to the admin's roster.
        ...(personaProperties && Object.keys(personaProperties).length ? { personaProperties } : {}),
        // The pod WebID the joiner signs in with, for a pod-backed circle's read grant. The skill hands it to the
        // grant only; it is not written into the redemption, the roster or the join statement.
        ...(typeof podWebId === 'string' && podWebId ? { podWebId } : {}),
      });
      // a device holding no code for this circle is not where the invite lives: silence, so the sibling that holds the
      // code answers (the joiner takes the first reply; this one would have overtaken it)
      if (result?.error === 'no-code-here') { logger.info?.(`[group-redeem] no code for ${String(groupId).slice(0, 12)}… on this device: left to the device that holds it`); return; }
      if (result?.error) {
        // a CODE from the closed set crosses the wire, never the substrate's own text (inviteRefusals.js)
        reply = { error: inviteRefusalOf(result.error) };
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
        // (The general refresh path is the per-circle address announce — "re-announce" — not this reply.)
        const own = ownProvenCircleAddress(groupId, { circleAddressFor, signCircleAddress });
        if (own) Object.assign(reply, own);
        // …and the admin's display rides back beside their address (W10): the joiner's roster then
        // names the person who admitted them instead of showing a key. Self-asserted, like the handle
        // the joiner sent the other way; a receiver that already holds a handle for us keeps its own.
        const display = typeof ownDisplayFor === 'function'
          ? await ownDisplayFor(groupId)
          : await ownDisplayInCircle(groupId, { callSkill, circleAddressFor });
        if (typeof display === 'string' && display) reply.confirmedByDisplay = display;
        // …and the join this admin just signed for them: a joiner who left no longer hears the circle's fan, so the
        // statement that lets its own fold count it in again rides back with the answer (the joiner's rail verifies it).
        if (result.joinStatement?.body && result.joinStatement?.sig) reply.joinStatement = result.joinStatement;
      }
    } catch (err) {
      // the exception stays on this device (its text can carry internals); the joiner hears the catch-all code
      logger.warn?.('[group-redeem] the admitting step threw', err?.message ?? err);
      reply = { error: 'join-refused' };
    }
    try {
      // the one reply on the person key: the answer when the request proved its code, else the refusal (the request was
      // well-formed: garbage is turned away above and earns nothing)
      try {
        if (reply.ok) inviteExchange?.answerProvenRequest?.(fromAddr);
        else inviteExchange?.refuseParsedRequest?.(fromAddr);
      } catch { /* the gate then records 'none' */ }
      // The answer is bounded and never silent: a send that does not settle, or settles undelivered, is named, and the
      // admit's own steps below go on either way (the membership is already real).
      const who = String(fromAddr).slice(0, 16);
      let bound = null;
      // the send's own failure is caught on the send itself: when the bound wins, a later rejection is still a line,
      // never an unhandled rejection (on the box that is node's unhandledRejection)
      const answer = Promise.resolve(sendPeer(fromAddr, {
        type:    'p2p-chat',
        subtype: 'group-redeem-response',
        requestId,
        ...reply,
        sentAt:  Date.now(),
      })).catch((err) => {
        logger.warn?.(`[group-redeem] the answer to ${who}… failed: ${err?.message ?? err}`);
        return { failed: true };
      });
      const sent = await Promise.race([
        answer,
        new Promise((resolve) => { bound = setTimeout(() => resolve({ stuck: true }), replyBoundMs); }),
      ]).finally(() => clearTimeout(bound));
      if (sent?.stuck) logger.warn?.(`[group-redeem] the answer to ${who}… did not settle within ${Math.round(replyBoundMs / 1000)} s`);
      else if (sent && typeof sent === 'object' && sent.delivered === false) logger.warn?.(`[group-redeem] the answer to ${who}… was not delivered: ${sent.reason ?? (sent.held ? 'held' : 'unknown')}`);
      publishEvent?.({
        app: 'pinboard', type: 'notification',
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
      if (reply.ok && typeof onAdmitted === 'function') {
        Promise.resolve(onAdmitted({ circleId: groupId, newMemberWebid: fromAddr }))
          .catch((err) => logger.warn?.('[pair-roster] post-admit step failed', err?.message ?? err));
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
  currentPersonKey = null,   // () => { version, pubKey } | null — this device's person key, announced on the join
  // (groupId) => { webid, sendAs, personKey } | null — WHO joins this circle: the persona it is being joined as. A
  // persona's redeem leaves AS that persona (its own socket) and announces ITS person key; the default's is unchanged.
  circleSelfFor = null,
  // () => 'person'|'function' (or a promise of it) — this node's profile kind. A function profile (a bot's node) says
  // so on the redeem; the admin writes it into the signed join only for an invite it minted FOR a bot.
  profileKind = null,
  // () => string|null — the WebID this device's pod session signs in as. Sent only on a redeem for a pod-backed
  // circle, and only to the admin the request goes to: their pod's read grant has to name it.
  podWebId = null,
  sendPeer, isPeerConnected, pendingMap, circleAddressFor, signCircleAddress, timeoutMs = REDEEM_WAIT_MS, logger = console,
  retryMs = REDEEM_RETRY_MS,
  // The agent's invite-exchange registrations (`agent.inviteExchange`): the request to the invite's address may leave on
  // the person key for this redeem's lifetime (the send gate's person-key allowlist), released on answer/timeout/error.
  inviteExchange = null,
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
    // The relay the invite names (2026-09-08). A device is on its own relay AND the ones its circles ride;
    // before the join the circle has no recorded point, so without this the redeem left over the device's
    // own relay — where the admin is not — and waited out the full timeout. Scoping it to the invite's
    // relay is what the join dial (which now comes BESIDE the primary, not instead of it) was for.
    relayUrl,
    podBacked = false,   // the invite says the circle keeps its data in a pod
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
    let self = null;
    try { self = typeof circleSelfFor === 'function' ? (circleSelfFor(groupId) ?? null) : null; } catch { self = null; }
    const asPersona = typeof self?.sendAs === 'string' && self.sendAs ? self.sendAs : null;
    let ownKey = null;
    if (asPersona) ownKey = self.personKey ?? null;
    else {
      try { ownKey = typeof currentPersonKey === 'function' ? (currentPersonKey() ?? null) : null; } catch { ownKey = null; }
    }
    let kind = null;
    try { kind = typeof profileKind === 'function' ? await profileKind() : null; } catch { kind = null; }
    let ownPodWebId = null;
    if (podBacked === true && typeof podWebId === 'function') {
      try { const w = await podWebId(); ownPodWebId = (typeof w === 'string' && /^https?:\/\//.test(w)) ? w : null; } catch { ownPodWebId = null; }
    }
    const requestId = `gr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let release = () => {};
    try { release = inviteExchange?.expectFromInviter?.(adminPeerAddr) ?? release; } catch { /* the gate then records 'none' */ }
    // THE REDEEM NEVER OUTLIVES THE JOINER'S WAIT. It is sent `now`, never held by the agent (a held redeem flushed a
    // minute later would admit a joiner whose screen already said it failed); with no route that carries this self's
    // address yet, the joiner tries again itself, within the wait, and stops when the wait does.
    let noOwnRoute = false;   // the last try found no route that carries this self's address
    let over = false;         // answered, refused or timed out: no further try
    const who = String(adminPeerAddr).slice(0, 16);
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        over = true;
        pendingMap.delete(requestId);
        if (noOwnRoute) {
          logger.warn?.(`[group-redeem] no route that carries this self's address to ${who}… within the wait: the redeem never left`);
          reject(Object.assign(new Error('no-own-route'), { reason: 'no-own-route' }));
          return;
        }
        reject(new Error(`Admin did not respond within ${Math.round(timeoutMs / 1000)} s. They may be offline — try again later.`));
      }, timeoutMs);
      pendingMap.set(requestId, { resolve, reject, timer });
    });
    // the exchange is open while the redeem is: its answer, its timeout and its error all close it
    promise.then(release, release);
    promise.then(() => { over = true; }, () => { over = true; });
    try {
      const request = {
        type:    'p2p-chat',
        subtype: 'group-redeem-request',
        requestId,
        groupId,
        code,
        ...(shareCard   ? { shareCard: true } : {}),
        ...(peerDisplay ? { peerDisplay }     : {}),
        ...linkArg,
        ...(typeof rulesAccepted === 'string' && rulesAccepted ? { rulesAccepted } : {}),
        // This device's FIRST person key, for the admin-signed join (the self-join path announces it itself).
        ...(ownKey ? { personKey: ownKey } : {}),
        ...(kind === 'function' ? { profileKind: 'function' } : {}),
        // Property layer — the joiner's disclosed persona properties (from finalSubmit), forwarded to the admin.
        ...(personaProperties && Object.keys(personaProperties).length ? { personaProperties } : {}),
        ...(ownPodWebId ? { podWebId: ownPodWebId } : {}),
        sentAt: Date.now(),
      };
      const as = asPersona ? { sendAs: asPersona } : {};
      // A redeem leaves AS the self that joins, or not at all: only over a route that carries that address. A route
      // that cannot (NKN: its sender is its own native address) would make the admin admit an address of this device
      // that nobody can reach, and its answer would go nowhere. No such route now → not sent, tried again below.
      const points = typeof relayUrl === 'string' && relayUrl ? { points: [relayUrl] } : {};
      const sendOpts = { guarantee: 'now', scope: { ...points, requireAliasCapable: true }, ...as };
      // one try: true when the request left; false when it did not leave (tried again within the wait), and
      // `noOwnRoute` says whether that was for want of a route carrying this self's address; a thrown failure other
      // than "no route" throws, as a send failure always did
      const attempt = async () => {
        try {
          const sent = await sendPeer(adminPeerAddr, request, sendOpts);
          const notSent = !!sent && typeof sent === 'object' && (sent.held === true || sent.delivered === false);
          noOwnRoute = notSent && sent.reason === 'no-eligible-route';
          return !notSent;
        } catch (err) {
          // no route now: tried again within the wait. The send path says WHICH (`scopedOut`): the admin is reachable,
          // but only over a route that cannot carry this self's address (no-own-route), or not reachable at all (it
          // ends as "no admin online")
          if (isNoRouteError(err)) { noOwnRoute = err?.scopedOut === true; return false; }
          throw err;
        }
      };
      if (!(await attempt())) {
        logger.warn?.(`[group-redeem] no route that carries this self's address to ${who}… yet: trying again within the wait`);
        (async () => {
          while (!over) {
            await new Promise((r) => setTimeout(r, retryMs));
            if (over) return;
            try { if (await attempt()) return; } catch (err) { logger.warn?.(`[group-redeem] a later try to ${who}… failed: ${err?.message ?? err}`); }
          }
        })();
      }
    } catch (err) {
      const entry = pendingMap.get(requestId);
      if (entry) {
        try { clearTimeout(entry.timer); } catch { /* defensive */ }
        pendingMap.delete(requestId);
      }
      release();
      logger.warn?.('[group-redeem] send failed', adminPeerAddr, err);
      throw new Error(`Failed to reach admin: ${err?.message ?? err}`);
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
    // the reply's VERIFIED sender rides along: a reply is matched by its request id alone, so what it says about the
    // admin (their per-circle address and its proof) is taken only when the admin sent it (joinGroupState)
    entry.resolve({ ...payload, repliedBy: typeof _fromAddr === 'string' && _fromAddr ? _fromAddr : null });
  };
}
