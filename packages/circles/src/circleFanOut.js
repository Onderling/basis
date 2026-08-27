/**
 * `createCircleFanOut(deps)` — the ONE circle-broadcast fan the whole
 * `broadcastCircle*` family rides. Lifted verbatim out of stoop's `buildSkills`
 * so the roster-fan, transport choice, delivery-state accounting, the
 * data-move (pod) branch, and the `{sent, attempted, errors}` return contract
 * live once, in the circles substrate, and cannot drift across the callers
 * (invariant 3 — logic lives once).
 *
 * Pure lift via dependency injection: this module is self-contained given its
 * `deps` and imports NOTHING from an app (packages never depend UP on apps).
 * Everything the fan closes over is injected:
 *
 *   - `chat`                  the wireChat controller (`chat.send`).
 *   - `members`               the MemberMap (`members.list`, `.resolveByWebid`).
 *   - `store`                 the circle's ItemStore (roster/exit projections).
 *   - `metrics`               UsageMetrics (`metrics.record`).
 *   - `bundle`                host bundle (`reliableSend`, `podWrite`,
 *                             `circleDataMove`).
 *   - `preferCircleAddress`   route to each member's per-circle address.
 *   - `allowAddressFallback`  may a send fall back to the member's global key
 *                             (boolean OR a function read per-fan).
 *
 *   - `projectCircleRoster`   the per-circle membership projection (shared with
 *                             the roster skill — injected, not owned here).
 *   - `readCircleExits`       the circle's exit set (shared — injected).
 *   - `isExited`              exit predicate (shared — injected).
 *   - `fanOutViaReliableSend` the reliable-sender fan (stoop keeps it — it
 *                             closes over the member-address resolver).
 *   - `fanOutToMembers`       the bus-local `chat.send` fan (stoop keeps it).
 *   - `toWireRefEnvelope`     the pod-ref envelope projector (from
 *                             `@onderling/item-store` — injected so this
 *                             package needs no item-store dependency).
 *
 * @param {object} deps
 * @returns {(a:object)=>Promise<object>} the `broadcastToCircle` function.
 */
export function createCircleFanOut({
  chat,
  members,
  store,
  metrics,
  bundle,
  preferCircleAddress = false,
  allowAddressFallback = true,
  projectCircleRoster,
  readCircleExits,
  isExited,
  fanOutViaReliableSend,
  fanOutToMembers,
  toWireRefEnvelope,
} = {}) {
  /**
   * Resolve the circle's data-MOVE branch: `'fan-out-full' | 'pod-signal' |
   * 'pod-only'`. The host owns the ONE data-policy resolver (basis
   * `circleDataMove` over the circle's stored `policy.pod`) and injects the
   * decision as `bundle.circleDataMove(circleId)` — so the send path branches
   * on the policy WITHOUT an app→app import. The resolver may be sync or async.
   * Absent / unknown / throwing → 'fan-out-full' (the honest default: with no
   * pod posture known, the envelope must carry the data — today's only real
   * path).
   */
  async function resolveCircleDataMove(circleId) {
    const resolver = bundle?.circleDataMove;
    if (typeof resolver !== 'function') return 'fan-out-full';
    try {
      const r = resolver(circleId);
      const move = (r && typeof r.then === 'function') ? await r : r;
      return (move === 'pod-signal' || move === 'pod-only') ? move : 'fan-out-full';
    } catch { return 'fan-out-full'; }
  }

  async function broadcastToCircle({ circleId, kind, from, body = '', extras = {}, metric = null, envelope = null, noWake = false, only = null, alsoTo = null }) {
    // Relay wake-gate (§ residual server-side wake work): a broadcast marked
    // `noWake` is hold-forwarded to offline members but must NOT fire an OS push
    // wake — routine governance events (individual votes/resolves) and reports
    // are noise; only a decision OPENING wakes a device. We stamp the wire flag
    // the relay honours (`envelope.noWake`, see @onderling/relay wakePayload
    // `envelopeSuppressesWake`) onto BOTH transport shapes: the synthesised wire
    // envelope (reliable-send path) AND `extras` (the chat.send fallback rebuilds
    // its payload from subtype+extras). Chat/policy/rules/recipe never set it, so
    // they wake as before — fully backward compatible.
    if (noWake) extras = { ...extras, noWake: true };
    // Prefer the RELIABLE sender for EVERY broadcast, not just chat (which passes an
    // `envelope`). It resolves webid→pubKey + hold-forwards; the bus-local `chat.send`
    // fallback cannot resolve the mesh address, so a control-plane broadcast (policy / rules /
    // recipe / governance / report — no `envelope`) failed "No pubKey registered" over the
    // mesh. When there is no `envelope`, we synthesise a wire one from `subtype + extras` so
    // the receiver routes + ingests it identically. `chat.send` stays the fallback when no
    // reliable sender is wired.
    const reliableSend = (typeof bundle?.reliableSend === 'function') ? bundle.reliableSend : null;
    if (!reliableSend && !chat?.send) return { error: 'chat-unavailable', sent: 0, attempted: 0, errors: [] };
    if (!members)                     return { error: 'members-unavailable', sent: 0, attempted: 0, errors: [] };

    // ── Who the recipients ARE (2026-07-30) ────────────────────────────────
    // THIS CIRCLE's roster — the same trail-derived projection `listGroupMembers` returns — not the
    // device's global `MemberMap`. The MemberMap carries no circle on a row, so fanning over it sent
    // every circle's message to every member of every OTHER circle this device ever admitted (dead
    // test peers included: their rows persist), while a member this device knows ONLY from the trail
    // was never sent to at all. That second half is a JOINER's normal state: `recordRemoteRedemption`
    // writes only the joiner's own row, so the admin exists solely as `confirmedBy` on the trail —
    // which is why joiner→admin chat silently never left the device while admin→joiner worked, and why
    // catch-up (roster-driven) reached the peer the chat fan-out could not.
    // No trail (legacy seeded single-circle) → `null` → the MemberMap, exactly as before.
    let memberMapList = [];
    try { memberMapList = (await members.list()) ?? []; } catch { memberMapList = []; }
    const roster = await projectCircleRoster({ store, groupId: circleId, memberMapList });
    // The no-trail fallback fans over the global MemberMap, so it must drop this circle's
    // exits itself; otherwise a removed member keeps receiving the circle's traffic.
    const fanExits = roster ? null : await readCircleExits({ store, groupId: circleId });
    const fanMembers = roster
      ? { list: async () => roster, resolveByWebid: (w) => members.resolveByWebid(w) }
      : (fanExits && fanExits.size > 0
        ? {
          list: async () => ((await members.list()) ?? []).filter((m) => !isExited(fanExits, m?.webid ?? '', 0)),
          resolveByWebid: (w) => members.resolveByWebid(w),
        }
        : members);

    // ── ONE RECIPIENT WHO IS DELIBERATELY NOT ON THE ROSTER ────────────────
    // `only` narrows the fan; this widens it, by exactly the addresses the caller names. The case
    // it exists for is an EVICTION: the statement that removes someone is the one message they most
    // need, and by the time it goes out the roster no longer contains them — so the fan that
    // resolves members would reach everyone EXCEPT the person it is about (F-011).
    //
    // Kept narrow on purpose. This is not a general "send to anyone" door: the caller supplies a
    // webid it has just written a signed statement about, and the receiver still verifies that
    // statement at its own rail before anything lands.
    const extraTo = (Array.isArray(alsoTo) ? alsoTo : []).filter((w) => typeof w === 'string' && w && w !== from);

    // A WEBID IS NOT AN ADDRESS. The widening above used to hand the fan a bare `{ webid }`, and a row
    // with no `circleAddress` sends `resolveMemberAddress` down to its `resolveByWebid` rung — the
    // MemberMap, which by this point no longer holds the person being removed. With no per-circle
    // address and the global-key fallback refused by the privacy default, it answered
    // `blocked-by-setting`, the fan reported `recipient-pubkey-unknown`, and the eviction notice was
    // not merely late — it was never sent.
    //
    // So the widening was real and the delivery was not: an evicted device showed an unchanged circle,
    // an unchanged roster and a working composer, with NOTHING in its console (walked 2026-08-27).
    //
    // The address is not missing, only filtered. This device holds the person's trail row with the
    // per-circle address they PROVED on joining — the roster projection simply drops them once they
    // are exited, which is right for the roster and wrong for the one message that has to outlive it.
    // So read the trail directly for these recipients, and keep every field the ladder uses.
    const extraRows = new Map();
    if (extraTo.length) {
      try {
        const rows = (await store.listOpen({ type: 'membership-redemption' })) ?? [];
        for (const it of rows) {
          const src = it?.source ?? {};
          if (src.groupId !== circleId) continue;
          const who = src.redeemedBy;
          if (typeof who !== 'string' || !extraTo.includes(who)) continue;
          const prev = extraRows.get(who) ?? { webid: who };
          extraRows.set(who, {
            ...prev,
            circleAddress:      prev.circleAddress ?? src.circleAddress ?? null,
            circleAddresses:    prev.circleAddresses ?? src.circleAddresses ?? null,
            circleAddressProof: prev.circleAddressProof ?? src.circleAddressProof ?? null,
          });
        }
      } catch { /* no trail readable → the bare row below, exactly as before */ }
    }

    const fanTargets = extraTo.length
      ? {
        list: async () => {
          const base = (await fanMembers.list()) ?? [];
          const seen = new Set(base.map((m) => (typeof m === 'string' ? m : (m?.webid ?? m?.webId))));
          return [...base, ...extraTo.filter((w) => !seen.has(w)).map((webid) => extraRows.get(webid) ?? { webid })];
        },
        resolveByWebid: (w) => fanMembers.resolveByWebid(w),
      }
      : fanMembers;

    // ── The data-move branch ───────────────────────────────────────────────
    // The circle's data-policy (`policy.pod`) decides HOW a message moves; we
    // consult it here, ABOVE the transport choice (reliableSend vs chat.send).
    const dataMove = await resolveCircleDataMove(circleId);
    if ((dataMove === 'pod-signal' || dataMove === 'pod-only') && envelope) {
      // A REAL shared pod is written HERE, then peers are either
      // signalled with a REF envelope (`pod-signal`: `toWireRefEnvelope`, the
      // body replaced by the pod-row `ref`) or left to read the pod themselves
      // (`pod-only`, no fan). The pod write is the host-injected `bundle.podWrite`
      // seam — it SEALS the canonical Envelope with the circle's EXISTING
      // sealing path (the seal resolver) and stores it under the range-queryable
      // row key (see @onderling/pod-client `writeSealedMessage`), returning that
      // row's opaque `ref`. Only the CHAT path carries a wire `envelope`, so the
      // pod log is scoped to chat history; control-plane broadcasts (recipe /
      // rules / policy) have no envelope and fan-out-full unchanged.
      //
      // No `podWrite` wired, or the write fails / yields no ref → DEGRADE to
      // fan-out-full, EXPLICITLY + loudly (never silently), so the message
      // still reaches every member.
      const podWrite = typeof bundle?.podWrite === 'function' ? bundle.podWrite : null;
      if (podWrite) {
        let ref = null;
        try {
          const res = await podWrite(circleId, envelope);
          ref = (res && typeof res === 'object') ? (res.ref ?? null) : (typeof res === 'string' ? res : null);
        } catch (err) {
          console.warn(`[broadcastToCircle] podWrite for circle ${circleId} failed → degrading to fan-out-full:`, err?.message ?? err);
        }
        if (ref) {
          if (dataMove === 'pod-only') {
            // No fan: every member reads the pod itself (getMessagesSince / catch-up).
            if (metric) metrics?.record?.(metric);
            return { sent: 0, attempted: 0, errors: [], podOnly: true, ref };
          }
          // pod-signal: fan the REF envelope (the pod-row pointer) in place of
          // the full-body envelope, over the SAME transport the full fan uses.
          const refEnvelope = toWireRefEnvelope({
            circleId, msgId: envelope.msgId, ts: envelope.ts, ref,
            fromActor: envelope.fromActor ?? null, fromWebid: envelope.fromWebid ?? null,
            media: envelope.media,
            subtype: envelope.subtype,   // the ref routes to the same receive path the full envelope would
          });
          // NOTE (unchanged here, worth a look on its own): this ref fan passes no `circleId` /
          // `preferCircleAddress`, so unlike the full fan below it still routes to members' GLOBAL
          // keys rather than their per-circle addresses.
          const refFan = reliableSend
            ? await fanOutViaReliableSend({ members: fanTargets, reliableSend, selfWebid: from, envelope: refEnvelope })
            : await fanOutToMembers({ members: fanTargets, chat, selfWebid: from, subtype: kind, threadId: circleId, body: '', extras: { ...extras, ref } });
          if (metric) metrics?.record?.(metric);
          return { sent: refFan.sent, attempted: refFan.attempted, errors: refFan.errors, podSignal: true, ref };
        }
      } else {
        console.info(`[broadcastToCircle] data-policy for circle ${circleId} selected ${dataMove}; no podWrite wired → degrading to fan-out-full`);
      }
      // fall through — fan-out-full is the honest degrade target when the pod
      // write is absent or failed.
    }

    // The wire object the reliable path sends: chat passes a real `envelope`; a control-plane
    // broadcast has none, so synthesise `{ subtype: kind, ...extras }` — the same shape the
    // chat.send fallback would produce as the receiver's payload (routed by `subtype`).
    const wire = envelope ?? { subtype: kind, ...extras };
    const { sent, attempted, errors } = reliableSend
      ? await fanOutViaReliableSend({
        members: fanTargets, reliableSend, selfWebid: from, envelope: wire, only, circleId, preferCircleAddress,
        allowFallback: allowAddressFallback,
      })
      : await fanOutToMembers({ members: fanTargets, chat, selfWebid: from, subtype: kind, threadId: circleId, body, extras, only });
    if (metric) metrics?.record?.(metric);
    return { sent, attempted, errors };
  }

  return broadcastToCircle;
}
