/**
 * catchUpTargets — WHERE A LANE'S CATCH-UP REQUEST GOES (2026-09-21).
 *
 * Every lane's reconnect kick (governance · membership · keys · tasks · chat) asks the circle's other members for
 * what this device missed, spoken as this circle's identity. Until today the kick walked `listGroupRoster`, whose
 * `addr` is the member's GLOBAL webid, so the request left for a global address — the member's device met it as a
 * stranger at its canonical door, answered the greeting canonically to a per-circle address, and the requester's
 * gate refused that answer (rightly: a canonical identity inside a circle). One refusal per join, every reconnect,
 * on every lane, logged as L110 in the share walk; and, with several devices registering the same profile address,
 * the request reached whichever of them registered last.
 *
 * The fan already resolves a member the right way (`resolveMemberAddress`: circleAddress → … → webid, the global
 * rung behind the person's address-fallback setting). This is that ladder for the pull side, from the same derived
 * roster (`listGroupMembers`: `circleAddress` + the proven `circleAddresses` set), so the two cannot drift: the
 * member's primary per-circle address; never this device's own row; the global key only when the person allows it.
 *
 * @param {object} a
 * @param {(app: string, op: string, args?: object) => Promise<any>} a.callSkill
 * @param {string} a.circleId
 * @param {string|null} [a.selfWebid]            this device's person (its row is never a target)
 * @param {() => boolean} [a.allowGlobal]        the address-fallback setting, read live; absent = off
 * @param {string|null} [a.ownDevicesExcept]     this device's own address here: when given, this person's OTHER devices
 *   in the circle (the other proven addresses on their own row) are targets too, first and marked `own: true`
 * @returns {Promise<Array<{webid: string, addr: string, via: 'circle-address'|'webid', own?: true}>>}
 */
export async function catchUpTargets({ callSkill, circleId, selfWebid = null, allowGlobal = null, ownDevicesExcept = null } = {}) {
  if (typeof callSkill !== 'function' || typeof circleId !== 'string' || !circleId) return [];
  let rows = [];
  try { rows = (await callSkill('pinboard', 'listGroupMembers', { groupId: circleId }))?.members ?? []; } catch { return []; }
  let global = false;
  try { global = typeof allowGlobal === 'function' && allowGlobal() === true; } catch { global = false; }
  const out = []; const seen = new Set();
  if (typeof ownDevicesExcept === 'string' && ownDevicesExcept && selfWebid) {
    const mine = (Array.isArray(rows) ? rows : []).find((m) => (m?.webid ?? m?.addr ?? m?.ref) === selfWebid);
    const addrs = [...new Set([mine?.circleAddress, ...(Array.isArray(mine?.circleAddresses) ? mine.circleAddresses : [])])];
    for (const a of addrs) if (typeof a === 'string' && a && a !== ownDevicesExcept) out.push({ webid: selfWebid, addr: a, via: 'circle-address', own: true });
  }
  for (const m of Array.isArray(rows) ? rows : []) {
    const webid = m?.webid ?? m?.addr ?? m?.ref ?? null;
    if (typeof webid !== 'string' || !webid || webid === selfWebid || seen.has(webid)) continue;
    seen.add(webid);
    const primary = (typeof m?.circleAddress === 'string' && m.circleAddress) ? m.circleAddress
      : (Array.isArray(m?.circleAddresses) ? m.circleAddresses.find((a) => typeof a === 'string' && a) ?? null : null);
    if (primary) out.push({ webid, addr: primary, via: 'circle-address' });
    else if (global) out.push({ webid, addr: webid, via: 'webid' });
  }
  return out;
}
