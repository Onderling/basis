/**
 * siblingCarry — a person's own devices hand each other a circle's traffic. ONE carry, for every lane.
 *
 * The circle fan delivers to ONE address per member (the first proven one — "one member, one delivery,
 * fewest points") and never to the sender's own other devices. So a member's second device — the always-on
 * box, the laptop — saw a circle only by catch-up at connect, and what its owner wrote on the phone reached
 * it at the next connect, if at all. Three sibling fans had grown for three kinds (grants, contact turns,
 * known peers), each its own carry: the per-datatype build-up Frits rejected on 2026-09-13 —
 *
 *   "it should be dependent on policy channels … all my devices sync the same data, for the silos they have
 *    selected to sync."
 *
 * This is the one mechanism: the person's device set is a standing peer of every channel, and the channel
 * carries to it exactly as it carries to anyone else — the same wire payload the member fan sends, once, at
 * the place the lane already fans or lands. A device carries what it WROTE (its own statement, after the
 * member fan) and what it RECEIVED from a member (after the statement landed). It never carries what a
 * sibling carried to it: the sibling already reached the whole set, and the rails dedupe on landing anyway.
 *
 * The rails' gates are untouched. A sibling is a carrier, never an authority: the statement is verified at
 * the receiving rail by its AUTHOR's signature and binding, and the carrier's own address is admitted by the
 * sender gate because it is one of the person's proven per-circle addresses on the roster — the same
 * admission every member's address gets.
 *
 * Same shape as the contact-turn fan (`contactTurnFan.js`): `siblings()` is the proven own-device set
 * (`siblingDeviceAddresses`, `grantsRail.js`), `sendToPeer` speaks as this device's address in the circle
 * the sibling shares. The three older fans become callers of this one in a later change, then deletions.
 *
 * The per-silo / per-circle selection (which channels THIS device holds) is the next step: today every
 * device carries and receives everything, which is the policy's default.
 */

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings   the person's other proven device addresses
 * @param {(to: string, payload: object, opts?: object) => Promise<any>} a.sendToPeer  hold-forward send
 * @param {(line: string) => void} [a.onWarn]
 * @returns {{ carry: (payload: object, opts?: { from?: string|null }) => Promise<{ attempted: number, skipped: string|null, outcomes: Array }> }}
 */
export function makeSiblingCarry({ siblings, sendToPeer, onWarn = null } = {}) {
  if (typeof siblings !== 'function') throw new Error('makeSiblingCarry: a `siblings` lookup is required');
  if (typeof sendToPeer !== 'function') throw new Error('makeSiblingCarry: `sendToPeer` is required');
  const warn = typeof onWarn === 'function' ? onWarn : (m) => console.warn(m);

  /**
   * Hand one lane payload to every sibling.
   * @param {object} payload  the lane's own wire payload — `{ subtype, circleId, event, … }` for a circle lane, exactly
   *   what the member fan sends; `{ subtype, … }` for a PERSONAL channel (grants, contact turns, known peers), which
   *   has no circle — the send picks the circle it shares with each sibling.
   * @param {{ from?: string|null }} [opts]  the address the statement ARRIVED from (a landed statement); absent for an own write
   */
  async function carry(payload, { from = null } = {}) {
    if (!payload || typeof payload.subtype !== 'string' || !payload.subtype) {
      return { attempted: 0, skipped: 'not-a-lane-payload', outcomes: [] };
    }
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { addrs = []; }
    // What a SIBLING carried here has reached the whole set already — carrying it on would ping-pong
    // between a person's devices (the rails would dedupe it, but every hop is a send).
    if (from && addrs.includes(from)) return { attempted: 0, skipped: 'carried-by-a-sibling', outcomes: [] };
    const targets = addrs.filter((a) => typeof a === 'string' && a && a !== from);
    const outcomes = await Promise.all(targets.map(async (to) => {
      try {
        const r = await sendToPeer(to, payload, { guarantee: 'hold-forward' });
        return { to, delivered: r?.delivered === true || (r?.held !== true && r?.delivered !== false), held: r?.held === true, error: null };
      } catch (err) {
        warn(`[sibling-carry] ${payload.subtype}${payload.circleId ? ` for ${payload.circleId}` : ''} did not reach own device ${String(to).slice(0, 12)}… — it follows by catch-up: ${err?.message ?? err}`);
        return { to, delivered: false, held: false, error: err?.message ?? String(err) };
      }
    }));
    return { attempted: targets.length, skipped: null, outcomes };
  }

  return { carry };
}
