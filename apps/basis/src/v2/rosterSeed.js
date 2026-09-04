/**
 * ROSTER SEED — a pod-less enrolled device gets its circle rosters from its OWN sibling
 * (PLAN-podless-enroll-completeness S1, closing [L32]).
 *
 * The circularity this breaks: a freshly enrolled device holds no membership-redemption trail,
 * `projectCircleRoster` returns null without one, and the rails' binding verifiers need roster
 * rows before any foreign statement may land — so the statements that could rebuild the roster
 * are refused for want of the roster. Circle trust cannot bootstrap itself here; DEVICE-SET trust
 * can: a person's own sibling device is exactly as trustworthy as their own device — that is what
 * enrollment means — so the sibling serves its trail rows as a SIGNED SEED, and everything folds
 * on top through the standing, unchanged gates.
 *
 *   new device                                  sibling (same person)
 *   ──────────                                  ─────────────────────
 *   signed seed REQUEST (device key + record) ─▶ verify: device-set (floor | record chain | tombstone)
 *                                               package OWN membership-redemption rows for the circle
 *              ◀── signed seed PARCEL ────────── sign with the device key, carry the record
 *   verify: device-set, same gate
 *   ingest rows ID-PRESERVED (first-write-wins) — join statements' `redemptionRef` stays intact
 *   → the standing projection + causal fold now run; fanned statements bind and fold ON TOP
 *
 * What this does NOT change: no fold rule, no binding rule, no admission gate. The seed only
 * supplies the trail HEAD the projection was always designed to fold deltas onto ("head +
 * fold(deltas)") — carried by a delegation-verified sibling instead of restored from a pod. A
 * request or parcel signed by anyone outside the device set is refused without reply; addresses
 * still prove themselves at the roster; deny-wins rules are untouched.
 *
 * Replay posture: both request and parcel are signed over a body that NAMES the reply address
 * (`replyTo`), so a replayed request can only re-serve the seed to the original legitimate
 * device — a captured offer or request hands an attacker nothing (the same posture as the enroll
 * offer itself). The parcel is idempotent at ingest (first-write-wins by item id).
 */
import { canonicalize, AgentIdentity, b64encode } from '@onderling/core';
import { CIRCLE_ADDRESS_ANNOUNCE_KIND } from './circleAddressAnnounce.js';

export const ROSTER_SEED_SUBTYPES = Object.freeze({
  request: 'roster-seed-request',
  batch:   'roster-seed-batch',
});

/** Self-describing signed-body version (docs/conventions/signed-bodies.md). */
export const ROSTER_SEED_VERSION = 'onderling/roster-seed.v1';

const sign = (identity, body) => b64encode(identity.sign(canonicalize(body)));
const verifySig = (body, sig, by) => {
  try { return AgentIdentity.verify(canonicalize(body), sig, by); } catch { return false; }
};

/**
 * The new device's signed request: "I am a device of this profile — seed me `circleId`."
 * @param {object} a
 * @param {{identity: object}} a.signer          the device signer (the grants-lane identity)
 * @param {object|null} [a.delegationRecord]     carried so the sibling verifies the chain registry-free
 * @param {string} a.circleId
 * @param {string} a.replyTo                     where the parcel must be sent (signed into the body)
 */
export async function buildRosterSeedRequest({ signer, delegationRecord = null, circleId, replyTo } = {}) {
  const identity = (await signer)?.identity ?? (await signer);
  if (!identity?.pubKey || typeof identity.sign !== 'function') return null;
  if (typeof circleId !== 'string' || !circleId || typeof replyTo !== 'string' || !replyTo) return null;
  const body = { v: ROSTER_SEED_VERSION, kind: 'request', circleId, replyTo, at: Date.now() };
  return {
    subtype: ROSTER_SEED_SUBTYPES.request,
    circleId,
    body,
    sig: sign(identity, body),
    by: identity.pubKey,
    ...(delegationRecord ? { delegation: delegationRecord } : {}),
  };
}

/**
 * The sibling's serve half: verify the requester is a device of THIS profile, package own
 * membership-redemption rows for the circle, reply with the signed parcel. Refusals are silent
 * (a stranger learns nothing, not even that this device serves seeds).
 *
 * @param {object} a
 * @param {Function} a.callSkill
 * @param {Promise<{identity:object}>|{identity:object}} a.signerPromise  the device signer
 * @param {object|null} [a.delegationRecord]
 * @param {(q:{author:string, ref:string, payload:?object}) => Promise<boolean>|boolean} a.verifyDeviceSet
 *   the grants lane's `deviceSetBindingVerifier` instance — ONE trust base, not a second one
 * @param {string} a.selfPubKey   the profile's chat pubKey (the device set's ref)
 * @param {(to:string, payload:object) => Promise<*>|*} a.sendToPeer
 * @param {(circleId:string) => (object|null)} [a.ownAnnouncement]
 *   THIS device's own circle-address announcement ({circleId, memberWebid, circleAddress,
 *   circleAddressProof}) — sent back alongside the parcel; see the introduce-back note below.
 */
export function makeRosterSeedServer({ callSkill, signerPromise, delegationRecord = null, verifyDeviceSet, selfPubKey, sendToPeer, ownAnnouncement = null } = {}) {
  return async function onRosterSeedRequest(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== ROSTER_SEED_SUBTYPES.request) return;
    const { body, sig, by } = payload;
    if (!body || typeof body !== 'object' || typeof sig !== 'string' || typeof by !== 'string') return;
    if (body.v !== ROSTER_SEED_VERSION || body.kind !== 'request') return;
    if (typeof body.circleId !== 'string' || !body.circleId) return;
    if (typeof body.replyTo !== 'string' || !body.replyTo) return;
    if (!verifySig(body, sig, by)) return;
    try {
      if (!(await verifyDeviceSet({ author: by, ref: selfPubKey, payload: { delegation: payload.delegation ?? null } }))) return;
    } catch { return; }
    try {
      const all = await callSkill('stoop', 'listOpen', { type: 'membership-redemption' });
      const items = Array.isArray(all?.items) ? all.items : (Array.isArray(all) ? all : []);
      const rows = items.filter((it) => it?.source?.groupId === body.circleId);
      if (rows.length === 0) return;   // nothing to seed — silence, not an empty parcel
      // The MEMBER rows too — the trail alone cannot carry a circle's FOUNDER (a creator never
      // redeems), so the sibling's DERIVED roster rides along as display+authority facts for the
      // receiver's member map (the same back-compat source the founder derivation already reads).
      let memberRows = [];
      try {
        const r = await callSkill('stoop', 'listGroupMembers', { groupId: body.circleId });
        memberRows = (Array.isArray(r?.members) ? r.members : [])
          .filter((m) => m && typeof m.webid === 'string' && m.webid)
          .map((m) => ({
            webid: m.webid,
            ...(typeof m.handle === 'string' && m.handle ? { handle: m.handle } : {}),
            ...(typeof m.displayName === 'string' && m.displayName ? { displayName: m.displayName } : {}),
            ...(typeof m.role === 'string' && m.role ? { role: m.role } : {}),
            ...(typeof m.pubKey === 'string' && m.pubKey ? { pubKey: m.pubKey } : {}),
            ...(typeof m.circleAddress === 'string' && m.circleAddress ? { circleAddress: m.circleAddress } : {}),
            ...(Array.isArray(m.circleAddresses) && m.circleAddresses.length ? { circleAddresses: m.circleAddresses } : {}),
            ...(typeof m.ceremonyAddress === 'string' && m.ceremonyAddress ? { ceremonyAddress: m.ceremonyAddress } : {}),
            ...(typeof m.ceremonyCommitment === 'string' && m.ceremonyCommitment ? { ceremonyCommitment: m.ceremonyCommitment } : {}),
          }));
      } catch { memberRows = []; }
      const identity = (await signerPromise)?.identity ?? (await signerPromise);
      if (!identity?.pubKey) return;
      const parcelBody = { v: ROSTER_SEED_VERSION, kind: 'seed', circleId: body.circleId, replyTo: body.replyTo, rows, members: memberRows, at: Date.now() };
      await sendToPeer(body.replyTo, {
        subtype: ROSTER_SEED_SUBTYPES.batch,
        circleId: body.circleId,
        body: parcelBody,
        sig: sign(identity, parcelBody),
        by: identity.pubKey,
        ...(delegationRecord ? { delegation: delegationRecord } : {}),
      });
      // INTRODUCE THIS DEVICE BACK. A device never records its OWN per-circle address into the
      // shared person-row — siblings learn it by ANNOUNCE, and this device announced long before
      // the requester existed. Without this, the fresh device holds the person's row addressless
      // and refuses every task/chat statement this device signs as unbindable (found live
      // 2026-08-21). Same production door as any announce: the proof re-verifies at the ingest.
      if (typeof ownAnnouncement === 'function') {
        try {
          const mine = await ownAnnouncement(body.circleId);
          if (mine) {
            await sendToPeer(body.replyTo, {
              type: 'p2p-chat', subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND, circleId: body.circleId,
              msgId: `roster-seed-announce-${body.circleId}`, ts: Date.now(), announcements: [mine],
            });
          }
        } catch { /* the announce also rides this device's next boot re-announce */ }
      }
      // (The 2026-08-21 key-chain REPLAY that briefly lived here is RETIRED: key events are now
      // signed statements on the key LANE, and the enrolled device pulls that lane through the
      // standing catch-up exactly like membership and governance — one route, no side-channel.)
    } catch { /* serving is best-effort — the requester retries on its next boot */ }
  };
}

/**
 * The new device's receive half: verify the parcel came from a device of THIS profile, then land
 * the rows id-preserved through the store's ingest door (first-write-wins — the parcel is
 * idempotent, and nothing can overwrite a row already held).
 *
 * @param {object} a
 * @param {Function} a.callSkill
 * @param {Function} a.verifyDeviceSet   the same verifier instance as the serve half
 * @param {string} a.selfPubKey
 * @param {(circleId:string, result:object) => void} [a.onApplied]
 */
export function makeRosterSeedReceiver({ callSkill, verifyDeviceSet, selfPubKey, onApplied = null } = {}) {
  return async function onRosterSeedBatch(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== ROSTER_SEED_SUBTYPES.batch) return;
    const { body, sig, by } = payload;
    if (!body || typeof body !== 'object' || typeof sig !== 'string' || typeof by !== 'string') return;
    if (body.v !== ROSTER_SEED_VERSION || body.kind !== 'seed') return;
    if (typeof body.circleId !== 'string' || !body.circleId || !Array.isArray(body.rows)) return;
    if (!verifySig(body, sig, by)) return;
    try {
      if (!(await verifyDeviceSet({ author: by, ref: selfPubKey, payload: { delegation: payload.delegation ?? null } }))) return;
    } catch { return; }
    try {
      const r = await callSkill('stoop', 'recordRosterSeed', {
        groupId: body.circleId, rows: body.rows,
        ...(Array.isArray(body.members) ? { members: body.members } : {}),
      });
      if (typeof onApplied === 'function') { try { onApplied(body.circleId, r); } catch { /* observer only */ } }
    } catch { /* ingest is best-effort — the next boot's request retries */ }
  };
}
