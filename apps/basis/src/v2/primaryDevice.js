/**
 * primaryDevice — WHICH of the person's devices others' direct messages land on (sync-policy §12, the DM half;
 * Frits 2026-09-17, option (b)).
 *
 * A direct message goes to the profile address, and on a relay that address belongs to whichever of the person's
 * devices registered it last — the always-on box, as a rule. The choice made on Mij / My data ("make this my primary
 * contact address") now also names the PRIMARY DEVICE: that device registers the profile address and the person
 * address on every relay as `primary`, the others register plainly and stand by (the relay delivers to a primary
 * socket while one lives, and falls to a standby when it is gone). Circle traffic is unchanged: it goes to the
 * primary per-circle address on the roster row (#128), where the same tap put it.
 *
 * The choice is a PERSONAL fact of the person's device set — `{ deviceId, at }` — kept in the sealed chat vault and
 * carried to the siblings over the one sibling carry, sibling-gated like the grants lane: a device takes a claim
 * only from a proven own-device address, and a newer claim (by `at`, ties by deviceId) supersedes. A freshly
 * enrolled device asks its siblings for the current claim on connect. No choice yet → every device registers
 * plainly, as before, so nothing changes until the person taps.
 *
 * Stated, not closed: this orders the person's HONEST devices. A stolen device holds the profile key and registers
 * like any of them — nothing on a relay binds it to the choice. The window after a revoke for a card-only contact
 * (alpha plan W4) closes with a per-contact channel, not here.
 */

export const PRIMARY_DEVICE_VAULT_KEY = 'primary-device';
export const PRIMARY_DEVICE_SUBTYPES = Object.freeze({
  carry:   'primary-device-carry',
  request: 'primary-device-request',
});

function claimOf(o) {
  if (!o || typeof o !== 'object') return null;
  if (typeof o.deviceId !== 'string' || !o.deviceId || !Number.isFinite(o.at)) return null;
  return { deviceId: o.deviceId, at: o.at };
}
/** Does `next` supersede `cur`? Newer wins; the same moment resolves by the smaller deviceId on every replica. */
export function claimSupersedes(next, cur) {
  if (!next) return false;
  if (!cur) return true;
  if (next.at !== cur.at) return next.at > cur.at;
  return next.deviceId !== cur.deviceId && next.deviceId < cur.deviceId;
}

/**
 * @param {object} a
 * @param {object} a.vault             the sealed chat vault (`get`/`set`)
 * @param {string|null} a.myDeviceId   this device's id (the delegation record's); null on a device from before ids
 * @param {() => Promise<string[]>} a.siblings   the person's other proven device addresses
 * @param {(to: string, payload: object, opts?: object) => Promise<any>} a.sendToPeer   hold-forward send to a sibling
 * @param {(isMine: boolean) => any} [a.onChanged]   the host re-registers on the relays with the new flag
 * @param {() => number} [a.now]
 */
export function createPrimaryDeviceChoice({ vault, myDeviceId = null, siblings, sendToPeer, onChanged = null, now = () => Date.now() } = {}) {
  if (typeof siblings !== 'function') throw new Error('primaryDevice: a `siblings` lookup is required');
  if (typeof sendToPeer !== 'function') throw new Error('primaryDevice: `sendToPeer` is required');
  let claim = null;
  let loaded = false;

  async function load() {
    if (loaded) return claim;
    loaded = true;
    try {
      const raw = await vault?.get?.(PRIMARY_DEVICE_VAULT_KEY);
      claim = claimOf(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch { claim = null; }
    return claim;
  }
  async function store(next) {
    claim = next;
    try { await vault?.set?.(PRIMARY_DEVICE_VAULT_KEY, JSON.stringify(next)); } catch { /* the carry still runs; the next boot asks */ }
  }
  const isMine = () => !!claim && !!myDeviceId && claim.deviceId === myDeviceId;
  const changed = (was) => { const now_ = isMine(); if (now_ !== was && typeof onChanged === 'function') { try { onChanged(now_); } catch { /* re-registration is best-effort */ } } };
  const isSibling = async (fromAddr) => {
    let addrs = [];
    try { addrs = (await siblings()) ?? []; } catch { return false; }
    return addrs.includes(fromAddr);
  };
  const wire = (c) => ({ subtype: PRIMARY_DEVICE_SUBTYPES.carry, deviceId: c.deviceId, at: c.at });

  return {
    load,
    /** The current claim, or null. */
    current: () => claim,
    /** Is THIS device the primary? (null claim → false: plain registration, as before) */
    isMine,
    /** "Make this device my primary": claim it, carry it to every sibling, and re-register on the relays. */
    async claim() {
      await load();
      if (!myDeviceId) return { ok: false, reason: 'no-device-id' };
      const was = isMine();
      const next = { deviceId: myDeviceId, at: Math.max(now(), (claim?.at ?? 0) + 1) };
      await store(next);
      changed(was);
      let attempted = 0;
      try {
        const addrs = (await siblings()) ?? [];
        await Promise.all(addrs.map(async (to) => { attempted += 1; try { await sendToPeer(to, wire(next), { guarantee: 'hold-forward' }); } catch { /* follows by request */ } }));
      } catch { /* no siblings reachable now; they ask on connect */ }
      return { ok: true, claim: next, attempted };
    },
    /** A fresh device asks its siblings for the current claim. */
    async requestFromSiblings() {
      let addrs = [];
      try { addrs = (await siblings()) ?? []; } catch { return { attempted: 0 }; }
      await Promise.all(addrs.map((to) => sendToPeer(to, { subtype: PRIMARY_DEVICE_SUBTYPES.request }, { holdKey: PRIMARY_DEVICE_SUBTYPES.request }).catch(() => {})));
      return { attempted: addrs.length };
    },
    handlers: {
      [PRIMARY_DEVICE_SUBTYPES.carry]: async (fromAddr, payload) => {
        if (payload?.subtype !== PRIMARY_DEVICE_SUBTYPES.carry) return;
        if (!(await isSibling(fromAddr))) return;                    // only a device of mine may say who is primary
        const next = claimOf(payload);
        await load();
        if (!claimSupersedes(next, claim)) return;
        const was = isMine();
        await store(next);
        changed(was);
      },
      [PRIMARY_DEVICE_SUBTYPES.request]: async (fromAddr, payload) => {
        if (payload?.subtype !== PRIMARY_DEVICE_SUBTYPES.request) return;
        if (!(await isSibling(fromAddr))) return;
        await load();
        if (!claim) return;                                          // nothing chosen: silence, not an empty claim
        try { await sendToPeer(fromAddr, wire(claim), { guarantee: 'hold-forward' }); } catch { /* the sibling asks again */ }
      },
    },
  };
}
