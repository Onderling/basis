/**
 * Post-join "share to this circle" — property layer.
 *
 * Lets an already-joined MEMBER push the coarse persona properties they now disclose to a circle
 * up to that circle's ADMIN, who records them on the roster (`stoop.recordMemberPersonaProperties`).
 * The general/post-join counterpart of the join-time capture that rides the redeem (`groupRedeem.js`):
 * same authority model (the admin owns the roster; webid == the mesh signing address, so a member
 * speaks only for their own row), a direct twin of the `group-redeem-request`/`-response` pattern.
 *
 * Three factories mirror groupRedeem's trio:
 *   - `makeSendPersonaPropsUpdate` (MEMBER side) — sends a `persona-props-update` envelope to the
 *     admin + awaits the matching `persona-props-ack` with a timeout (via a caller-owned pendingMap).
 *   - `makeHandlePersonaPropsUpdate` (ADMIN side) — records `fromAddr`'s properties onto the roster
 *     and replies `persona-props-ack`. Trusts `fromAddr` for the member identity, never the payload.
 *   - `makeHandlePersonaPropsAck` (MEMBER side) — resolves the pending promise.
 *
 * Plus `shareDisclosureToCircle` — the member-side orchestrator the "About me" surface calls: it
 * computes the persona's release for the circle, finds the admin, and routes local-vs-peer.
 *
 * ── Profile-update propagation (Phase-4 Wave B) ──────────────────────────────────────────────
 * Two things ride on top of that mechanism, both defined in `../../v2/rosterUpdated.js`:
 *
 *   • DIFF-GATE — only a REAL change propagates. The member side compares the freshly computed
 *     release against what it last shared with THIS circle (`createDisclosureShareMemo`) and
 *     returns a true no-op (no send, no roster write, no entry, no ack) when nothing moved. The
 *     admin side gates again at the source of truth: `stoop.recordMemberPersonaProperties`
 *     answers `{ok:true, unchanged:true}` without writing when the row already says that.
 *   • SILENT "pull-me" — after a real roster write the admin drops a silent typed entry on the
 *     circle stream (member ref + changed key NAMES, never values) and fans the same refs out;
 *     members re-read the changed rows from the roster. Injected as `announceRosterUpdate` so
 *     this module stays transport- and log-agnostic.
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
 * MEMBER-side outbound: send this member's disclosed persona properties for `groupId` to the admin
 * and await the ack. Mirror of `makeSendGroupRedeemRequest`.
 *
 * @param {object} args
 * @param {(addr: string, payload: object) => Promise<*>} args.sendPeer
 * @param {() => boolean}                                  [args.isPeerConnected]
 * @param {Map<string, {resolve: Function, reject: Function, timer?: any}>} args.pendingMap
 * @param {(groupId: string) => (string|null)}             [args.circleAddressFor]  present the per-circle address, like the redeem
 * @param {number}                                         [args.timeoutMs=30000]
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(args: {adminPeerAddr: string, groupId: string, personaProperties: object}) => Promise<{ok?: boolean, error?: string}>}
 */
export function makeSendPersonaPropsUpdate({
  sendPeer, isPeerConnected, pendingMap, circleAddressFor, timeoutMs = 30_000, logger = console,
} = {}) {
  if (typeof sendPeer !== 'function') {
    throw new Error('makeSendPersonaPropsUpdate: sendPeer required');
  }
  if (!pendingMap || typeof pendingMap.set !== 'function') {
    throw new Error('makeSendPersonaPropsUpdate: pendingMap required (Map-shaped)');
  }
  const peerUp = () => (typeof isPeerConnected !== 'function' ? true : !!isPeerConnected());

  return async function sendPersonaPropsUpdate({ adminPeerAddr, groupId, personaProperties }) {
    if (!peerUp()) {
      throw new Error('Peer transport not connected. Try /peer-connect first.');
    }
    // Present THIS device's per-circle address (like the redeem) so the update speaks the same
    // per-circle identity the admin already recorded. Additive — never block on its absence.
    let circleAddress = null;
    if (typeof circleAddressFor === 'function') {
      try { circleAddress = circleAddressFor(groupId) ?? null; }
      catch { circleAddress = null; }
    }
    const requestId = `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingMap.delete(requestId);
        reject(new Error('Admin did not confirm within 30 s. They may be offline — try again later.'));
      }, timeoutMs);
      pendingMap.set(requestId, { resolve, reject, timer });
    });
    try {
      await sendPeer(adminPeerAddr, {
        type:    'p2p-chat',
        subtype: 'persona-props-update',
        requestId,
        groupId,
        // Empty {} is a valid "I now share nothing here" — send it so the admin clears the slot.
        personaProperties: (personaProperties && typeof personaProperties === 'object') ? personaProperties : {},
        ...(circleAddress ? { circleAddress } : {}),
        sentAt: Date.now(),
      });
    } catch (err) {
      const entry = pendingMap.get(requestId);
      if (entry) {
        try { clearTimeout(entry.timer); } catch { /* defensive */ }
        pendingMap.delete(requestId);
      }
      logger.warn?.('[persona-props] send failed', adminPeerAddr, err);
      throw new Error(`Failed to reach admin over NKN: ${err?.message ?? err}`);
    }
    return promise;
  };
}

/**
 * ADMIN-side inbound: record the member's disclosed properties onto the roster + reply an ack.
 * Mirror of `makeHandleGroupRedeemRequest`.
 *
 * Diff-gated + pull-me (Wave B): the roster skill answers `{ok:true, unchanged:true}` when the row
 * already says this, and we then announce NOTHING — no silent entry, no fan-out. On a real change
 * `announceRosterUpdate` drops the silent pull-me entry + fans the refs out so members re-read.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(addr: string, payload: object) => Promise<*>}                  args.sendPeer
 * @param {(a:{circleId:string, memberRef:string, keys:string[]}) => *}    [args.announceRosterUpdate]
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => Promise<void>}
 *
 * NB the admin-local "🔄 … updated what they share" notification this used to publish is GONE:
 * the pinned model says a profile update is a SILENT system entry, not something that talks to
 * the admin. `announceRosterUpdate` is its replacement (and it reaches every member, not just here).
 */
export function makeHandlePersonaPropsUpdate({
  callSkill, sendPeer, announceRosterUpdate, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandlePersonaPropsUpdate: callSkill required');
  if (typeof sendPeer  !== 'function') throw new Error('makeHandlePersonaPropsUpdate: sendPeer required');

  return async function handlePersonaPropsUpdate(fromAddr, payload) {
    const { requestId, groupId, personaProperties, circleAddress } = payload ?? {};
    if (!requestId || !groupId) {
      logger.warn?.('[peer] persona-props-update missing fields', payload);
      return;
    }
    let reply;
    let changedKeys = [];
    try {
      const result = await callSkill('stoop', 'recordMemberPersonaProperties', {
        groupId,
        // Trust the authenticated peer address for the member identity, NEVER the payload — a member
        // can only speak for their own row (webid == the mesh signing address in this architecture).
        memberWebid: fromAddr,
        personaProperties: (personaProperties && typeof personaProperties === 'object') ? personaProperties : {},
        ...(circleAddress ? { circleAddress } : {}),
      });
      if (result?.ok === false) {
        reply = { error: result.reason ?? 'record-failed' };
      } else {
        // The roster is the diff authority: `unchanged` means it did NOT write, so nothing is
        // announced. `changedKeys` is what it did write (key names only).
        changedKeys = Array.isArray(result?.changedKeys) ? result.changedKeys : [];
        reply = result?.unchanged === true ? { ok: true, unchanged: true } : { ok: true };
      }
    } catch (err) {
      reply = { error: err?.message ?? String(err) };
    }
    // A REAL roster change → the silent pull-me entry + fan-out (no bubble, no wake). An
    // unchanged save announces nothing at all.
    if (reply.ok && !reply.unchanged) {
      try {
        await announceRosterUpdate?.({ circleId: groupId, memberRef: fromAddr, keys: changedKeys });
      } catch (err) {
        logger.warn?.('[peer] roster-updated announce failed', err?.message ?? err);
      }
    }
    try {
      await sendPeer(fromAddr, {
        type: 'p2p-chat', subtype: 'persona-props-ack', requestId, ...reply, sentAt: Date.now(),
      });
    } catch (err) {
      logger.error?.('[peer] persona-props-ack send failed', err);
    }
  };
}

/**
 * MEMBER-side inbound: resolve the pending update promise. Mirror of `makeHandleGroupRedeemResponse`.
 *
 * @param {object} args
 * @param {Map<string, {resolve: Function, timer?: any}>} args.pendingMap
 * @param {{info?, warn?, error?}}                         [args.logger]
 * @returns {(fromAddr: string, payload: object) => void}
 */
export function makeHandlePersonaPropsAck({ pendingMap, logger = console } = {}) {
  if (!pendingMap || typeof pendingMap.get !== 'function') {
    throw new Error('makeHandlePersonaPropsAck: pendingMap required (Map-shaped)');
  }
  return function handlePersonaPropsAck(_fromAddr, payload) {
    const requestId = payload?.requestId;
    const entry = pendingMap.get(requestId);
    if (!entry) {
      logger.warn?.('[peer] persona-props-ack with no pending entry', requestId);
      return;
    }
    if (entry.timer) { try { clearTimeout(entry.timer); } catch { /* defensive */ } }
    pendingMap.delete(requestId);
    entry.resolve(payload);
  };
}

/**
 * Member-side orchestrator behind the "About me" per-circle "share to this circle" button. Computes
 * the persona's release for the circle, finds the circle admin, then routes:
 *
 *   - LOCAL when there is no remote admin — this is the admin's OWN circle (`listGroupRoster`
 *     excludes self, so an admin viewing their own circle sees no admin entry) → record directly.
 *   - PEER otherwise — push the release to the admin over `persona-props-update`.
 *
 * An empty release ({}) still propagates: pressing "share" after toggling everything off is how a
 * member CLEARS what they disclosed. Returns `{ok:true, ...}` | `{ok:false, reason}`.
 *
 * DIFF-GATE (Wave B): with a `lastShared` memo wired, a save that changes NOTHING is a true no-op —
 * `{ok:true, via:'none', unchanged:true}` with no envelope sent, no roster write, no ack, no entry.
 * `selfRef`/`announceRosterUpdate` are only used on the LOCAL (I-am-the-admin) path: there this
 * device IS the roster, so it announces its own row; on the peer path the ADMIN announces.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(args: {adminPeerAddr: string, groupId: string, personaProperties: object}) => Promise<*>} [args.sendPersonaUpdate]
 * @param {string} args.circleId
 * @param {string} args.personaId
 * @param {{get: Function, set: Function}} [args.lastShared]   `createDisclosureShareMemo` instance
 * @param {(a:{circleId:string, memberRef:string, keys:string[]}) => *} [args.announceRosterUpdate]
 * @param {string} [args.selfRef]   my webid — the member ref the LOCAL announce carries
 * @returns {Promise<{ok: boolean, via?: 'local'|'peer'|'none', unchanged?: boolean, changedKeys?: string[], reason?: string}>}
 */
export async function shareDisclosureToCircle({
  callSkill, sendPersonaUpdate, circleId, personaId, lastShared, announceRosterUpdate, selfRef,
  resealMediaForCircle,
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
  // No memo (or nothing recorded yet) ⇒ we can't name the changed keys locally; the roster —
  // the source of truth — names them, and gates again if nothing actually moved. The memo keeps
  // the stable SOURCE refs (never the re-sealed copy) so the next unchanged save still no-ops.
  const remember = async () => {
    try { await lastShared?.set?.(circleId, personaId, personaProperties); } catch { /* best-effort */ }
  };

  // 2b. Media props (e.g. profilePicture) are RE-SEALED to THIS circle before they leave
  //     (Frits: option (a)): the injected resealer returns a COPY whose media refs are
  //     sealed with the circle's OWN key — so members can open them and no cross-circle
  //     key ever crosses. Only this outbound copy carries the circle-sealed refs; the
  //     diff-gate + memo above stay on the self-sealed source, so re-seal runs only on a
  //     real change.
  let toSend = personaProperties;
  if (typeof resealMediaForCircle === 'function') {
    try { toSend = (await resealMediaForCircle(personaProperties, circleId)) || personaProperties; }
    catch { toSend = personaProperties; }
  }

  // 3. Find the circle admin (excluded from listGroupRoster when it's ME → drives local-vs-peer).
  let adminAddr = null;
  try {
    const roster = await callSkill('stoop', 'listGroupRoster', { groupId: circleId });
    adminAddr = (Array.isArray(roster?.members) ? roster.members : []).find((m) => m?.role === 'admin')?.addr ?? null;
  } catch { adminAddr = null; }

  // 4a. No remote admin ⇒ I AM the admin of this circle ⇒ update my roster directly, then announce
  //     my own row (nobody else will — the pull-me always follows the roster WRITE).
  if (!adminAddr) {
    try {
      const r = await callSkill('stoop', 'recordMemberPersonaProperties', { groupId: circleId, personaProperties: toSend });
      if (r?.ok === false) return { ok: false, reason: r.reason ?? 'record-failed' };
      await remember();
      if (r?.unchanged === true) return { ok: true, via: 'local', unchanged: true, changedKeys: [] };
      const keys = Array.isArray(r?.changedKeys) ? r.changedKeys : (changedKeys ?? Object.keys(personaProperties));
      try {
        await announceRosterUpdate?.({ circleId, memberRef: selfRef ?? r?.memberWebid ?? '', keys });
      } catch { /* the roster is written; the signal is best-effort */ }
      return { ok: true, via: 'local', changedKeys: keys };
    } catch (err) { return { ok: false, reason: err?.message ?? 'record-failed' }; }
  }

  // 4b. Remote admin ⇒ push over peer. The ADMIN announces the pull-me after ITS roster write.
  if (typeof sendPersonaUpdate !== 'function') return { ok: false, reason: 'admin-unreachable' };
  try {
    const r = await sendPersonaUpdate({ adminPeerAddr: adminAddr, groupId: circleId, personaProperties: toSend });
    if (r && r.error) return { ok: false, reason: r.error };
    await remember();
    return { ok: true, via: 'peer', ...(r?.unchanged === true ? { unchanged: true, changedKeys: [] } : {}) };
  } catch (err) { return { ok: false, reason: err?.message ?? 'admin-unreachable' }; }
}
