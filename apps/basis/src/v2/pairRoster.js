/**
 * pairRoster — the roster a CONTACT lacks, made automatically from the circle mechanics (sync-policy / the close-contacts
 * note §2, decided with Frits 2026-09-18, ledger L105).
 *
 * A card contact is an ADDRESS: the profile address on the card, which every device of the person holds and no
 * ceremony can retire — so after a revoke, a stolen phone can keep answering there. A circle gives each device its
 * own proven address, retires a stolen one at the ceremony, and folds the person key root-revealed. Frits: no new
 * contact type, no button, reuse the circle mechanics. So: on the first exchange after the Hi, the two apps make a
 * hidden two-member circle between themselves — the PAIR ROSTER — with a deterministic id both sides derive from the
 * two webids, and (the next step, the route) every message between them travels over it.
 *
 * Race-free by construction: the side whose webid sorts FIRST is the founder. It creates the circle and puts the
 * invite on its next turn (`pairInvite`); the other side never creates — its first turn carries `pairRequest`, and
 * the founder answers with the invite. The receiving side joins through the same programmatic join both wizards
 * share (`joinCircleFromInvite`, with the post-join reachability step); the admitting side promotes the joiner to
 * admin (a two-member circle with one admin would be a lopsided contact) — the `onAdmitted` seam the redeem handler
 * fires. Idempotent everywhere: an invite for a circle already joined does nothing, a request for a roster already
 * made re-sends the invite, an invite whose id is not THE pair id for these two webids is refused.
 *
 * The contact row carries `pairCircleId` once the roster exists (Contacten paints "verbonden"); the launcher hides
 * the `pair-` ids. Nothing new on the wire: an invite, a redeem, a join, a role statement.
 */
import { pairCircleIdFor, isPairCircleId, pairFounderOf } from './pairCircleId.js';
import { quickCreateCircle } from './circleCreate.js';
import { buildCircleInviteUri, joinCircleFromInvite } from './circleInvite.js';
import { decodeInvite } from '../core/wizards/joinGroupState.js';

export { PAIR_CIRCLE_PREFIX, pairCircleIdFor, isPairCircleId, pairFounderOf } from './pairCircleId.js';

/**
 * @param {object} a
 * @param {string} a.selfWebid
 * @param {(app: string, op: string, args?: object) => Promise<any>} a.callSkill
 * @param {Function} a.sendPeerRedeem            the joiner's redeem request (the shell's / the harness's)
 * @param {(circleId: string) => string|null} [a.circleAddressFor]
 * @param {(cid: string, gid: string, addr: string) => string|null} [a.signCircleLink]
 * @param {(a: { circleId: string }) => any} [a.onJoined]   the post-join step (`makeCircleReachable`)
 * @param {() => Promise<string>|string} [a.myHandle]       the handle this person joins under (default: the webid's head)
 * @param {() => string|null} [a.relayUrl]                  put on the invite so the joiner dials where the founder is
 * @param {Function} [a.dialEndpoint] · @param {Function} [a.activeEndpointUrl]
 * @param {{ warn?: Function, info?: Function }} [a.logger]
 */
export function createPairRoster({
  selfWebid, callSkill, sendPeerRedeem, circleAddressFor = null, signCircleLink = null, onJoined = null,
  myHandle = null, relayUrl = null, dialEndpoint = null, activeEndpointUrl = null, identityOf = null, logger = console,
} = {}) {
  if (typeof selfWebid !== 'string' || !selfWebid) throw new Error('pairRoster: selfWebid required');
  if (typeof callSkill !== 'function') throw new Error('pairRoster: callSkill required');
  const inFlight = new Map();   // circleId → the join in progress (a second invite while one runs joins nothing twice)

  /**
   * THE PERSON behind an address. A turn arrives from the sender's PERSON address (the rotating key's) or a per-circle
   * address, never from the webid the pair id is derived from — so the address is resolved to the person first:
   * the host's resolver (roster bindings), then the contact book (the card's person key), else the address itself.
   */
  const webidOf = async (fromAddr) => {
    if (typeof fromAddr !== 'string' || !fromAddr) return fromAddr;
    try { const r = typeof identityOf === 'function' ? identityOf(fromAddr) : null; if (typeof r === 'string' && r && r !== fromAddr) return r; } catch { /* next */ }
    try {
      const res = await callSkill('stoop', 'listContacts', {});
      const rows = res?.items ?? res?.contacts ?? [];
      const hit = rows.find((c) => c?.webid === fromAddr || c?.personKey?.pubKey === fromAddr || c?.peerAddr === fromAddr);
      if (hit?.webid) return hit.webid;
    } catch { /* the address stands */ }
    return fromAddr;
  };

  // The handle this person joins the pair circle under: theirs when they have one, else a quiet derived one that
  // passes the handle rule (letters and digits, a few characters) — nobody reads it; the circle is hidden.
  const derivedHandle = () => `p${selfWebid.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 7) || 'erson'}`;
  const handleFor = async () => {
    try { const h = typeof myHandle === 'function' ? await myHandle() : myHandle; if (typeof h === 'string' && h.trim().length >= 3) return h.trim(); } catch { /* fall through */ }
    return derivedHandle();
  };
  const myCircles = async () => {
    try { return new Set(((await callSkill('stoop', 'listMyCircles', {}))?.circles ?? []).filter((c) => typeof c === 'string')); } catch { return new Set(); }
  };
  const memberOf = async (circleId, webid) => {
    try {
      const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
      return (r?.members ?? []).some((m) => m?.webid === webid);
    } catch { return false; }
  };
  const recordOnContact = async (webid, circleId) => {
    try { await callSkill('stoop', 'addContact', { webid, pairCircleId: circleId }); } catch { /* the row is a convenience; the roster is the fact */ }
  };

  /** The pair circle for `contactWebid`, created here when this side founds and it does not exist yet. */
  async function ensureCircle(contactWebid, { name = null } = {}) {
    const circleId = pairCircleIdFor(selfWebid, contactWebid);
    if ((await myCircles()).has(circleId)) return { circleId, created: false };
    if (pairFounderOf(selfWebid, contactWebid) !== selfWebid) return { circleId, created: false, founder: contactWebid };
    await quickCreateCircle({
      callSkill, id: circleId, founderPubKey: selfWebid,
      name: name ?? contactWebid.slice(0, 8),
      // the pair roster: hidden from Kringen, one place on its invite, no app in it — the roster is the point
      rulesExtra: { pair: true, apps: [] },
      inviteMaxRedemptions: 1,
    });
    return { circleId, created: true };
  }

  return {
    pairCircleIdFor: (contactWebid) => pairCircleIdFor(selfWebid, contactWebid),
    /**
     * What this side's next turn to `contactWebid` should carry: `{ pairInvite }` when this side founds and the
     * contact is not on the roster yet; `{ pairRequest: true }` when the other side founds and no roster exists here;
     * `null` when the roster already has both (or the contact is already admitted).
     */
    async prepare(contactWebid, { name = null } = {}) {
      if (typeof contactWebid !== 'string' || !contactWebid || contactWebid === selfWebid) return null;
      const circleId = pairCircleIdFor(selfWebid, contactWebid);
      const mine = await myCircles();
      if (mine.has(circleId) && await memberOf(circleId, contactWebid)) return null;
      if (pairFounderOf(selfWebid, contactWebid) !== selfWebid) return mine.has(circleId) ? null : { pairRequest: true };
      try {
        await ensureCircle(contactWebid, { name });
        // the invite names ME as the admin to redeem with (the joiner's redeem is a round-trip to the founder), at
        // the profile address the Hi established — the last thing the pair roster ever uses that address for
        const inv = await buildCircleInviteUri({ callSkill, circleId, adminPeerAddr: selfWebid, ...(typeof relayUrl === 'function' && relayUrl() ? { relayUrl: relayUrl() } : {}) });
        if (!inv?.uri) { logger?.warn?.(`[pair-roster] no invite for ${circleId.slice(0, 12)}: ${inv?.error ?? 'no-code'}`); return null; }
        return { pairInvite: inv.uri };
      } catch (err) { logger?.warn?.(`[pair-roster] could not prepare the pair roster: ${err?.message ?? err}`); return null; }
    },
    /** The other side asked (their first turn, they do not found): make the roster, answer with the invite. */
    async onRequest(fromAddr, { name = null } = {}) {
      const webid = await webidOf(fromAddr);
      if (webid === selfWebid || pairFounderOf(selfWebid, webid) !== selfWebid) return null;   // not mine to found — ignored
      return this.prepare(webid, { name });
    },
    /** An invite arrived on a turn: join, if it is THE pair circle for these two and this side is not in it yet. */
    async onInvite(fromAddr, inviteUri) {
      const webid = await webidOf(fromAddr);
      if (webid === selfWebid) return { joined: false, reason: 'not-our-pair' };
      const expected = pairCircleIdFor(selfWebid, webid);
      let invite = null;
      try { const st = {}; decodeInvite(inviteUri, st); invite = st.invite ?? null; } catch { invite = null; }
      if (!invite || invite.groupId !== expected) { logger?.warn?.(`[pair-roster] refused an invite from ${String(fromAddr).slice(0, 12)}…: not the pair circle for these two`); return { joined: false, reason: 'not-our-pair' }; }
      if ((await myCircles()).has(expected)) { await recordOnContact(webid, expected); return { joined: false, reason: 'already-in', circleId: expected }; }
      if (inFlight.has(expected)) return inFlight.get(expected);
      const run = (async () => {
        const r = await joinCircleFromInvite({
          inviteUri, callSkill, sendPeerRedeem, handle: await handleFor(),
          ...(typeof circleAddressFor === 'function' ? { circleAddressFor } : {}),
          ...(typeof signCircleLink === 'function' ? { signCircleLink } : {}),
          ...(typeof dialEndpoint === 'function' ? { dialEndpoint } : {}),
          ...(typeof activeEndpointUrl === 'function' ? { activeEndpointUrl } : {}),
          ...(typeof onJoined === 'function' ? { onJoined } : {}),
        });
        if (r?.error) { logger?.warn?.(`[pair-roster] the join failed: ${r.error}`); return { joined: false, reason: r.error, circleId: expected }; }
        await recordOnContact(webid, expected);
        return { joined: true, circleId: expected };
      })().finally(() => inFlight.delete(expected));
      inFlight.set(expected, run);
      return run;
    },
    /** The admitting side (the redeem handler's seam): a member admitted into a pair circle is its co-admin. */
    async onAdmitted({ circleId, newMemberWebid } = {}) {
      if (!isPairCircleId(circleId) || typeof newMemberWebid !== 'string' || !newMemberWebid) return null;
      if (circleId !== pairCircleIdFor(selfWebid, newMemberWebid)) return null;
      let promoted = false;
      try { promoted = !!(await callSkill('stoop', 'setMemberRole', { groupId: circleId, memberWebid: newMemberWebid, role: 'admin' }))?.ok; }
      catch (err) { logger?.warn?.(`[pair-roster] could not promote the co-member: ${err?.message ?? err}`); }
      await recordOnContact(newMemberWebid, circleId);
      return { promoted };
    },
  };
}

/** The launcher's filter: a pair roster is a contact's, never a tile. */
export function withoutPairCircles(circles) {
  return (Array.isArray(circles) ? circles : []).filter((c) => !isPairCircleId(typeof c === 'string' ? c : c?.id));
}
