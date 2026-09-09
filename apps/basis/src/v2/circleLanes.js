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
import { GRANTS_BROADCAST } from './grantsRail.js';
import { makeTaskPeerHandler, TASK_BROADCAST, TASK_CATCHUP_SUBTYPES } from './taskRail.js';
import { makeFrontierReplay } from './frontierReplay.js';
import { makeChatPeerHandler, makePodChatCatchUp, CHAT_STATEMENT_BROADCAST, CHAT_CATCHUP_SUBTYPES } from './chatRail.js';
import { KEY_STATEMENT_BROADCAST, KEY_CATCHUP_SUBTYPES, makeKeyPeerHandler } from './keyRail.js';

/** A no-op reaction, so every hook is optional and a missing one is silence rather than a crash. */
const NOOP = () => {};

/**
 * Build the lane half of a shell's peer-router table.
 *
 * @param {object} a
 * @param {object} a.agent  the basis agent — its rails (`chatRail`, `taskRail`, `keyRail`,
 *   `membershipRail`), its ready-made receivers (`grantsPeerHandler`, `grantsCatchUp`, `rosterSeed`,
 *   `contactTurnHandler`) and `rosterReads`. A rail this agent does not have yields no entry.
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
 *   `chatCatchUpOffer({circleId, count, approxBytes, allow})` · `ownDeviceTurn(wire)`.
 * @returns {{ handlers: Object<string, Function>, catchUps: object, chatStatementHandler: object|null }}
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
    chatLanded = NOOP, chatChange = NOOP, chatCatchUpOffer = null,
    ownDeviceTurn = null,
  } = on;

  // A landed membership batch changes the roster, so the cached reads must go. A shell may add its own
  // reaction on top; this part is not its choice, which is why it is the default rather than a hook.
  const onMembership = (circleId) => {
    try { agent.rosterReads?.invalidate(circleId); } catch { /* a cache that will not clear is not fatal */ }
    try { membershipChange?.(circleId); } catch { /* the shell's reaction never breaks ingest */ }
  };

  // ── the catch-ups ────────────────────────────────────────────────────────────────────────────
  const gov = govRail ? makeGovernanceCatchUp({
    rail: govRail,
    sendToPeer: send,
    onChange: govChange,
    // The durable-head serve: a member offline past the lane's audit window still receives the
    // preserved, originally-signed rules-update statement — the final setting never deletes.
    ...(typeof extraGovStatementsFor === 'function' ? { extraStatementsFor: extraGovStatementsFor } : {}),
  }) : null;

  const membership = agent.membershipRail ? makeGovernanceCatchUp({
    rail: agent.membershipRail,
    sendToPeer: send,
    subtypes: MEMBERSHIP_CATCHUP_SUBTYPES,
    onChange: onMembership,
  }) : null;

  // Pull-all for keys — one small statement per version, so a long-offline or freshly enrolled device
  // converges on the circle's whole key chain rather than a window of it.
  const key = agent.keyRail ? makeGovernanceCatchUp({
    rail: agent.keyRail,
    sendToPeer: send,
    subtypes: KEY_CATCHUP_SUBTYPES,
    onChange: keyChange,
  }) : null;

  // Content lanes never pull all of it. Tasks replay from the receiver's frontier, paging as needed,
  // and the serve set includes signed snapshots of live heads whose entries have aged out of the lane.
  const task = agent.taskRail ? makeFrontierReplay({
    rail: agent.taskRail,
    sendToPeer: send,
    subtypes: TASK_CATCHUP_SUBTYPES,
    statementsFor: (circleId) => agent.taskRail.catchUpStatements(circleId),
  }) : null;

  // Chat replays the same way, with one rung above it: past the auto-allow ceiling the person is asked
  // the real question, in whatever way this shell asks questions.
  const chat = agent.chatRail ? makeFrontierReplay({
    rail: agent.chatRail,
    sendToPeer: send,
    subtypes: CHAT_CATCHUP_SUBTYPES,
    onChange: chatChange,
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

  // ── the fan receivers ────────────────────────────────────────────────────────────────────────
  const chatStatementHandler = agent.chatRail ? makeChatPeerHandler({
    rail: agent.chatRail,
    // A pod-signal circle fans a REF to the sealed row rather than the content; it resolves through
    // the same sealed reader and then verifies at the rail like anything else that arrives.
    ...(typeof resolveRef === 'function' ? { resolveRef } : {}),
    // The persisted log IS the record, so a landed signed entry needs no second copy. What is left is
    // the side effect: tell the sender it arrived, and repaint if this circle is on screen.
    onLanded: async (circleId, entry, fromPeerAddr) => {
      try { await chatLanded({ msgId: entry?.id, circleId, fromPeerAddr, source: 'receiver' }); }
      catch { /* a receipt that fails must not un-land the message */ }
    },
  }) : null;

  const keyStatementHandler = agent.keyRail
    ? makeKeyPeerHandler({ rail: agent.keyRail, onChange: keyChange })
    : null;

  const catchUpEntries = (cu) => (cu ? {
    [cu.subtypes.request]: cu.onRequest,
    [cu.subtypes.batch]:   cu.onBatch,
    ...(cu.onOffer ? { [cu.subtypes.offer]: cu.onOffer } : {}),
  } : {});

  const handlers = {
    ...(chatStatementHandler ? { [CHAT_STATEMENT_BROADCAST]: chatStatementHandler } : {}),
    ...catchUpEntries(chat),
    ...(keyStatementHandler ? { [KEY_STATEMENT_BROADCAST]: keyStatementHandler } : {}),
    ...catchUpEntries(key),
    ...(agent.taskRail ? { [TASK_BROADCAST]: makeTaskPeerHandler({ rail: agent.taskRail }) } : {}),
    ...catchUpEntries(task),
    ...(agent.membershipRail ? {
      [MEMBERSHIP_BROADCAST]: makeMembershipPeerHandler({ rail: agent.membershipRail, onChange: onMembership }),
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
      ? { [agent.contactTurnBroadcast]: agent.contactTurnHandler(ownDeviceTurn) }
      : {}),
  };

  return {
    handlers,
    catchUps: { gov, membership, key, task, chat, podChat },
    chatStatementHandler,
    keyStatementHandler,
  };
}
