/**
 * circleLanes — the peer-router entries for the SIGNED LANES, built once for every shell.
 *
 * Five lanes carry a circle between devices: membership, governance, chat, tasks and keys. Each one
 * is a signed rail plus a catch-up for whoever was offline, and each needs one entry in the inbound
 * router for the fan and two or three for the catch-up. Alongside them ride the personal lanes — the
 * grants a connection was given, the roster seed a freshly enrolled device asks for, and the turns a
 * person's own devices hand each other.
 *
 * All of that was written out TWICE, once in each shell, in the two largest files in the repo, and the
 * two copies say the same thing down to the comments ("web parity", "same wiring as the web shell").
 * That is the duplication invariant 3 forbids, and it had already cost something: the web shell
 * silently had no entry at all for three kinds the mobile shell handles. Nothing failed. Those
 * messages simply arrived and went nowhere.
 *
 * So this is the one place the table is written. A shell passes its agent and its own reactions —
 * what to repaint, where to keep a projection, how to ask a question — and gets back the entries plus
 * the catch-up handles it kicks on connect. It decides nothing: every reaction is injected, and a
 * shell that wants a lane it has no rail for simply gets no entry for it, exactly as before.
 *
 * There is a THIRD caller by design: a headless device on a server is a full member of its owner's
 * circles with no screen at all. It composes this same table with reactions that only store, which is
 * what makes "the always-on device is just another device" true in code rather than in intent.
 *
 * Pure — no DOM, no React, no transport import. Everything platform-shaped arrives as a function.
 */

import { makeGovernanceCatchUp } from './governanceCatchUp.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST, MEMBERSHIP_CATCHUP_SUBTYPES } from './membershipRail.js';
import { makeSyncSelection, HOLD_EVERYTHING } from './syncSelection.js';
import { GRANTS_BROADCAST } from './grantsRail.js';
import { makeTaskPeerHandler, TASK_BROADCAST, TASK_CATCHUP_SUBTYPES } from './taskRail.js';
import { makeFrontierReplay } from './frontierReplay.js';
import { makeChatPeerHandler, makePodChatCatchUp, CHAT_STATEMENT_BROADCAST, CHAT_CATCHUP_SUBTYPES } from './chatRail.js';
import { KEY_STATEMENT_BROADCAST, KEY_CATCHUP_SUBTYPES, makeKeyPeerHandler } from './keyRail.js';

/** A no-op reaction, so every hook is optional and a missing one is silence rather than a crash. */
const NOOP = () => {};

/**
 * Hand a statement that just LANDED from a member to the person's other devices — the receiving half of the
 * one sibling carry (`siblingCarry.js`). The payload is the lane's own wire shape, so a sibling's rail lands
 * it through the very handler a member's fan reaches. Best-effort: catch-up reconciles what this misses.
 * Exported so a harness that composes its own router can carry through the same function.
 */
export function carryLandedStatement({ carry, subtype, circleId, statement, fromPeerAddr, msgId = null }) {
  if (typeof carry !== 'function' || !statement) return Promise.resolve(null);
  const payload = { subtype, circleId, event: statement, ts: Date.now(), ...(msgId ? { msgId } : {}) };
  return Promise.resolve(carry(payload, { from: fromPeerAddr ?? null })).catch(() => null);
}

/**
 * Build the lane half of a shell's peer-router table.
 *
 * @param {object} a
 * @param {object} a.agent  the basis agent — its rails (`chatRail`, `taskRail`, `keyRail`,
 *   `membershipRail`), its ready-made receivers (`grantsPeerHandler`, `grantsCatchUp`, `rosterSeed`,
 *   `contactTurnHandler`, `knownPeersSync`) and `rosterReads`. A rail this agent does not have yields no entry.
 * @param {(addr: string, payload: object, opts?: object) => any} [a.sendToPeer]
 *   how a catch-up asks; defaults to the agent's own send.
 * @param {object|null} [a.govRail]  the governance rail (each shell builds its own today).
 * @param {object|null} [a.eventLog] the device log, for the pod-only chat read-back.
 * @param {Function} [a.resolveRef]  resolve a fanned pod REF to its sealed row (chat).
 * @param {Function} [a.podReadSince] · @param {Function} [a.dataMoveFor]  the pod-only chat read-back.
 * @param {Function} [a.extraGovStatementsFor]  the durable-head serve for the governance catch-up.
 * @param {object} [a.on]  the shell's reactions, all optional:
 *   `govChange(circleId)` · `keyChange(circleId)` · `membershipChange(circleId)` ·
 *   `chatLanded({msgId, circleId, fromPeerAddr, source})` · `chatChange(circleId)` ·
 *   `chatCatchUpOffer({circleId, count, approxBytes, allow})` · `chatRefused({circleId, fromPeerAddr, reason})` ·
 *   `ownDeviceTurn(wire)`.
 * @returns {{ handlers: Object<string, Function>, catchUps: object, chatStatementHandler: object|null, landedCarrier: {governance: Function} }}
 *   `handlers` is spread into the router; `catchUps` holds `{gov, membership, key, task, chat, podChat}`
 *   for the connect-time kicks, each null when its rail is absent.
 */
export function buildCircleLanes({
  agent,
  sendToPeer = null,
  govRail = null,
  eventLog = null,
  resolveRef = null,
  podReadSince = null,
  dataMoveFor = null,
  extraGovStatementsFor = null,
  on = {},
} = {}) {
  if (!agent) throw new Error('buildCircleLanes: an agent is required');
  const send = typeof sendToPeer === 'function'
    ? sendToPeer
    : (addr, payload, opts) => agent.sendPeerMessage?.(addr, payload, opts);
  const {
    govChange = NOOP, keyChange = NOOP, membershipChange = null,
    chatLanded = NOOP, chatChange = NOOP, chatCatchUpOffer = null, chatRefused = null,
    ownDeviceTurn = null,
  } = on;

  // A landed membership batch changes the roster, so the cached reads must go. A shell may add its own
  // reaction on top; this part is not its choice, which is why it is the default rather than a hook.
  const onMembership = (circleId) => {
    try { agent.rosterReads?.invalidate(circleId); } catch { /* a cache that will not clear is not fatal */ }
    try { membershipChange?.(circleId); } catch { /* the shell's reaction never breaks ingest */ }
  };

  // ── the catch-ups ────────────────────────────────────────────────────────────────────────────
  // Where a request goes: each other member's PER-CIRCLE address from the derived roster; the global key only when
  // the person allows the address fallback (the same gate the fan's resolver reads). Never this device's own row.
  const aim = { selfWebid: agent.identity?.chat?.pubKey ?? agent.pubKey ?? null, allowGlobal: () => agent.addressFallbackOn?.() === true };
  const gov = govRail ? makeGovernanceCatchUp({
    rail: govRail,
    sendToPeer: send,
    ...aim,
    onChange: govChange,
    // The durable-head serve: a member offline past the lane's audit window still receives the
    // preserved, originally-signed rules-update statement — the final setting never deletes.
    ...(typeof extraGovStatementsFor === 'function' ? { extraStatementsFor: extraGovStatementsFor } : {}),
  }) : null;

  const membership = agent.membershipRail ? makeGovernanceCatchUp({
    rail: agent.membershipRail,
    sendToPeer: send,
    ...aim,
    subtypes: MEMBERSHIP_CATCHUP_SUBTYPES,
    onChange: onMembership,
  }) : null;

  // Pull-all for keys — one small statement per version, so a long-offline or freshly enrolled device
  // converges on the circle's whole key chain rather than a window of it.
  const key = agent.keyRail ? makeGovernanceCatchUp({
    rail: agent.keyRail,
    sendToPeer: send,
    ...aim,
    subtypes: KEY_CATCHUP_SUBTYPES,
    onChange: keyChange,
  }) : null;

  // Content lanes never pull all of it. Tasks replay from the receiver's frontier, paging as needed,
  // and the serve set includes signed snapshots of live heads whose entries have aged out of the lane.
  const task = agent.taskRail ? makeFrontierReplay({
    rail: agent.taskRail,
    sendToPeer: send,
    ...aim,
    subtypes: TASK_CATCHUP_SUBTYPES,
    statementsFor: (circleId) => agent.taskRail.catchUpStatements(circleId),
  }) : null;

  // Chat replays the same way, with one rung above it: past the auto-allow ceiling the person is asked
  // the real question, in whatever way this shell asks questions.
  const chat = agent.chatRail ? makeFrontierReplay({
    rail: agent.chatRail,
    sendToPeer: send,
    ...aim,
    subtypes: CHAT_CATCHUP_SUBTYPES,
    onChange: chatChange,
    ...(typeof chatRefused === 'function' ? { onRefused: chatRefused } : {}),
    ...(typeof chatCatchUpOffer === 'function' ? { onOffer: chatCatchUpOffer } : {}),
  }) : null;

  // A pod-only circle never fans — the shared pod IS the meeting point — so its statements are read
  // back from the pod on the same reconnect kick, through the rail's verify gate like any other.
  const podChat = (agent.chatRail && typeof podReadSince === 'function') ? makePodChatCatchUp({
    rail: agent.chatRail,
    podReadSince,
    dataMoveFor,
    eventLog,
  }) : null;

  // THE SIBLING CARRY — the person's other devices as a standing peer of every lane. Composed by the
  // host (basis: `makeSiblingCarry` over the proven own-device set); absent on a composition without
  // one, and then every hook below is a no-op.
  const carry = typeof agent.siblingCarry?.carry === 'function' ? (p, o) => agent.siblingCarry.carry(p, o) : null;
  // THIS DEVICE'S SELECTION (sync-policy §11) — read live from the register; a composition without one holds
  // everything. `holdsFor(silo)` answers the handlers' three-way question: true · false (verify, carry on,
  // keep nothing) · null (the kring is off here: refused on landing, said once per circle).
  const selection = typeof agent.getParamValue === 'function' ? makeSyncSelection({ getParamValue: agent.getParamValue }) : HOLD_EVERYTHING;
  const refusedKringSaid = new Set();
  const refusedCarrySaid = new Set();   // (reason, address) pairs already said — the log names a fact once
  const holdsFor = (silo) => (circleId) => {
    if (!selection.kringOn(circleId)) {
      if (!refusedKringSaid.has(circleId)) { refusedKringSaid.add(circleId); console.warn(`[sync] this device does not hold kring ${String(circleId).slice(0, 12)}… — what a sibling still carries for it is refused on landing`); }
      return null;
    }
    return selection.siloOn(silo);
  };
  // A kring off pulls nothing: every lane's catch-up skips it, whether the kick walks all circles or asks for one.
  const withKringFilter = (cu) => (cu ? {
    ...cu,
    requestFrom: (addr, circleId) => (selection.kringOn(circleId) ? cu.requestFrom(addr, circleId) : Promise.resolve(undefined)),
    ...(typeof cu.requestCircle === 'function' ? { requestCircle: (circleId, o) => (selection.kringOn(circleId) ? cu.requestCircle(circleId, o) : Promise.resolve({ requested: 0 })) } : {}),
    requestAll: async (o) => {
      const callSkill = o?.callSkill;
      if (typeof callSkill !== 'function') return cu.requestAll(o);
      // the same walk `requestAll` makes, with the off-list removed before any address is asked
      const filtered = async (app, op, args) => {
        const r = await callSkill(app, op, args);
        if (op === 'listMyCircles' && Array.isArray(r?.circles)) return { ...r, circles: r.circles.filter((c) => selection.kringOn(typeof c === 'string' ? c : (c?.groupId ?? c?.id))) };
        return r;
      };
      return cu.requestAll({ ...o, callSkill: filtered });
    },
  } : null);

  // ── the fan receivers ────────────────────────────────────────────────────────────────────────
  const chatStatementHandler = agent.chatRail ? makeChatPeerHandler({
    rail: agent.chatRail,
    holds: holdsFor('chat'),
    // hold nothing, still carry: a verified statement this device does not keep goes on to the siblings
    onPassed: (circleId, statement, fromPeerAddr) =>
      carryLandedStatement({ carry, subtype: CHAT_STATEMENT_BROADCAST, circleId, statement, fromPeerAddr, msgId: statement?.body?.payload?.msgId ?? statement?.body?.subject ?? null }),
    // A pod-signal circle fans a REF to the sealed row rather than the content; it resolves through
    // the same sealed reader and then verifies at the rail like anything else that arrives.
    ...(typeof resolveRef === 'function' ? { resolveRef } : {}),
    // The persisted log IS the record, so a landed signed entry needs no second copy. What is left is
    // the side effect: tell the sender it arrived, and repaint if this circle is on screen.
    onLanded: async (circleId, entry, fromPeerAddr, statement) => {
      try { await chatLanded({ msgId: entry?.id, circleId, fromPeerAddr, source: 'receiver' }); }
      catch { /* a receipt that fails must not un-land the message */ }
      // …and hand it to my other devices (the one sibling carry; a no-op on a one-device person).
      await carryLandedStatement({ carry, subtype: CHAT_STATEMENT_BROADCAST, circleId, statement, fromPeerAddr, msgId: entry?.id ?? null });
    },
  }) : null;

  const keyStatementHandler = agent.keyRail
    ? makeKeyPeerHandler({
      rail: agent.keyRail,
      onChange: keyChange,
      onLanded: (circleId, statement, fromPeerAddr) =>
        carryLandedStatement({ carry, subtype: KEY_STATEMENT_BROADCAST, circleId, statement, fromPeerAddr, msgId: `key:${statement?.body?.hash ?? statement?.body?.subject ?? ''}` }),
    })
    : null;

  // The governance statement handler is built by each shell (it needs the shell's rail and re-render);
  // this is the reaction a shell hands it as `onLanded`, so the carry stays one function.
  const landedCarrier = {
    governance: (circleId, statement, fromPeerAddr) =>
      carryLandedStatement({ carry, subtype: 'circle-governance-broadcast', circleId, statement, fromPeerAddr, msgId: `gov:${statement?.body?.hash ?? ''}` }),
  };

  // A batch (or an offer) for a kring this device does not hold is refused on landing, like a fanned statement.
  const unlessKringOff = (fn) => (typeof fn === 'function' ? (fromAddr, payload) => (payload?.circleId && !selection.kringOn(payload.circleId) ? undefined : fn(fromAddr, payload)) : fn);
  const catchUpEntries = (cu) => (cu ? {
    [cu.subtypes.request]: cu.onRequest,
    [cu.subtypes.batch]:   unlessKringOff(cu.onBatch),
    ...(cu.onOffer ? { [cu.subtypes.offer]: unlessKringOff(cu.onOffer) } : {}),
  } : {});

  const handlers = {
    ...(chatStatementHandler ? { [CHAT_STATEMENT_BROADCAST]: chatStatementHandler } : {}),
    ...catchUpEntries(chat),
    // the circle's truth (keys, membership) is not a silo — but a kring this device declines is refused whole
    ...(keyStatementHandler ? { [KEY_STATEMENT_BROADCAST]: unlessKringOff(keyStatementHandler) } : {}),
    ...catchUpEntries(key),
    ...(agent.taskRail ? { [TASK_BROADCAST]: makeTaskPeerHandler({
      rail: agent.taskRail,
      holds: holdsFor('tasks'),
      onPassed: (circleId, statement, fromPeerAddr) =>
        carryLandedStatement({ carry, subtype: TASK_BROADCAST, circleId, statement, fromPeerAddr, msgId: `task:${statement?.body?.hash ?? ''}` }),
      onLanded: (circleId, statement, fromPeerAddr) =>
        carryLandedStatement({ carry, subtype: TASK_BROADCAST, circleId, statement, fromPeerAddr, msgId: `task:${statement?.body?.hash ?? ''}` }),
    }) } : {}),
    ...catchUpEntries(task),
    ...(agent.membershipRail ? {
      [MEMBERSHIP_BROADCAST]: unlessKringOff(makeMembershipPeerHandler({
        rail: agent.membershipRail,
        onChange: onMembership,
        onLanded: (circleId, statement, fromPeerAddr) =>
          carryLandedStatement({ carry, subtype: MEMBERSHIP_BROADCAST, circleId, statement, fromPeerAddr, msgId: `mem:${statement?.body?.hash ?? ''}` }),
      })),
    } : {}),
    ...catchUpEntries(membership),
    ...catchUpEntries(gov),
    // The personal lanes. A connection belongs to the PERSON, so a grant or revoke made on one of
    // their devices has to bind at every other device's door; the roster seed answers a freshly
    // enrolled sibling; and a contact-thread turn reaches the person rather than one of their devices.
    ...(agent.grantsPeerHandler ? { [GRANTS_BROADCAST]: agent.grantsPeerHandler } : {}),
    ...catchUpEntries(agent.grantsCatchUp),
    ...(agent.rosterSeed ? {
      [agent.rosterSeed.subtypes.request]: agent.rosterSeed.onRequest,
      [agent.rosterSeed.subtypes.batch]:   agent.rosterSeed.onBatch,
    } : {}),
    ...((agent.contactTurnHandler && typeof ownDeviceTurn === 'function')
      ? {
        // A carried turn that is refused says so — once per (reason, address). The gate used to drop it in
        // silence on every shell but the test harness, which is how a message the box had "delivered" to the
        // maker's web app vanished without a line (2026-09-19).
        [agent.contactTurnBroadcast]: agent.contactTurnHandler(ownDeviceTurn, (reason, from) => {
          const key = `${reason}\n${from}`;
          if (refusedCarrySaid.has(key)) return;
          refusedCarrySaid.add(key);
          console.warn(`[own-devices] a contact turn carried from ${String(from).slice(0, 12)}… was refused: ${reason} — it is not on this device's sibling set (its per-circle address in a circle we share)`);
        }),
      }
      : {}),
    // Who the person knows, on every device of theirs: a greeting's binding and a contact-book row
    // land here from a sibling (live, in full for a new device, or as a catch-up answer), and a
    // sibling's request is answered. Entries only — the agent owns the gate and the landing.
    ...(agent.knownPeersSync?.handlers ?? {}),
    // The person key between the person's devices: the rotation ceremony's hand-over lands here from a
    // sibling, and a sibling's request is answered. Entries only — the agent owns the gate and the store.
    ...(agent.personKeySync?.handlers ?? {}),
    // Which of the person's devices is primary for direct messages: a sibling's claim lands here, a request is answered.
    ...(agent.primaryDevice?.handlers ?? {}),
    // A circle a sibling founded or joined lands here and this device joins itself (the kring opt-out wins); a
    // sibling's request is answered with the circles this device is in. Entries only — the agent owns the gate.
    ...(agent.circleFollowSync?.handlers ?? {}),
    // A contact pulls my person-key chain after a rotation; a reply lands on the contact book once it verifies.
    ...(agent.personKeyChain?.handlers ?? {}),
  };

  return {
    handlers,
    catchUps: { gov: withKringFilter(gov), membership: withKringFilter(membership), key: withKringFilter(key), task: withKringFilter(task), chat: withKringFilter(chat), podChat },
    chatStatementHandler,
    keyStatementHandler,
    // the reaction a shell hands its own governance statement handler as `onLanded`
    landedCarrier,
  };
}
