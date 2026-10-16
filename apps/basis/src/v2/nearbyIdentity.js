/**
 * WHAT THE NEARBY ROOM IS TOLD ABOUT YOU — decided once, for both shells (the box has no room).
 *
 * The FACE: the same faces a circle offers — your display name (the default), your handle, or nobody — chosen per device
 * in "You here"; a label only, never an identity. The ADDRESSES ("share how to reach me", all-or-nothing by Frits'
 * call): the relay this device rides, and the NKN address only when the publication lock allows it (the same lock the
 * invite QR honours). A shell hands in only where its choice is stored and how it finds its relay and NKN address.
 */

/** The faces a device may show in the room. */
export const NEARBY_FACES = Object.freeze(['name', 'handle', 'none']);

/** A stored face choice, read: one of `NEARBY_FACES`; anything else is the default, your name. */
export function nearbyFaceChoice(raw) { return NEARBY_FACES.includes(raw) ? raw : 'name'; }

/**
 * @param {object} a
 * @param {() => string|null} a.readChoice                  the stored face choice (a shell's device-local store)
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {() => Promise<string|null>|string|null} [a.relayUrl]   the relay this device rides
 * @param {() => boolean} [a.shareNkn]                      the publication lock (true = the NKN address may be shared)
 * @param {() => string|null} [a.nknAddress]                this device's NKN address
 * @param {() => ({id: string, name?: string|null}|null)} [a.roomSelf]  the self this device enters the room as (`nearbyRoomSelf`)
 * @returns {{ myFace: () => Promise<{label: string}|null>, myAddresses: () => Promise<object> }}
 */
export function createNearbyIdentity({ readChoice, callSkill, relayUrl = () => null, shareNkn = () => false, nknAddress = () => null, roomSelf = () => null } = {}) {
  return {
    async myFace() {
      try {
        const choice = nearbyFaceChoice(readChoice?.());
        if (choice === 'none') return null;
        // while the room ASKS who enters (several selves ticked, none chosen), no face: the question first — never the
        // general persona's name by default. A PERSONA shows its own name (it has no handle of the general persona's).
        const self = roomSelf?.() ?? null;
        if (self?.asking === true) return null;
        if (self && self.id !== 'default') return self.name ? { label: String(self.name) } : null;
        const e = (await callSkill?.('stoop', 'getMyProfile', {}))?.entry ?? {};
        const label = choice === 'handle' ? (e.handle ?? null) : (e.displayName ?? e.handle ?? null);
        return label ? { label: String(label) } : null;
      } catch { return null; }
    },
    async myAddresses() {
      const out = {};
      try { const url = await relayUrl(); if (url) out.relay = { url }; } catch { /* no relay is honest */ }
      try {
        const addr = nknAddress();
        if (shareNkn() === true && typeof addr === 'string' && addr) out.nkn = { address: addr };
      } catch { /* the lock stays closed on a broken read */ }
      return out;
    },
  };
}

/**
 * WHO ENTERS THE ROOM — it follows the switcher's set: one self ticked enters, no question; several → the last answer
 * (kept per device) while it is still ticked, else the room asks once. Until the room has an address per self, this is a
 * LABEL: the room can still tell two faces come from one device (the screen says so).
 * @param {{active: string[], held?: Array<{id: string}>, remembered?: string|null}} a
 * @returns {{self: string|null, ask: boolean, choices: string[]}}
 */
export function nearbyRoomSelf({ active = [], held = [], remembered = null } = {}) {
  const ids = new Set((held ?? []).map((h) => h?.id));
  const choices = (Array.isArray(active) ? active : []).filter((id) => !held?.length || ids.has(id));
  if (choices.length === 1) return { self: choices[0], ask: false, choices };
  if (remembered && choices.includes(remembered)) return { self: remembered, ask: false, choices };
  return { self: null, ask: choices.length > 1, choices };
}

/**
 * The room self as a painter shows it: "Je verschijnt hier als <naam>" (the general persona by the switcher's word), or
 * the one question when several selves are ticked and none was chosen yet — each choice named the same way.
 * @param {{self: string|null, ask: boolean, choices: string[]}} r  `nearbyRoomSelf`'s answer
 * @param {Array<{id: string, name?: string|null}>} held
 */
export function nearbyRoomSelfView(r, held = []) {
  const named = (id) => (id === 'default' ? { id, nameKey: 'circle.switcher.you' } : { id, name: (held ?? []).find((h) => h?.id === id)?.name ?? id });
  return { ask: r?.ask === true, self: r?.self ? named(r.self) : null, choices: (r?.choices ?? []).map(named) };
}

/**
 * What a shell hands the face as its room self: the chosen self (`{id, name}`), `{asking: true}` while the room asks — an
 * explicit state, so the face says nothing rather than falling back to the general persona — or null (one self: the
 * general persona as before).
 * @param {{self: string|null, ask: boolean}} r  `nearbyRoomSelf`'s answer
 * @param {Array<{id: string, name?: string|null}>} held
 */
export function roomSelfFor(r, held = []) {
  if (r?.ask) return { asking: true };
  if (!r?.self) return null;
  const h = (held ?? []).find((p) => p?.id === r.self);
  return h ? { id: h.id, name: h.name ?? null } : { id: r.self };
}
