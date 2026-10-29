/**
 * profileFactsSync — a person's own devices keep each profile's FACTS the same, without a pod.
 *
 * A profile's facts are what the person curates on it: its properties (a name, a place, a picture, drivers…), the
 * inheritance markers and its disclosure policy (`profileFactsOf` in the agent registry). Without a pod the registry
 * lives on each device alone, so an edit on the phone reached the circles (the `member-props` statements) but not the
 * laptop's registry — and the laptop re-released the OLD values on its next edit. This carries the facts between the
 * devices that hold the same self, merged PER KEY (each property and disclosure entry from the side that wrote it last,
 * `mergeProfileFacts` in the agent registry; until 2026-10-26 the newer facts won whole and two devices editing
 * different facts at once lost one):
 *   • LIVE — the facts changed here (any writer: the registry's one write seam stamps the changed keys and fans): to this
 *     self's siblings.
 *   • CATCH-UP — on connect a device asks its siblings; each answers with its facts, and each key's newer side stands.
 * Per SELF: a persona's facts travel only between the devices holding that persona, over its own sibling addresses,
 * and a landing is bound to a self by WHO SENT IT (its proven sibling set), never by anything the payload says.
 * The registry's machine keys (device records, memberships, owned nodes) never ride: each has its own lane.
 *
 * Pure — no DOM, no RN, no transport import. The agent injects the sends, the sibling lookup and the registry reads.
 */
import { makeSiblingCarry } from './siblingCarry.js';
import { mergeProfileFacts } from '@onderling/agent-registry';

export const PROFILE_FACTS_CARRY = 'device-profile-facts';
export const PROFILE_FACTS_CATCHUP_SUBTYPES = Object.freeze({ request: 'device-profile-facts-request' });

const validFacts = (p) => p && typeof p === 'object' && Number.isFinite(p.factsAt)
  && p.properties && typeof p.properties === 'object' && !Array.isArray(p.properties)
  && p.disclosure && typeof p.disclosure === 'object';

/**
 * @param {object} a
 * @param {() => Promise<string[]>} a.siblings  this self's other proven device addresses
 * @param {(to: string, payload: object, opts?: object) => Promise<any>} a.sendToPeer  sends AS this self
 * @param {() => Promise<{properties: object, disclosure: object, factsAt: number|null}|null>} a.current  this device's facts
 * @param {(facts: {properties: object, disclosure: object, factsAt: number}) => Promise<any>} a.store  land newer facts
 *   (the registry write that does NOT fan back out)
 * @param {(info: {from: string, factsAt: number}) => void} [a.onLanded]
 * @param {(reason: string, from: string) => void} [a.onRefused]
 */
export function createProfileFactsSync({ siblings, sendToPeer, current, store, onLanded = null, onRefused = null } = {}) {
  if (typeof siblings !== 'function' || typeof sendToPeer !== 'function' || typeof current !== 'function' || typeof store !== 'function') {
    throw new Error('profileFactsSync: `siblings`, `sendToPeer`, `current` and `store` are required');
  }
  const refuse = (reason, from) => { try { onRefused?.(reason, from); } catch { /* observability never throws */ } };
  // the ONE sibling carry (siblingCarry.js) for the live facts and the catch-up ask; an answer is a reply to one device
  const { carry } = makeSiblingCarry({ siblings: () => siblings(), sendToPeer, onWarn: () => {} });
  const admits = async (fromAddr) => { try { return ((await siblings()) ?? []).includes(fromAddr); } catch { return false; } };
  const wire = (f) => ({ subtype: PROFILE_FACTS_CARRY, properties: f.properties, disclosure: f.disclosure, factsAt: f.factsAt, keyTimes: f.keyTimes ?? {} });
  const mine = async () => { try { return await current(); } catch { return null; } };

  return {
    subtypes: { carry: PROFILE_FACTS_CARRY, ...PROFILE_FACTS_CATCHUP_SUBTYPES },
    /** Is `fromAddr` one of THIS self's proven sibling addresses? */
    admits,

    /** LIVE: this self's facts changed here — carry them to its other devices. */
    async fan() {
      const f = await mine();
      if (!validFacts(f)) return { attempted: 0 };
      const r = await carry(wire(f));   // a sibling that misses it asks on connect
      return { attempted: r.attempted };
    },

    /** CATCH-UP: ask this self's devices for their facts (the newer stand). */
    async requestFromSiblings() {
      const r = await carry({ subtype: PROFILE_FACTS_CATCHUP_SUBTYPES.request }, { quiet: true });
      return { requested: r.outcomes.filter((o) => !o.error).length };
    },

    handlers: {
      [PROFILE_FACTS_CARRY]: async (fromAddr, payload) => {
        if (payload?.subtype !== PROFILE_FACTS_CARRY) return;
        if (!(await admits(fromAddr))) { refuse('not-a-sibling', fromAddr); return; }
        if (!validFacts(payload)) { refuse('malformed', fromAddr); return; }
        const here = await mine();
        // PER KEY: each fact from the side that wrote it last; a copy that brings nothing newer changes nothing
        const there = { properties: payload.properties, disclosure: payload.disclosure, factsAt: payload.factsAt,
          keyTimes: payload.keyTimes && typeof payload.keyTimes === 'object' ? payload.keyTimes : {} };
        const merged = here ? mergeProfileFacts(here, there) : there;
        if (here && JSON.stringify([merged.properties, merged.disclosure, merged.keyTimes ?? {}]) === JSON.stringify([here.properties, here.disclosure, here.keyTimes ?? {}])) return;
        try { await store(merged); }
        catch { return; /* the next carry or catch-up retries */ }
        try { onLanded?.({ from: fromAddr, factsAt: payload.factsAt }); } catch { /* observability never throws */ }
      },
      [PROFILE_FACTS_CATCHUP_SUBTYPES.request]: async (fromAddr, payload) => {
        if (payload?.subtype !== PROFILE_FACTS_CATCHUP_SUBTYPES.request) return;
        if (!(await admits(fromAddr))) { refuse('not-a-sibling', fromAddr); return; }
        const f = await mine();
        if (!validFacts(f)) return;   // nothing stamped here yet: nothing to say
        try { await sendToPeer(fromAddr, wire(f), { guarantee: 'hold-forward' }); } catch { /* it asks again */ }
      },
    },
  };
}

/**
 * ONE LANE, FACTS PER SELF: a landing goes to the self whose proven sibling set the sender is in — never to a self the
 * payload names — and a sender that is no self's sibling is refused.
 * @param {object} a
 * @param {() => Array<ReturnType<typeof createProfileFactsSync>>} a.all  every held self's sync
 * @param {(pid: string|null) => (ReturnType<typeof createProfileFactsSync>|null)} a.forSelf  one self's sync
 * @param {(reason: string, from: string) => void} [a.onRefused]
 */
export function routeProfileFactsBySender({ all, forSelf, onRefused = null } = {}) {
  if (typeof all !== 'function' || typeof forSelf !== 'function') throw new Error('routeProfileFactsBySender: `all` and `forSelf` are required');
  const owner = async (fromAddr) => { for (const s of (all() ?? []).filter(Boolean)) { try { if (await s.admits(fromAddr)) return s; } catch { /* next self */ } } return null; };
  const route = (subtype) => async (fromAddr, payload) => {
    if (payload?.subtype !== subtype) return;
    const s = await owner(fromAddr);
    if (!s) { try { onRefused?.('not-a-sibling', fromAddr); } catch { /* observability never throws */ } return; }
    await s.handlers[subtype](fromAddr, payload);
  };
  return {
    subtypes: { carry: PROFILE_FACTS_CARRY, ...PROFILE_FACTS_CATCHUP_SUBTYPES },
    handlers: { [PROFILE_FACTS_CARRY]: route(PROFILE_FACTS_CARRY), [PROFILE_FACTS_CATCHUP_SUBTYPES.request]: route(PROFILE_FACTS_CATCHUP_SUBTYPES.request) },
    /** LIVE: one self's facts changed here. */
    fanFor: (pid) => { const s = forSelf(pid); return s ? s.fan() : Promise.resolve({ attempted: 0, skipped: 'no-self' }); },
    /** CATCH-UP over every held self. */
    async requestFromSiblings() {
      let requested = 0;
      for (const s of (all() ?? []).filter(Boolean)) { try { requested += (await s.requestFromSiblings())?.requested ?? 0; } catch { /* next self */ } }
      return { requested };
    },
  };
}
