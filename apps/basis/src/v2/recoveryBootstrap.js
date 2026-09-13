/**
 * recoveryBootstrap — the recovery file carries someone to ASK, so a restored device gets a working
 * circle and not only its name.
 *
 * Measured 2026-09-10 (`recoveryRestoreParity.relay.test.js`): the phrase brought the identity back and
 * the file brought the circle list back, and the restored phone then sat in silence. Restore enrols
 * the new device, so it derives per-circle addresses nobody's roster names; its own roster is empty,
 * because the membership trail lived on the phone that is gone. To announce where it now is, it must
 * know whom to tell; to catch the roster up, it must know a member to ask. Circular both ways.
 *
 * The add-a-device path already solves exactly this: the enrol offer carries a SIBLING's per-circle
 * address, and its consume seeds the roster from that sibling, announces, and pulls every lane. The
 * file simply lacked that one fact. So (Frits, 2026-09-11): the export offers a per-circle choice,
 * default on, and a ticked circle's record carries ONE other member's per-circle address and the
 * point they were reached on. Import turns those into an enrol offer and hands it to the very same
 * consume — one mechanism, not a second one.
 *
 * Minimum disclosure, said plainly: the file then holds another person's address. It is sealed to the
 * owner's phrase, the choice is the owner's, made at the moment the artefact is written, and it is
 * what the person shares with every member of that circle already. The file never carries a name.
 *
 * Pure — web ≡ mobile, no I/O.
 */
import { setCircleMembership, circleMembershipsOf } from '@onderling/agent-registry';
import { encodeEnrollOffer } from './enrollOffer.js';

/** The per-circle address a roster row presents, or null. */
function rowAddress(m) {
  if (typeof m?.circleAddress === 'string' && m.circleAddress) return m.circleAddress;
  const set = Array.isArray(m?.circleAddresses) ? m.circleAddresses.filter((a) => typeof a === 'string' && a) : [];
  return set[0] ?? null;
}

/**
 * Choose whom a restored device should ask for this circle: an ADMIN first (an admin's device holds
 * the whole trail), else any member. Never the person themself — the file is for the device that no
 * longer has them. What the file carries is the member's WEBID — their own address, the one a person
 * is greeted at — because a restored device speaks to them as the person, out of circle scope; a
 * per-circle address would refuse the person's key as a stranger's. Their per-circle address is
 * returned beside it for a caller that wants it.
 *
 * @param {object} a
 * @param {Array<object>} a.members   roster rows (`listGroupMembers`)
 * @param {string} a.selfPubKey
 * @returns {{webid: string, address: string|null}|null}
 */
export function chooseBootstrapPeer({ members, selfPubKey } = {}) {
  const rows = (Array.isArray(members) ? members : [])
    .filter((m) => m && typeof m.webid === 'string' && m.webid && m.webid !== selfPubKey)
    .map((m) => ({ address: rowAddress(m), webid: m.webid, role: m.role ?? 'member' }));
  const admin = rows.find((r) => r.role === 'admin');
  const pick = admin ?? rows[0] ?? null;
  return pick ? { webid: pick.webid, address: pick.address } : null;
}

/**
 * A COPY of the registry body for the file, with the chosen peers written onto the ticked circles'
 * records — and any peer a record already held REMOVED from the circles the person did not tick. The
 * registry the device keeps is untouched: the choice is the file's.
 *
 * @param {object} a
 * @param {object} a.body                       the registry body (`{agents: [...]}`)
 * @param {Object<string, {address: string, point?: string|null}|null>} a.peers   per circle id
 * @param {string} [a.profileId='default']
 * @returns {object} a new body
 */
export function bodyWithBootstrapPeers({ body, peers, profileId = 'default' } = {}) {
  const agents = Array.isArray(body?.agents) ? body.agents : [];
  return {
    ...body,
    agents: agents.map((entry) => {
      if (entry?.agentId !== profileId) return entry;
      let properties = entry.properties ?? {};
      for (const circleId of Object.keys(circleMembershipsOf(entry))) {
        const peer = peers?.[circleId] ?? null;
        try {
          properties = setCircleMembership(properties, circleId, peer
            ? { peer: { address: peer.address, ...(peer.point ? { point: peer.point } : {}) } }
            : { peer: null });
        } catch { /* a record that will not take the facet keeps what it had */ }
      }
      return { ...entry, properties };
    }),
  };
}

/**
 * The enrol offer a restored device consumes: one circle per record that carries a peer, the relay
 * points those peers were reached on. Null when the file carried nobody to ask.
 *
 * @param {object} entry   the restored profile's registry entry
 * @returns {{offer: string, circles: number}|null}
 */
export function bootstrapOfferFromEntry(entry) {
  const memberships = circleMembershipsOf(entry);
  const circles = [];
  const relays = [];
  for (const [id, rec] of Object.entries(memberships)) {
    if (!rec?.peer?.address) continue;
    circles.push({ id, handle: rec.handle ?? null, address: rec.peer.address, member: true });
    for (const url of [rec.peer.point, ...(Array.isArray(rec.relays) ? rec.relays : [])]) {
      if (typeof url === 'string' && url && !relays.includes(url)) relays.push(url);
    }
  }
  if (circles.length === 0) return null;
  return { offer: encodeEnrollOffer({ relays, circles }), circles: circles.length };
}
