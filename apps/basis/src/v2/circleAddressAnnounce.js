/**
 * basis v2 — announcing the address you answer on in a circle, and recording someone else's (B2).
 *
 * ── The hole ────────────────────────────────────────────────────────────────────────────────────
 * Per-circle addressing gives every member a different address in every circle. Two devices learn
 * each other's from a JOIN: the joiner proves its address to the admin, and the admin's proven
 * address rides back on the redeem response (2026-07-30). Nothing ever taught two JOINERS each
 * other's. So a circle of three worked between the admin and everyone and, between the two joiners,
 * either fell back to their one global signing key (the linkability leak per-circle addressing
 * exists to close) or — with the per-user fallback off — was refused outright. Both failure modes
 * read to a person as "messages sometimes don't arrive".
 *
 * ── The shape ───────────────────────────────────────────────────────────────────────────────────
 * One self-verifying record (`@onderling/core` `circleAddressAnnouncement`), three moments, one
 * wire kind:
 *
 *   • `announceOwnCircleAddress`      — I tell the circle where to reach me. This is the
 *                                        re-announce: same operation for a first announcement, a
 *                                        changed address, and (later) a key handover.
 *   • `propagateCircleAddressesAfterJoin` — the ADMIN, who is the only party that can reach both
 *                                        sides at that moment, tells the circle about the newcomer
 *                                        and the newcomer about the circle.
 *   • `makeCircleAddressAnnouncePeerHandler` — the receive half.
 *
 * Carrying is not vouching: every announcement is verified against the key behind the address it
 * names, by the RECEIVER, deny-by-default. An admin who alters one invalidates it.
 *
 * ── The part that is easy to get subtly wrong ───────────────────────────────────────────────────
 * Since boundary-authentication decision 1, an inbound envelope is verified against the key it
 * CARRIES and then AUTHORIZED against a roster snapshot; a key no roster vouches for is refused.
 * So recording a new address without refreshing that snapshot produces a member who is reachable
 * and then rejected — a failure that appears *after* appearing to work, which is worse than the one
 * being fixed. `bindCircleAddressKeysFor` does both halves from ONE read of ONE source
 * (`registerPeerAddress` + `recordCircleSenders`), and this module calls exactly that, once, after
 * recording. There is deliberately no second read here.
 */

import {
  CIRCLE_ADDRESS_ANNOUNCE_KIND,
  circleAddressAnnouncement,
  ownCircleAddressAnnouncement,
  verifyCircleAddressAnnouncements,
} from '@onderling/core';

import { bindCircleAddressKeysFor } from './householdRosterPairing.js';

export { CIRCLE_ADDRESS_ANNOUNCE_KIND };

/**
 * This device's own member id in a circle — the canonical chat signing key, which a basis circle
 * binds as the member's `webid`. One place, because three call sites below need it and each shell
 * exposes the agent slightly differently.
 *
 * @param {object} agent
 * @returns {string|null}
 */
export function selfWebidOf(agent) {
  return agent?.identity?.chat?.pubKey
    ?? agent?.identity?.pubKey
    ?? agent?.peer?.address
    ?? null;
}

/**
 * Project a circle roster into the announcements it can prove — the admin's relay payload.
 *
 * A row with an address but no proof is SKIPPED rather than sent unproven: it would be dropped by
 * every receiver anyway, and sending it would make a failure look like a delivery. Rows predating
 * 2026-08-02 carry no proof, so an admin that has not re-read them relays fewer members than it
 * knows — visible as members still using the fallback, which is exactly the signal that reads right.
 *
 * @param {object} a
 * @param {Array<object>} a.members   roster rows (`stoop listGroupMembers`)
 * @param {string} a.circleId
 * @param {string|null} [a.exceptWebid]  omit one member (the person we are sending TO)
 * @returns {Array<{circleId, memberWebid, circleAddress, circleAddressProof}>}
 */
export function announcementsFromRoster({ members, circleId, exceptWebid = null } = {}) {
  const out = [];
  for (const m of Array.isArray(members) ? members : []) {
    const memberWebid = typeof m?.webid === 'string' ? m.webid : null;
    if (!memberWebid || memberWebid === exceptWebid) continue;
    if (typeof m?.circleAddress !== 'string' || !m.circleAddress) continue;
    if (typeof m?.circleAddressProof !== 'string' || !m.circleAddressProof) continue;
    out.push(circleAddressAnnouncement({
      circleId,
      memberWebid,
      circleAddress:      m.circleAddress,
      circleAddressProof: m.circleAddressProof,
      // The member's per-circle RELEASE rides along, completing the roster projection: the row this
      // reads from holds only what the member disclosed to THIS circle, so a member who released
      // nothing carries nothing. `circleAddressAnnouncement` drops an empty/junk value at the boundary.
      personaProperties:  m.personaProperties,
    }));
  }
  return out;
}

/** Mint THIS device's announcement for a circle, or `null` when it cannot prove an address. */
export function ownAnnouncementFor({ agent, circleId } = {}) {
  return ownCircleAddressAnnouncement({
    circleId,
    memberWebid:       selfWebidOf(agent),
    circleAddressFor:  (cid) => agent?.circleAddressFor?.(cid) ?? null,
    // The same signature the join and the redeem response already carry: signed by the key behind
    // the address, over a challenge bound to this circle (`signCircleLink`). No new primitive.
    signCircleAddress: (cid, address) => agent?.signCircleLink?.(cid, cid, address) ?? null,
  });
}

/**
 * ANNOUNCE (and re-announce): tell the circle which address I answer on, and record it on my own
 * roster row so the claim and my own view of it agree.
 *
 * Recording locally is not bookkeeping — it is what makes this quiet. The trigger below fires when
 * my row disagrees with the address I derive; without writing my own row, that disagreement would
 * be permanent and every boot would re-announce.
 *
 * @param {object} a
 * @param {object} a.agent
 * @param {string} a.circleId
 * @param {{warn?: Function, info?: Function}} [a.logger]
 * @returns {Promise<{announced: boolean, sent: number, reason?: string}>}
 */
export async function announceOwnCircleAddress({ agent, circleId, logger = console } = {}) {
  if (!agent || typeof agent.callSkill !== 'function' || !circleId) {
    return { announced: false, sent: 0, reason: 'no-agent' };
  }
  const announcement = ownAnnouncementFor({ agent, circleId });
  if (!announcement) return { announced: false, sent: 0, reason: 'no-provable-address' };

  let sent = 0;
  let reached = false;
  try {
    const res = await agent.callSkill('stoop', 'broadcastCircleAddresses', {
      groupId: circleId, announcements: [announcement],
    });
    sent = Number(res?.sent) || 0;
    // "Nobody was left out" — including the circle-of-one case, where there was nobody to tell.
    // A hold-forwarded send counts as reached: it is queued, not lost.
    //
    // ⚠ 2026-08-02 — READ THIS BEFORE TRUSTING `reached`. It is a SEND-side signal. The fan reports what
    // it handed to the transport; it cannot see the recipient REFUSING the envelope, and since per-circle
    // signing became enforced there is a refusal that hits exactly this path: an announcement sent before
    // our alias is bound goes out signed by the canonical key and is refused as
    // `a-members-canonical-key-where-they-sign-per-circle`. The fan still says "sent, no errors".
    //
    // So `reached` means "nothing failed locally", NOT "the circle knows me" — and it must never again be
    // used to decide that we are done announcing. See the trigger below.
    reached = !res?.error && (Array.isArray(res?.errors) ? res.errors.length === 0 : true);
  } catch (err) {
    logger?.warn?.('[circle-address] announce fan-out failed', err?.message ?? err);
  }

  // Then mine, locally — but ONLY if the fan left nobody out.
  //
  // The order is the point. Recording my own row is what makes the boot trigger quiet next time, and
  // it is also what lets me relay my own address to a member who joins later. Recording it after a
  // fan that failed would do both of those on the strength of an announcement nobody received: the
  // trigger would go silent for good and the circle would never learn where I am. So a failed fan
  // leaves the row alone, and the next boot tries again.
  if (reached) {
    try {
      await agent.callSkill('stoop', 'recordCircleAddressAnnouncement', {
        groupId:            circleId,
        memberWebid:        announcement.memberWebid,
        circleAddress:      announcement.circleAddress,
        circleAddressProof: announcement.circleAddressProof,
      });
    } catch (err) {
      logger?.warn?.('[circle-address] recording my own address failed', err?.message ?? err);
    }
  }
  return { announced: true, sent, reached };
}

/**
 * The general TRIGGER: announce only when the circle's own roster does not already say where I am.
 *
 * "Where a member's per-circle address becomes known or changes" turns out to be one question the
 * roster can answer: does my row carry the address I derive, with a proof? A fresh joiner's own row
 * carries none (the joiner-side mirror records the ADMIN's address, not their own), a founder's row
 * carries none (founders never redeem), and a device whose derivation changed carries the old one.
 * All three want the same announcement, and every other boot wants silence.
 *
 * `members` is passed in by the caller that just read the roster (`primeCircleSecurity`, via
 * `bindCircleAddressKeysFor`) so this costs no extra read. Absent → it reads for itself.
 *
 * @param {object} a
 * @param {object} a.agent
 * @param {string} a.circleId
 * @param {Array<object>|null} [a.members]  the roster rows, when the caller already has them
 * @param {(msg: string, err?: any) => void} [a.onWarn]
 * @returns {Promise<{announced: boolean, sent?: number, reason?: string}>}
 */
/**
 * Circles we have already announced ourselves in during THIS process.
 *
 * Deliberately in memory and deliberately not persisted: its whole job is to be forgotten on restart, so
 * every boot re-announces once and a refusal can never become permanent.
 */
const announcedThisBoot = new Set();

export async function announceOwnCircleAddressIfChanged({
  agent, circleId, members = null, onWarn = null,
} = {}) {
  const logger = { warn: (msg, err) => (typeof onWarn === 'function' ? onWarn(msg, err) : console.warn(msg, err)) };
  if (!agent || typeof agent.callSkill !== 'function' || !circleId) {
    return { announced: false, reason: 'no-agent' };
  }
  const mine = ownAnnouncementFor({ agent, circleId });
  if (!mine) return { announced: false, reason: 'no-provable-address' };

  let rows = Array.isArray(members) ? members : null;
  if (!rows) {
    try {
      const res = await agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
      rows = Array.isArray(res?.members) ? res.members : [];
    } catch { return { announced: false, reason: 'roster-unreadable' }; }
  }
  const myRow = rows.find((m) => m?.webid === mine.memberWebid) ?? null;
  // Both halves have to be there: an address with no proof cannot be relayed on, so a row in that
  // state is not yet "known" for the purpose this exists to serve.
  const rowIsCurrent = myRow?.circleAddress === mine.circleAddress
    && typeof myRow?.circleAddressProof === 'string' && !!myRow.circleAddressProof;

  // ⚠ Our own row is NOT evidence that anyone else heard us.
  //
  // It used to be treated as exactly that: `announceOwnCircleAddress` recorded our row locally whenever
  // the fan reported no errors, and this check then read that row back and stayed silent forever. The
  // three-party run (2026-08-02) measured the consequence — a joiner's announcement was refused by every
  // recipient, the joiner recorded success anyway, and never announced again. The circle only worked
  // because the ADMIN teaches both sides separately; the joiner's own announcement contributed nothing.
  //
  // So: announce ONCE PER BOOT per circle regardless of the row, and let the row suppress only the
  // repeats within a boot. Announcing is idempotent (deny-by-default verification, patched in place) and
  // costs one small fan; a silent-forever failure costs a member nobody can address. Anything stronger
  // needs a RECEIPT for the announcement, which does not exist — and inventing an optimistic stand-in
  // for one is the bug this replaces.
  if (rowIsCurrent && announcedThisBoot.has(`${circleId}\u0000${mine.memberWebid}`)) {
    return { announced: false, reason: 'unchanged' };
  }
  announcedThisBoot.add(`${circleId}\u0000${mine.memberWebid}`);
  return announceOwnCircleAddress({ agent, circleId, logger });
}

/**
 * ADMIN, right after a successful join: close the addressing loop in BOTH directions.
 *
 * This is the half that a member cannot do for themselves. A fresh joiner holds an address for the
 * admin and for nobody else, and the existing members hold none for the joiner — so neither side can
 * send the other an announcement. The admin can reach both, and (because announcements carry their
 * own proofs) can hand each side the other's without being trusted about either.
 *
 * Binds first: the admin has just written the joiner's proven address onto its own roster, but
 * nothing has bound it in the security layer yet, so a send to it would throw `No pubKey registered`
 * above the transport and hold. One read, both halves — see the module note.
 *
 * @param {object} a
 * @param {object} a.agent
 * @param {string} a.circleId
 * @param {string} a.newMemberWebid
 * @param {{warn?: Function, info?: Function}} [a.logger]
 * @returns {Promise<{toCircle: number, toNewMember: number, announced: number}>}
 */
export async function propagateCircleAddressesAfterJoin({
  agent, circleId, newMemberWebid, logger = console,
} = {}) {
  const out = { toCircle: 0, toNewMember: 0, announced: 0 };
  if (!agent || typeof agent.callSkill !== 'function' || !circleId || !newMemberWebid) return out;

  // The joiner's row is fresh; bind it (and refresh who may speak) before sending anything to it.
  try { await bindCircleAddressKeysFor({ agent, circleId }); }
  catch { /* best-effort — the fan below still tries */ }

  let members = [];
  try {
    const res = await agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
    members = Array.isArray(res?.members) ? res.members : [];
  } catch (err) {
    logger?.warn?.('[circle-address] roster read failed after join', err?.message ?? err);
    return out;
  }

  const newcomer = announcementsFromRoster({ members, circleId })
    .filter((x) => x.memberWebid === newMemberWebid);
  const others = announcementsFromRoster({ members, circleId, exceptWebid: newMemberWebid });
  out.announced = newcomer.length + others.length;

  // 1. The circle learns the newcomer — over the ordinary circle fan, i.e. at each member's own
  //    per-circle address. Narrowed to the members who are NOT the newcomer: they are settled, so
  //    that path is known to work, and it keeps the announcement off the one address that is not
  //    ready yet (below).
  const settled = members
    .map((m) => (typeof m?.webid === 'string' ? m.webid : null))
    .filter((w) => w && w !== newMemberWebid && w !== selfWebidOf(agent));
  if (newcomer.length && settled.length) {
    try {
      const r = await agent.callSkill('stoop', 'broadcastCircleAddresses', {
        groupId: circleId, announcements: newcomer, to: settled,
      });
      out.toCircle = Number(r?.sent) || 0;
    } catch (err) {
      logger?.warn?.('[circle-address] announcing the newcomer failed', err?.message ?? err);
    }
  }

  // 2. The newcomer learns the circle — over the SAME direct peer channel the redeem response just
  //    travelled, not the circle fan.
  //
  //    This is a race, not a preference. The newcomer only starts listening on their per-circle
  //    address once their own device registers it (`makeCircleReachable` → `registerCirclePresence`),
  //    which happens after the redeem returns — so a fan sent from here, milliseconds earlier, would
  //    be aimed at an address the relay has not yet heard of. Their global address is provably live
  //    at this instant: a response reached them on it a moment ago. It reveals nothing new either —
  //    it is the address they gave the admin to join with.
  //
  //    The envelope is the one `broadcastCircleAddresses` produces, so the receiving handler and its
  //    deny-by-default verification are the same on both routes.
  if (others.length && typeof agent.sendPeerMessage === 'function') {
    const ts = Date.now();
    try {
      await agent.sendPeerMessage(newMemberWebid, {
        type:    'p2p-chat',
        subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND,
        circleId,
        msgId:   `ca-${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ts,
        announcements: others,
        noWake:  true,
      }, { guarantee: 'hold-forward' });
      out.toNewMember = others.length;
    } catch (err) {
      logger?.warn?.('[circle-address] telling the newcomer about the circle failed', err?.message ?? err);
    }
  }
  return out;
}

/** Envelope guard — same shape as the other per-circle broadcasts. */
export function isValidCircleAddressAnnounceEnvelope(p) {
  return !!(
    p
    && typeof p === 'object'
    && p.subtype === CIRCLE_ADDRESS_ANNOUNCE_KIND
    && typeof p.circleId === 'string' && p.circleId
    && Array.isArray(p.announcements) && p.announcements.length > 0
  );
}

/**
 * RECEIVE: record every announcement whose proof holds, then refresh the address binding AND the
 * authorize snapshot together — from the one read `bindCircleAddressKeysFor` performs.
 *
 * The refresh is not optional and not deferrable. Recording an address without it leaves a member
 * this device can now send to but whose envelopes it will refuse as a stranger's
 * (`SENDER_NOT_AUTHORIZED`) — working, then failing, which is the worst shape a fix can take.
 *
 * @param {object} a
 * @param {object} a.agent
 * @param {{warn?: Function, info?: Function}} [a.logger]
 * @returns {(fromPeerAddr: string, payload: object) => Promise<{recorded: number, refused: number}>}
 */
export function makeCircleAddressAnnouncePeerHandler({ agent, logger = console } = {}) {
  return async function onCircleAddressAnnounce(_fromPeerAddr, payload) {
    if (!isValidCircleAddressAnnounceEnvelope(payload)) {
      logger?.warn?.('[circle-address] dropping malformed announcement envelope');
      return { recorded: 0, refused: 0 };
    }
    const circleId = payload.circleId;
    const proven = verifyCircleAddressAnnouncements(payload.announcements, circleId);
    const refused = payload.announcements.length - proven.length;
    if (refused > 0) {
      // Deny-by-default is silent to the sender by design, but never silent to us: an unprovable
      // announcement is either a bug in a peer or someone trying something.
      logger?.warn?.(`[circle-address] refused ${refused} unproven announcement(s) for ${circleId}`);
    }
    let recorded = 0;
    for (const one of proven) {
      try {
        const r = await agent?.callSkill?.('stoop', 'recordCircleAddressAnnouncement', {
          groupId:            circleId,
          memberWebid:        one.memberWebid,
          circleAddress:      one.circleAddress,
          circleAddressProof: one.circleAddressProof,
          // The member's release rides along, completing the roster projection (a released name
          // reaches this device). Absent on a release-less announcement — carried only when present.
          ...(one.personaProperties ? { personaProperties: one.personaProperties } : {}),
        });
        if (r?.ok) recorded += 1;
      } catch (err) {
        logger?.warn?.('[circle-address] recording an announcement failed', err?.message ?? err);
      }
    }
    // ONE refresh for the whole batch, and only when something actually changed: it re-reads the
    // roster and rewrites both the sealing bindings and the authorize snapshot.
    if (recorded > 0) {
      try { await bindCircleAddressKeysFor({ agent, circleId }); }
      catch (err) {
        logger?.warn?.(
          `[circle-address] recorded ${recorded} address(es) for ${circleId} but could not refresh the `
          + `binding — those members may be unreachable until the next circle open: ${err?.message ?? err}`,
        );
      }
    }
    return { recorded, refused };
  };
}
