/**
 * WHAT A DEVICE CANNOT VOUCH FOR, IT DOES NOT HAND ON.
 *
 * A catch-up serves stored statements to another device, which checks each one on arrival. A stored statement whose
 * bytes or signature changed after it landed here (a damaged record, a planted one, a tombstone that has no signature
 * left) is refused there, so serving it only gives the receiver a hole it cannot explain. So every serve passes its
 * statements through the rail's own `checkSigned` first, here, now (a signature-memo hit makes a repeat cheap), and
 * leaves out what fails, counted.
 *
 * One function for every lane that serves (the governance-shaped catch-up: membership, keys, governance; the frontier
 * replay: items, chat), so a lane cannot forget it.
 *
 * @param {Array<object>} statements
 * @param {string} circleId
 * @param {{ checkSigned?: (circleId: string, statement: object) => boolean }} rail
 * @param {{ onWithheld?: (n: number) => void }} [o]
 * @returns {Array<object>} only the statements this device can vouch for; ALL of them refused when the rail cannot check
 */
export function sendOnOnlyChecked(statements, circleId, rail, { onWithheld = null } = {}) {
  const list = Array.isArray(statements) ? statements : [];
  if (typeof rail?.checkSigned !== 'function') {
    // a rail that cannot check hands on nothing: serving unchecked statements is the hole this closes
    if (list.length && typeof onWithheld === 'function') { try { onWithheld(list.length); } catch { /* a count never breaks a serve */ } }
    return [];
  }
  const out = [];
  let withheld = 0;
  for (const s of list) {
    let ok = false;
    try { ok = rail.checkSigned(circleId, s) === true; } catch { ok = false; }
    if (ok) out.push(s); else withheld += 1;
  }
  if (withheld && typeof onWithheld === 'function') { try { onWithheld(withheld); } catch { /* a count never breaks a serve */ } }
  return out;
}
