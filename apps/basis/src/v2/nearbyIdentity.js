/**
 * WHAT THE NEARBY ROOM IS TOLD ABOUT YOU — decided once, for both shells (the box has no room).
 *
 * The FACE: derived from the room self's LEVEL (nearbyLevel.js — the person's, on the self's disclosure, not the
 * device's); a label only, never an identity. The ADDRESSES ("share how to reach me", all-or-nothing by Frits'
 * call): the relay this device rides, and the NKN address only when the publication lock allows it (the same lock the
 * invite QR honours). A shell hands in only how it finds its relay and NKN address.
 */
import { nearbyLevelFrom, nearbyLevelIsSet, NEARBY_CONTEXT } from './nearbyLevel.js';

/**
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {() => Promise<string|null>|string|null} [a.relayUrl]   the relay this device rides
 * @param {() => boolean} [a.shareNkn]                      the publication lock (true = the NKN address may be shared)
 * @param {() => string|null} [a.nknAddress]                this device's NKN address
 * @param {() => ({id: string, name?: string|null}|null)} [a.roomSelf]  the self this device enters the room as (`nearbyRoomSelf`)
 * @returns {{ myFace: () => Promise<{label: string}|null>, myAddresses: () => Promise<object> }}
 */
export function createNearbyIdentity({ callSkill, relayUrl = () => null, shareNkn = () => false, nknAddress = () => null, roomSelf = () => null } = {}) {
  // the room self's offerings as last read (the screen's shared-skills line reads them synchronously)
  let offeringsNow = [];
  return {
    /**
     * THE ROOM SELF's drivers, read on this device and never sent — what an ask arriving in the room is weighed against:
     * its EFFECTIVE drivers (its own and what it inherits; never the general persona's offerings when it said no —
     * `getProfileDrivers` resolves that). While the room asks who enters: none.
     * @returns {Promise<Record<string, object>>}
     */
    async getDrivers() {
      const self = roomSelf?.() ?? null;
      if (self?.asking === true) { offeringsNow = []; return {}; }
      let drivers = {};
      try { drivers = (await callSkill?.('agents', 'getProfileDrivers', { id: self?.id ?? 'default' }))?.drivers ?? {}; } catch { drivers = {}; }
      offeringsNow = Object.values(drivers).filter((d) => d && typeof d === 'object' && d.kind === 'offering');
      return drivers;
    },
    /** The room self's offerings, as the shared-skills line shows them (from the last `getDrivers`). */
    mySkills() { return offeringsNow; },
    /** The room self's Nearby level (its disclosure under `nearby`; nothing set → `handle`). While the room asks: none. */
    async level() { return (await this.levelState()).level; },
    /** The level and whether the self chose one (`set`) — the first-use question asks only when it did not. */
    async levelState() {
      const self = roomSelf?.() ?? null;
      // no self entering (none held, or the room still asks): nothing is shown — never the general persona by default
      if (!self?.id || self.asking === true) return { level: 'none', set: false };
      try {
        const disclosure = (await callSkill?.('agents', 'getProfileDisclosure', { id: self.id }))?.disclosure;
        return { level: nearbyLevelFrom(disclosure), set: nearbyLevelIsSet(disclosure) };
      } catch { return { level: 'handle', set: false }; }
    },
    /**
     * Set the room self's level — through the one writer (`setNearbyLevel`), for THAT self. While the room asks who
     * enters there is no self to set it for.
     * @returns {Promise<{ok: boolean, reason?: string}>}
     */
    async setLevel(level) {
      const self = roomSelf?.() ?? null;
      if (self?.asking === true) return { ok: false, reason: 'asking' };
      if (!self?.id) return { ok: false, reason: 'not-a-self-here' };
      try { return (await callSkill?.('household', 'setNearbyLevel', { personaId: self.id, level })) ?? { ok: false, reason: 'no-answer' }; }
      catch (err) { return { ok: false, reason: String(err?.message ?? err) }; }
    },
    /**
     * THE FACE the room is told — derived from the room self's level, never from anything else the app knows: `none` →
     * none; a PERSONA → its own name (its pseudonym) at every level; the general persona → its handle at `handle`, its
     * presented name above it. While the room asks who enters: none.
     */
    async myFace() {
      try {
        const self = roomSelf?.() ?? null;
        if (self?.asking === true) return null;
        const level = await this.level();
        if (level === 'none') return null;
        if (self && self.id !== 'default') return self.name ? { label: String(self.name) } : null;
        const e = (await callSkill?.('pinboard', 'getMyProfile', {}))?.entry ?? {};
        const label = level === 'handle' ? (e.handle ?? null) : (e.displayName ?? e.handle ?? null);
        return label ? { label: String(label) } : null;
      } catch { return null; }
    },
    /**
     * A card PREFILL from the room self ("vul in vanuit <naam>"): ONLY what its `nearby` release gives — nothing of
     * another self, never a marker key. The person sees it and sends it (the card itself stays typed: authored).
     * @returns {Promise<{label?: string}>}
     */
    async cardPrefill() {
      const self = roomSelf?.() ?? null;
      if (!self?.id || self.asking === true) return {};
      let released = {};
      try { released = (await callSkill?.('agents', 'getPersonaRelease', { id: self.id, contextId: NEARBY_CONTEXT }))?.released ?? {}; } catch { released = {}; }
      const pick = (k) => (typeof released?.[k] === 'string' && released[k].trim() ? released[k].trim() : (typeof released?.[k]?.value === 'string' ? released[k].value : null));
      const label = pick('realName') ?? pick('handle');
      return label ? { label } : {};
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
