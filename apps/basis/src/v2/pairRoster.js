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
import { personaOfContact } from './contactPersona.js';

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
  myHandle = null, relayUrl = null, dialEndpoint = null, activeEndpointUrl = null, identityOf = null,
  // `announceOwn(circleId)`: this device's own address announcement WITH its ceremony commitment (the shells'
  // `announceOwnCircleAddress`). The admitting side runs it once the co-member is in: a row relayed by the admin
  // carries the commitment without its proof, so the joiner must hear the founder's own announcement before the
  // founder's rotations can fold there — the whole point of the pair roster.
  announceOwn = null, logger = console,
  // THE LENS (persona step 3, 2026-09-24): which persona this contact sees you as. `personaFor(webid)` reads the
  // contact row's persona (default: the book, through `personaOfContact` — never a silent 'default'); the founder
  // pushes that persona's RELEASE onto the pair circle through `shareRelease(circleId, personaId)` (the shells'
  // `shareDisclosureToCircle`), and the joiner joins AS it, so the release `finalSubmit` computes is that persona's.
  // Same identity, same address, same pair id — only what the contact receives differs (`contactPersona.js`).
  personaFor = null, shareRelease = null,
} = {}) {
  if (typeof selfWebid !== 'string' || !selfWebid) throw new Error('pairRoster: selfWebid required');
  if (typeof callSkill !== 'function') throw new Error('pairRoster: callSkill required');
  const inFlight = new Map();   // circleId → the join in progress (a second invite while one runs joins nothing twice)
  const personaOf = async (webid) => {
    if (typeof personaFor === 'function') { try { return (await personaFor(webid)) ?? null; } catch { return null; } }
    try {
      const rows = ((r) => r?.items ?? r?.contacts ?? [])(await callSkill('stoop', 'listContacts', {}));
      return personaOfContact(rows.find((c) => c?.webid === webid));
    } catch { return null; }
  };

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
  // passes the handle rule (letters and digits, a few characters). The derived one lives on the pair roster's row
  // ONLY — never on the profile: the join path sets the person's handle from the join handle, and a placeholder that
  // became the handle was then stated on every roster as what the person says about themselves, and painted as their
  // name on every contact's Contacten (2026-09-21, "pjy8n7fq"). `own` says which it is; the join keeps the profile
  // handle alone when it is not the person's.
  const derivedHandle = () => `p${selfWebid.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 7) || 'erson'}`;
  const handleFor = async () => {
    try { const h = typeof myHandle === 'function' ? await myHandle() : myHandle; if (typeof h === 'string' && h.trim().length >= 3) return { handle: h.trim(), own: true }; } catch { /* fall through */ }
    return { handle: derivedHandle(), own: false };
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
    // The founder becomes reachable in its own circle at once (register this device's address there, announce
    // with the commitment) — the create wizard's `onDispatched` does this for a circle a person makes by hand;
    // a pair circle is made by the channel, so the same seam runs here.
    if (typeof onJoined === 'function') { try { await onJoined({ circleId }); } catch { /* the next boot registers */ } }
    // …and says, on the new pair circle, what THIS contact's persona discloses (the lens). Best-effort: a release
    // that fails to land is pushed again by the next Mij save; the contact's row then names by the card meanwhile.
    if (typeof shareRelease === 'function') {
      const persona = await personaOf(contactWebid);
      if (persona) { try { await shareRelease(circleId, persona); } catch (err) { logger?.warn?.(`[pair-roster] the release did not land: ${err?.message ?? err}`); } }
    }
    return { circleId, created: true };
  }

  return {
    pairCircleIdFor: (contactWebid) => pairCircleIdFor(selfWebid, contactWebid),
    /** Where a message to this contact goes once the pair roster exists (see `pairRouteFor`). */
    routeFor: (contactWebid) => pairRouteFor({ callSkill, selfWebid, contactWebid }),
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
      let invite = null;
      try { const st = {}; decodeInvite(inviteUri, st); invite = st.invite ?? null; } catch { invite = null; }
      let webid = await webidOf(fromAddr);
      // The sender may speak as a person address this side cannot place yet (they rotated; the contact book still
      // holds the version before) — then the invite's own `adminPeerAddr` names the founder, and it counts only
      // when it is a CONTACT of mine: the join is a redeem round-trip to that very contact, who alone holds the
      // code, so a forged claim admits nobody anywhere.
      if (webid === fromAddr && typeof invite?.adminPeerAddr === 'string' && invite.adminPeerAddr && invite.adminPeerAddr !== selfWebid) {
        try {
          const rows = ((r) => r?.items ?? r?.contacts ?? [])(await callSkill('stoop', 'listContacts', {}));
          if (rows.some((c) => c?.webid === invite.adminPeerAddr)) webid = invite.adminPeerAddr;
        } catch { /* the address stands */ }
      }
      if (webid === selfWebid) return { joined: false, reason: 'not-our-pair' };
      const expected = pairCircleIdFor(selfWebid, webid);
      if (!invite || invite.groupId !== expected) { logger?.warn?.(`[pair-roster] refused an invite from ${String(fromAddr).slice(0, 12)}…: not the pair circle for these two`); return { joined: false, reason: 'not-our-pair' }; }
      if ((await myCircles()).has(expected)) { await recordOnContact(webid, expected); return { joined: false, reason: 'already-in', circleId: expected }; }
      if (inFlight.has(expected)) return inFlight.get(expected);
      const run = (async () => {
        const { handle, own } = await handleFor();
        const persona = await personaOf(webid);   // the lens: join AS the persona this contact sees
        const r = await joinCircleFromInvite({
          inviteUri, callSkill, sendPeerRedeem, handle, profileHandle: own, persona,
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
      // …and tell the co-member where I answer, with my commitment — the fan reaches them now that they are on the row.
      if (typeof announceOwn === 'function') { try { await announceOwn(circleId); } catch { /* the next boot re-announces */ } }
      return { promoted };
    },
  };
}

/**
 * THE ROUTE (L105, the second half): where a message to `contactWebid` goes once the pair roster exists — their
 * PRIMARY per-circle address on that roster (the slot the member chose, or the address that joined), over the pair
 * circle (sent as MY per-circle address there), sealed to the person key the roster folded root-revealed. Null when
 * no pair roster is here yet (the message goes to the profile address, as before) or the contact is not on it.
 * This is what closes the window after a revoke for every contact written to: the ceremony retires a stolen
 * device's address from the pair roster and announces the rotation there, and the profile address is not used.
 */
export async function pairRouteFor({ callSkill, selfWebid, contactWebid } = {}) {
  if (typeof callSkill !== 'function' || typeof selfWebid !== 'string' || typeof contactWebid !== 'string' || !contactWebid || contactWebid === selfWebid) return null;
  let circleId;
  try { circleId = pairCircleIdFor(selfWebid, contactWebid); } catch { return null; }
  try {
    const mine = (await callSkill('stoop', 'listMyCircles', {}))?.circles ?? [];
    if (!mine.includes(circleId)) return null;
    const row = ((await callSkill('stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? []).find((m) => m?.webid === contactWebid);
    const to = typeof row?.circleAddress === 'string' && row.circleAddress ? row.circleAddress : null;
    if (!to) return null;
    return { to, circleId, personKey: row.personKey ?? null };
  } catch { return null; }
}

/** The launcher's filter: a pair roster is a contact's, never a tile. */
export function withoutPairCircles(circles) {
  return (Array.isArray(circles) ? circles : []).filter((c) => !isPairCircleId(typeof c === 'string' ? c : c?.id));
}
