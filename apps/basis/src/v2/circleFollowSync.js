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
 */

export const CIRCLE_FOLLOW_SUBTYPES = Object.freeze({
  carry:   'device-circle-joined',    // "I am in this circle now" — the entry a sibling can join from
  request: 'device-circles-request',  // "which circles are you in?" — answered with one carry per circle
});

const validEntry = (c) => c && typeof c === 'object' && typeof c.id === 'string' && c.id && typeof c.address === 'string' && c.address;

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings     the person's other proven device addresses
 * @param {(to: string, payload: object, opts?: object) => Promise<any>} a.sendToPeer
 * @param {() => Promise<Array<{id: string, handle?: string|null, address: string, relays?: string[]}>>} a.myEntries
 *   the circles THIS device is in, each as the entry a sibling joins from (this device's per-circle address)
 * @param {(circleId: string) => Promise<boolean>} a.isIn   is this device in the circle already?
 * @param {(circleId: string) => boolean} [a.kringOn]        the device's kring opt-out (`syncSelection.kringOn`)
 * @param {(entry: object) => Promise<{circleId: string, ok: boolean, steps: string[]}>} a.consume
 *   the per-circle enrol step, composed by the shell with its seams (presence, the content pulls)
 * @param {(r: {from: string, circleId: string, ok: boolean, steps: string[]}) => void} [a.onLanded]
 */
export function createCircleFollowSync({ siblings, sendToPeer, myEntries, isIn, kringOn = () => true, consume, onLanded = null } = {}) {
  if (typeof siblings !== 'function') throw new Error('circleFollowSync: a `siblings` lookup is required');
  if (typeof sendToPeer !== 'function') throw new Error('circleFollowSync: `sendToPeer` is required');
  if (typeof myEntries !== 'function' || typeof isIn !== 'function' || typeof consume !== 'function') throw new Error('circleFollowSync: `myEntries`, `isIn` and `consume` are required');

  const isSibling = async (fromAddr) => {
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { return false; }
    return addrs.includes(fromAddr);
  };
  const wire = (circle) => ({ subtype: CIRCLE_FOLLOW_SUBTYPES.carry, circle });
  const landedListeners = new Set();   // the shells' observability (a box's walk log) beside the composer's `onLanded`
  const inFlight = new Map();   // circleId → the landing's promise: a re-sent carry joins it, never runs the step twice

  async function land(fromAddr, circle) {
    if (inFlight.has(circle.id)) return inFlight.get(circle.id);
    const p = (async () => {
      try {
        if (await isIn(circle.id)) return null;
        let on = true; try { on = kringOn(circle.id) !== false; } catch { on = true; }
        if (!on) return null;                                       // the person switched this kring off here
        const r = await consume(circle);
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
      let addrs = [];
      try { addrs = (await siblings()) ?? []; } catch { return { attempted: 0 }; }
      let attempted = 0;
      await Promise.all(addrs.map(async (to) => { attempted += 1; try { await sendToPeer(to, wire(circle), { guarantee: 'hold-forward' }); } catch { /* the sibling asks on connect */ } }));
      return { attempted };
    },

    /** CATCH-UP: ask every sibling which circles it is in; each answers with one carry per circle. */
    async requestFromSiblings() {
      let addrs = [];
      try { addrs = (await siblings()) ?? []; } catch { return { requested: 0 }; }
      let requested = 0;
      for (const to of addrs) {
        try { await sendToPeer(to, { subtype: CIRCLE_FOLLOW_SUBTYPES.request }, { holdKey: CIRCLE_FOLLOW_SUBTYPES.request }); requested += 1; } catch { /* next sibling */ }
      }
      return { requested };
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
          try { await sendToPeer(fromAddr, wire(circle), { guarantee: 'hold-forward' }); } catch { /* the sibling asks again */ }
        }
      },
    },
  };
}
