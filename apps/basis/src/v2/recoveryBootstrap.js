/**
 * recoveryBootstrap — the recovery file carries each circle's MEMBER LIST, so a restored device gets a
 * working circle and not only its name.
 *
 * Measured 2026-09-10 (`recoveryRestoreParity.relay.test.js`): the phrase brought the identity back and
 * the file brought the circle list back, and the restored phone then sat in silence. Restore enrols
 * the new device, so it derives per-circle addresses nobody's roster names; its own roster is empty,
 * because the membership trail lived on the phone that is gone. To announce where it now is, it must
 * know whom to tell; to catch the roster up, it must know a member to ask. Circular both ways.
 *
 * Frits, 2026-09-13: *"why not back up the roster itself?"* So the export offers, per circle and on by
 * default, to carry that circle's roster — the same rows a sibling would serve as a seed (the trail
 * rows and the derived member rows). Import lands them through the seed's own ingest (id-preserved,
 * first-write-wins), then the standing enrol consume does the rest: announce the fresh address to
 * every member, pull every lane from them. The snapshot is as old as the file; what happened since
 * — members who joined or left, addresses that changed — arrives as signed statements and folds on
 * top, as soon as one member is online. No new trust admission anywhere: the file is sealed to the
 * owner's phrase, the roster in it is the owner's own device's data, and the statements that heal it
 * verify as they always did.
 *
 * Pure — web ≡ mobile, no I/O.
 */
import { encodeEnrollOffer } from './enrollOffer.js';

/** The recovery file's roster section: `{ [circleId]: { rows, members } }`, beside `agents`. */
export const ROSTERS_KEY = 'rosters';

/** The member facts worth carrying — what the seed serves, nothing more. */
export function projectMemberRow(m) {
  if (!m || typeof m.webid !== 'string' || !m.webid) return null;
  return {
    webid: m.webid,
    ...(typeof m.handle === 'string' && m.handle ? { handle: m.handle } : {}),
    ...(typeof m.displayName === 'string' && m.displayName ? { displayName: m.displayName } : {}),
    ...(typeof m.role === 'string' && m.role ? { role: m.role } : {}),
    ...(typeof m.pubKey === 'string' && m.pubKey ? { pubKey: m.pubKey } : {}),
    ...(typeof m.circleAddress === 'string' && m.circleAddress ? { circleAddress: m.circleAddress } : {}),
    ...(Array.isArray(m.circleAddresses) && m.circleAddresses.length ? { circleAddresses: m.circleAddresses } : {}),
    ...(typeof m.ceremonyCommitment === 'string' && m.ceremonyCommitment ? { ceremonyCommitment: m.ceremonyCommitment } : {}),
  };
}

/**
 * One circle's snapshot for the file.
 *
 * Beside the rows: the owner's OWN ANNOUNCEMENT for the circle, with its proof — the same artefact the
 * device sends when it announces, minted here by the device that still holds the key. A device never
 * records its own address into the shared person-row (the others learn it by announce), so the rows
 * as this device holds them name no address of its own; the restored device needs exactly that
 * address, because it is what signed everything the owner said before the wipe, and it lands there
 * through the announce's own receive door, proof re-verified, like any announcement.
 *
 * @param {object} a
 * @param {Array<object>} a.rows          the circle's membership-redemption trail rows (`listOpen`)
 * @param {Array<object>} a.members       roster rows (`listGroupMembers`)
 * @param {object|null} [a.ownAnnouncement]   `ownAnnouncementFor(...)` — this device's proven address
 * @returns {{rows: object[], members: object[], own?: object}|null}  null when there is nothing to carry
 */
export function rosterSnapshot({ rows, members, ownAnnouncement = null } = {}) {
  const r = (Array.isArray(rows) ? rows : []).filter((it) => it && typeof it === 'object');
  const m = (Array.isArray(members) ? members : []).map(projectMemberRow).filter(Boolean);
  if (r.length === 0 && m.length === 0) return null;
  const own = (ownAnnouncement && typeof ownAnnouncement === 'object' && typeof ownAnnouncement.circleAddress === 'string')
    ? ownAnnouncement : null;
  return { rows: r, members: m, ...(own ? { own } : {}) };
}

/**
 * A COPY of the registry body for the file with the ticked circles' rosters beside it. The registry
 * the device keeps is untouched: the choice is the file's.
 * @param {object} a
 * @param {object} a.body                                  the registry body (`{agents: [...]}`)
 * @param {Object<string, {rows: object[], members: object[]}|null>} a.rosters   per circle id
 * @returns {object} a new body
 */
export function bodyWithRosters({ body, rosters } = {}) {
  const out = { ...body };
  delete out[ROSTERS_KEY];
  const kept = {};
  for (const [circleId, snap] of Object.entries(rosters ?? {})) {
    if (snap && Array.isArray(snap.rows) && Array.isArray(snap.members)) kept[circleId] = snap;
  }
  if (Object.keys(kept).length) out[ROSTERS_KEY] = kept;
  return out;
}

/** The roster section of an opened file, or `{}`. */
export function rostersOf(body) {
  const r = body?.[ROSTERS_KEY];
  return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
}

/**
 * The enrol offer a restored device consumes: one circle per snapshot, naming EVERY other member —
 * an admin first — by their own address (the address a person is greeted at; a restored device speaks
 * to members as the person, out of circle scope). Null when no snapshot names anyone but the owner.
 *
 * @param {object} a
 * @param {object} a.body            the opened file
 * @param {string} a.selfPubKey      the owner — never a target
 * @param {object} [a.memberships]   the owner's `{ [circleId]: record }` map, for handles and relays
 * @returns {{offer: string, circles: number}|null}
 */
export function bootstrapOfferFromRosters({ body, selfPubKey, memberships = {} } = {}) {
  const circles = [];
  const relays = [];
  for (const [id, snap] of Object.entries(rostersOf(body))) {
    const rows = (Array.isArray(snap?.members) ? snap.members : [])
      .filter((m) => m && typeof m.webid === 'string' && m.webid && m.webid !== selfPubKey);
    const ordered = [...rows.filter((m) => m.role === 'admin'), ...rows.filter((m) => m.role !== 'admin')];
    const addresses = [...new Set(ordered.map((m) => m.webid))];
    if (addresses.length === 0) continue;
    const rec = memberships?.[id] ?? null;
    circles.push({ id, handle: rec?.handle ?? null, address: addresses[0], others: addresses.slice(1), member: true });
    for (const url of (Array.isArray(rec?.relays) ? rec.relays : [])) if (url && !relays.includes(url)) relays.push(url);
  }
  if (circles.length === 0) return null;
  return { offer: encodeEnrollOffer({ relays, circles }), circles: circles.length };
}
