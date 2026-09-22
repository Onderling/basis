/**
 * "Share to this circle" — the property layer, ON THE MEMBERSHIP LANE (step two of
 * `NOTE-member-props-on-the-membership-lane.md`, 2026-09-22).
 *
 * A member's persona discloses a coarse, reveal-gated RELEASE per circle (`agents.getPersonaRelease`). This module's
 * orchestrator, `shareDisclosureToCircle`, computes that release, re-seals its media to the circle (by reference),
 * and SAYS it as one self-signed `member-props` statement on that circle's lane — `personaProperties`, one map that
 * wins whole at the fold — so every member's device folds it onto the roster row, the box included, and no admin is
 * in the loop.
 *
 * Until 2026-09-22 the release travelled by an admin-mediated side wire (`persona-props-update` → the admin wrote the
 * roster → `persona-props-ack`, plus a silent `roster-updated` "pull-me" the admin fanned): two handlers, a pending
 * map and an ack on both shells, and a member who could not reach the admin could not update their own row. The lane
 * is the road now; the wire is retired. What survives of it unchanged:
 *
 *   • DIFF-GATE — only a REAL change travels. The member side compares the freshly computed release against what it
 *     last said to THIS circle (`createDisclosureShareMemo`, keyed per persona × circle, on the self-sealed SOURCE so
 *     an unchanged picture never re-seals) and returns a true no-op when nothing moved. The lane's writer gates again
 *     against what the fold holds (`emitMemberProps`: an unchanged map appends nothing).
 *   • REVEAL-GATING — everything downstream only ever sees the release; the persona's private values never leave.
 */

import { releaseUnchanged, changedReleaseKeys } from '../../v2/rosterUpdated.js';

/**
 * The member-side "what did I last share with this circle?" memo — the diff-gate's left-hand side.
 * A tiny store over an injectable io (web passes a localStorage io, mobile an AsyncStorage io;
 * tests pass nothing and get the in-memory default), exactly like `surfacePref`'s store. Keyed per
 * (persona, circle) because disclosure is per-circle AND per-persona.
 *
 * Without a memo the gate simply falls through to the admin-side diff — still no roster write and
 * still no pull-me entry, just one wasted envelope. With it, an open-and-save-unchanged is a true
 * no-op end to end.
 *
 * @param {{get?: (key:string)=>any, set?: (key:string, value:any)=>any}} [io]
 */
export function createDisclosureShareMemo(io = {}) {
  const cache = new Map();
  const keyFor = (circleId, personaId) => `${personaId ?? 'default'}::${circleId}`;
  return {
    /** @returns {Promise<object|null>} the release last shared with this circle, if known */
    async get(circleId, personaId) {
      const key = keyFor(circleId, personaId);
      if (cache.has(key)) return cache.get(key);
      let value = null;
      try { value = (await io.get?.(key)) ?? null; } catch { value = null; }
      cache.set(key, value);
      return value;
    },
    async set(circleId, personaId, props) {
      const key = keyFor(circleId, personaId);
      const value = (props && typeof props === 'object') ? props : {};
      cache.set(key, value);
      try { await io.set?.(key, value); } catch { /* the in-memory half still gates this session */ }
    },
  };
}

/** localStorage io for `createDisclosureShareMemo` (web; mobile passes an AsyncStorage-backed one). */
export function localStorageDisclosureShareIo(storage = globalThis.localStorage) {
  const KEY_PREFIX = 'cc.sharedDisclosure.';
  return {
    get(key) {
      try { const raw = storage?.getItem?.(KEY_PREFIX + key); return raw ? JSON.parse(raw) : null; }
      catch { return null; }
    },
    set(key, value) {
      try { storage?.setItem?.(KEY_PREFIX + key, JSON.stringify(value ?? {})); } catch { /* quota/private mode */ }
    },
  };
}
/**
 * The orchestrator behind the "About me" per-circle "share to this circle" button. Computes the persona's release for
 * the circle, gates it, re-seals its media, and says it on the circle's membership lane.
 *
 * An empty release ({}) still travels: pressing "share" after toggling everything off is how a member CLEARS what
 * they disclosed. Returns `{ok:true, via:'lane', changedKeys}` · `{ok:true, via:'none'|'lane', unchanged:true}` ·
 * `{ok:false, reason}`.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(a: {circleIds: string[], props: object}) => Promise<{ok?: boolean, error?: string, emitted: string[], unchanged: string[], failed: string[]}>} args.emitMemberProps
 *   the agent's `member-props` writer (one statement per circle, the fold's diff gate inside)
 * @param {string} args.circleId
 * @param {string} args.personaId
 * @param {{get: Function, set: Function}} [args.lastShared]   `createDisclosureShareMemo` instance
 * @param {(props: object, circleId: string) => Promise<object>} [args.resealMediaForCircle]
 * @returns {Promise<{ok: boolean, via?: 'lane'|'none', unchanged?: boolean, changedKeys?: string[], reason?: string}>}
 */
export async function shareDisclosureToCircle({
  callSkill, emitMemberProps, circleId, personaId, lastShared, resealMediaForCircle,
}) {
  if (typeof callSkill !== 'function') return { ok: false, reason: 'callSkill-required' };
  if (!circleId || !personaId) return { ok: false, reason: 'missing-args' };

  // 1. What this persona discloses in THIS circle (its release for the context). Reveal-gating
  //    happens HERE and nowhere else: everything downstream only ever sees this release.
  let personaProperties = {};
  try {
    const rel = await callSkill('agents', 'getPersonaRelease', { id: personaId, contextId: circleId });
    personaProperties = (rel?.released && typeof rel.released === 'object') ? rel.released : {};
  } catch { personaProperties = {}; }

  // 2. DIFF-GATE — open-the-editor-and-save-unchanged must do nothing at all. Runs on the
  //    self-sealed SOURCE release (the stable refs), BEFORE any re-seal — so an unchanged
  //    picture short-circuits here and never triggers a needless open+reseal+upload.
  let changedKeys = null;
  if (lastShared && typeof lastShared.get === 'function') {
    const previous = await lastShared.get(circleId, personaId);
    if (previous !== null && releaseUnchanged(previous, personaProperties)) {
      return { ok: true, via: 'none', unchanged: true, changedKeys: [] };
    }
    changedKeys = previous === null ? null : changedReleaseKeys(previous, personaProperties);
  }
  if (typeof emitMemberProps !== 'function') return { ok: false, reason: 'no-lane' };

  // 2b. Media props (e.g. profilePicture) are RE-SEALED to THIS circle before they leave: the injected resealer
  //     returns a COPY whose media refs are sealed with the circle's OWN key — so members can open them and no
  //     cross-circle key ever crosses. Only this outbound copy carries the circle-sealed refs; the diff-gate + memo
  //     above stay on the self-sealed source, so re-seal runs only on a real change.
  let toSay = personaProperties;
  if (typeof resealMediaForCircle === 'function') {
    try { toSay = (await resealMediaForCircle(personaProperties, circleId)) || personaProperties; }
    catch { toSay = personaProperties; }
  }

  // 3. SAY IT — one `member-props` on this circle's lane. The writer's own gate compares against what the fold
  //    holds; a failed append is reported (the next share retries it), never swallowed.
  let r = null;
  try { r = await emitMemberProps({ circleIds: [circleId], props: { personaProperties: toSay } }); }
  catch (err) { return { ok: false, reason: err?.message ?? 'append-failed' }; }
  if (r?.error) return { ok: false, reason: r.error };
  if (Array.isArray(r?.failed) && r.failed.includes(circleId)) return { ok: false, reason: 'append-failed' };
  try { await lastShared?.set?.(circleId, personaId, personaProperties); } catch { /* best-effort */ }
  if (Array.isArray(r?.unchanged) && r.unchanged.includes(circleId)) return { ok: true, via: 'lane', unchanged: true, changedKeys: [] };
  return { ok: true, via: 'lane', changedKeys: changedKeys ?? Object.keys(personaProperties) };
}
