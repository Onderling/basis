/**
 * circleFollowSync — SIBLINGS FOLLOW A CIRCLE (L109 option A, Frits 2026-09-21).
 *
 * The architecture: every device of the person is in every circle of the person; the kring opt-out (sync-policy
 * §11) is the one exception, and it is the device's choice, not an accident. Until now that was true at enrol only
 * — the offer named the circles that existed then — and false afterwards: a circle one device founded or joined
 * later (the pair circle the box makes with a visitor; a kring joined on the phone) never reached the others.
 * Measured 2026-09-19: the maker's laptop held two circles, the box five.
 *
 * Now: a device that founds or joins a circle CARRIES it to its siblings — the same `{id, handle, address, relays}`
 * entry an enrol offer holds, over the one sibling carry, sibling-gated like the grants lane — and a sibling that
 * hears it runs the SAME per-circle step the enrol consume runs (`consumeCircleEntry`: the registry record, presence,
 * the roster seed from the sibling, the announce, the lanes' pulls). Continuous and symmetric; the enrol path
 * reused, not copied. The offline half: on connect a device asks its siblings for their circles and joins what it
 * lacks. A kring the person switched OFF on this device is not joined; a circle this device is in is left alone;
 * a landing in flight is not run twice.
 *
 * Nothing here decides membership: the sibling's roster seed and the lanes' catch-ups do, exactly as at enrol.
 *
 * THE LEAVE FOLLOWS TOO (2026-09-22). A circle left on one device is left on the person's others: the leaving
 * device carries `device-circle-left`, and a sibling still in that circle runs its LOCAL leave — the unbinding,
 * the presence gone, the address off the relays, the registry record off — WITHOUT a statement of its own: the sibling's
 * self-signed `leave` on the circle's lane already folded the person out everywhere, and a second one would only
 * be refused. The carry hands the leave STATEMENT along (the leaving device's own, signed): the receiver ingests it
 * through its membership rail like any statement, so its own fold says "left" — one record, no marker. (The membership
 * fan skips the author's own person, so a sibling hears it here, not on the lane; this carry retires when statements
 * fan to a person's own devices.) The offline half: the answer to "which circles are you in" names what the answerer
 * LEFT (its fold says so), each with its statement, so a
 * device that slept through the leave leaves on connect; a carry never re-joins a circle a sibling has left.
 */
import { makeSiblingCarry } from './siblingCarry.js';

export const CIRCLE_FOLLOW_SUBTYPES = Object.freeze({
  carry:   'device-circle-joined',    // "I am in this circle now" — the entry a sibling can join from
  left:    'device-circle-left',      // "I left this circle" — a sibling still in it leaves too (2026-09-22)
  request: 'device-circles-request',  // "which circles are you in?" — answered with one carry per circle, then one left per circle left
});

const validEntry = (c) => c && typeof c === 'object' && typeof c.id === 'string' && c.id && typeof c.address === 'string' && c.address;

/**
 * @param {object} a
 * @param {(circleId?: string) => Promise<string[]>} a.siblings  the person's other proven device addresses — with no circle,
 *   every one (as any of the person's selves); with a circle, the devices of THAT circle's self (a persona's: those holding it)
 * @param {(to: string, payload: object, opts?: object) => Promise<any>} a.sendToPeer
 * @param {() => Promise<Array<{id: string, handle?: string|null, address: string, relays?: string[]}>>} a.myEntries
 *   the circles THIS device is in, each as the entry a sibling joins from (this device's per-circle address)
 * @param {(circleId: string) => Promise<boolean>} a.isIn   is this device in the circle already?
 * @param {(circleId: string) => boolean} [a.kringOn]        the device's kring opt-out (`syncSelection.kringOn`)
 * @param {(entry: object) => Promise<{circleId: string, ok: boolean, steps: string[]}>} a.consume
 *   the per-circle enrol step, composed by the shell with its seams (presence, the content pulls)
 * @param {() => Promise<string[]>} [a.myLeft]   the circles THIS device has left (as its membership fold says) — the answer's second half
 * @param {(circleId: string) => Promise<{ok: boolean}>} [a.leave]   the local leave, without a statement (the agent's)
 * @param {(circleId: string) => (object|null)} [a.leaveStatementOf]   this device's own signed `leave` for the circle
 * @param {(circleId: string, statement: object) => Promise<object>} [a.ingestLeave]   ingest a sibling's signed `leave`
 *   through this device's membership rail (verified there like any statement)
 * @param {(r: {from: string, circleId: string, ok: boolean, steps: string[]}) => void} [a.onLanded]
 */
export function createCircleFollowSync({ siblings, sendToPeer, myEntries, isIn, kringOn = () => true, consume, myLeft = null, leave = null, leaveStatementOf = null, ingestLeave = null, onLanded = null, sightOf = null, setSight = null } = {}) {
  if (typeof siblings !== 'function') throw new Error('circleFollowSync: a `siblings` lookup is required');
  if (typeof sendToPeer !== 'function') throw new Error('circleFollowSync: `sendToPeer` is required');
  if (typeof myEntries !== 'function' || typeof isIn !== 'function' || typeof consume !== 'function') throw new Error('circleFollowSync: `myEntries`, `isIn` and `consume` are required');

  const isSibling = async (fromAddr) => {
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { return false; }
    return addrs.includes(fromAddr);
  };
  const wire = (circle) => ({ subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle });
  // the ONE sibling carry (siblingCarry.js): a circle's entry to the devices holding that circle's self (its nested id)
  const { carry } = makeSiblingCarry({ siblings: (p) => siblings(p?.circle?.id), sendToPeer, onWarn: () => {} });
  // NESTED, like the carry's `circle`: a top-level `circleId` is what the sibling send reads as the circle to SPEAK IN,
  // and the circle just left is the one circle it must not speak in (the sibling table names the ones still shared).
  const leftWire = async (circleId) => {
    let statement = null;
    try { statement = typeof leaveStatementOf === 'function' ? ((await leaveStatementOf(circleId)) ?? null) : null; } catch { statement = null; }
    return { subtype: CIRCLE_FOLLOW_SUBTYPES.left, circle: { id: circleId }, ...(statement ? { statement } : {}) };
  };
  const leftHere = new Set();   // circles a sibling told us it left this session — a later carry for one is not a re-join
  const landedListeners = new Set();   // the shells' observability (a box's walk log) beside the composer's `onLanded`
  const inFlight = new Map();   // circleId → the landing's promise: a re-sent carry joins it, never runs the step twice

  /** The local leave, once per circle per session. `force`: the fold already took this device out (no "am I in it"). */
  async function landLeft(fromAddr, circleId, { force = false } = {}) {
    if (leftHere.has(circleId)) return null;
    if (!force && !(await isIn(circleId))) return null;
    leftHere.add(circleId);
    if (typeof leave !== 'function') return null;                  // a composition without the step leaves nothing
    let ok = false;
    try { ok = (await leave(circleId))?.ok === true; } catch { ok = false; }
    const summary = { from: fromAddr, circleId, ok, steps: ['left'] };
    try { onLanded?.(summary); } catch { /* observability never throws */ }
    for (const fn of landedListeners) { try { fn(summary); } catch { /* observability never throws */ } }
    return summary;
  }

  /**
   * PUT AWAY (opbergen, Frits 2026-09-24): the entry carries the circle's SIGHT mark `{ putAway, at }` — a person-level
   * fact, the newer change wins on every device. Only the mark moves; nothing about the circle's membership does.
   */
  async function landSight(circleId, sight) {
    if (typeof setSight !== 'function' || !sight || typeof sight.putAway !== 'boolean' || !Number.isFinite(sight.at)) return;
    let mine = null;
    try { mine = typeof sightOf === 'function' ? await sightOf(circleId) : null; } catch { mine = null; }
    if (Number.isFinite(mine?.at) && mine.at >= sight.at) return;   // older (or the same) news
    try { await setSight(circleId, { putAway: sight.putAway, at: sight.at }); } catch { return; /* the next carry retries */ }
    // the mark changed what this device shows: the shells' listeners repaint (no `onLanded` log line — nothing joined)
    const summary = { from: null, circleId, ok: true, steps: ['sight'] };
    for (const fn of landedListeners) { try { fn(summary); } catch { /* observability never throws */ } }
  }

  async function land(fromAddr, circle) {
    if (leftHere.has(circle.id)) return null;                        // a sibling left it: a carry is not a re-join
    if (inFlight.has(circle.id)) return inFlight.get(circle.id);
    const p = (async () => {
      try {
        if (await isIn(circle.id)) { await landSight(circle.id, circle.sight); return null; }
        let on = true; try { on = kringOn(circle.id) !== false; } catch { on = true; }
        if (!on) return null;                                       // the person switched this kring off here
        const r = await consume(circle);
        if (r?.ok === true) await landSight(circle.id, circle.sight);   // joined with the mark it arrived with
        const summary = { from: fromAddr, circleId: circle.id, ok: r?.ok === true, steps: Array.isArray(r?.steps) ? r.steps : [] };
        try { onLanded?.(summary); } catch { /* observability never throws */ }
        for (const fn of landedListeners) { try { fn(summary); } catch { /* observability never throws */ } }
        return summary;
      } finally { inFlight.delete(circle.id); }
    })();
    inFlight.set(circle.id, p);
    return p;
  }

  return {
    subtypes: CIRCLE_FOLLOW_SUBTYPES,
    /** Subscribe to landings (`{from, circleId, ok, steps}`); returns the unsubscribe. */
    onLanded(fn) { if (typeof fn === 'function') landedListeners.add(fn); return () => landedListeners.delete(fn); },

    /** LIVE: this device just founded or joined `circleId` — tell every sibling. */
    async fanJoined(circleId) {
      let entries = [];
      try { entries = (await myEntries()) ?? []; } catch { return { attempted: 0 }; }
      const circle = entries.find((e) => e?.id === circleId);
      if (!validEntry(circle)) return { attempted: 0 };
      // to the siblings of the circle's own self (a persona's circle: only the devices holding that persona); one that
      // misses it asks on connect
      return { attempted: (await carry(wire(circle))).attempted };
    },

    /** LIVE: the person put `circleId` away here, or took it out — the entry carries the new mark to every sibling. */
    async fanSight(circleId) { return this.fanJoined(circleId); },

    /** LIVE: this device just left `circleId` — tell every sibling. */
    async fanLeft(circleId) {
      if (typeof circleId !== 'string' || !circleId) return { attempted: 0 };
      return { attempted: (await carry(await leftWire(circleId))).attempted };
    },

    /**
     * THE FOLD TOOK THIS DEVICE'S SELF OUT of `circleId` (an admin's `evict`, or a leave the lane brought): run the
     * local leave once, if this device is still in the circle.
     */
    async foldedOut(circleId) {
      if (typeof circleId !== 'string' || !circleId) return null;
      return landLeft(null, circleId, { force: true });
    },

    /** CATCH-UP: ask every sibling which circles it is in; each answers with one carry per circle, then one left per circle left. */
    async requestFromSiblings() {
      const r = await carry({ subtype: CIRCLE_FOLLOW_SUBTYPES.request }, { sendOpts: { holdKey: CIRCLE_FOLLOW_SUBTYPES.request }, quiet: true });
      return { requested: r.outcomes.filter((o) => !o.error).length };
    },

    handlers: {
      [CIRCLE_FOLLOW_SUBTYPES.carry]: async (fromAddr, payload) => {
        if (payload?.subtype !== CIRCLE_FOLLOW_SUBTYPES.carry) return;
        if (!validEntry(payload.circle)) return;
        if (!(await isSibling(fromAddr))) return;                      // only a device of mine may put me in a circle
        await land(fromAddr, payload.circle);
      },
      [CIRCLE_FOLLOW_SUBTYPES.request]: async (fromAddr, payload) => {
        if (payload?.subtype !== CIRCLE_FOLLOW_SUBTYPES.request) return;
        if (!(await isSibling(fromAddr))) return;
        let entries = [];
        try { entries = (await myEntries()) ?? []; } catch { return; }
        for (const circle of entries.filter(validEntry)) {
          // only to a device of the circle's OWN self: a persona's circle to the devices holding that persona, the general
          // persona's to the general persona's — never one self's circles told over another's address
          let theirs = [];
          try { theirs = (await siblings(circle.id)) ?? []; } catch { theirs = []; }
          if (!theirs.includes(fromAddr)) continue;
          try { await sendToPeer(fromAddr, wire(circle), { guarantee: 'hold-forward' }); } catch { /* the sibling asks again */ }
        }
        // …then what this device LEFT, so a sibling that slept through a leave leaves on connect
        let left = [];
        try { left = typeof myLeft === 'function' ? ((await myLeft()) ?? []) : []; } catch { left = []; }
        for (const circleId of left.filter((id) => typeof id === 'string' && id)) {
          let theirs = [];
          try { theirs = (await siblings(circleId)) ?? []; } catch { theirs = []; }
          if (!theirs.includes(fromAddr)) continue;
          try { await sendToPeer(fromAddr, await leftWire(circleId), { guarantee: 'hold-forward' }); } catch { /* the sibling asks again */ }
        }
      },
      [CIRCLE_FOLLOW_SUBTYPES.left]: async (fromAddr, payload) => {
        if (payload?.subtype !== CIRCLE_FOLLOW_SUBTYPES.left) return;
        const circleId = payload.circle?.id;
        if (typeof circleId !== 'string' || !circleId) return;
        if (!(await isSibling(fromAddr))) return;                      // only a device of mine may take me out of a circle
        if (!(await isIn(circleId))) { leftHere.add(circleId); return; }   // a circle I am not in is nothing
        // the leave itself onto this device's lane: its fold then says left (and the rail's hook may already run the
        // local leave; `landLeft` below is once per circle either way)
        if (payload.statement && typeof ingestLeave === 'function') {
          try { await ingestLeave(circleId, payload.statement); } catch { /* the landing below still leaves locally */ }
        }
        await landLeft(fromAddr, circleId, { force: true });
      },
    },
  };
}
