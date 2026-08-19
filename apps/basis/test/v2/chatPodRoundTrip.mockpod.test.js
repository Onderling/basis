/**
 * The chat POD RE-ROOT keystone — the SIGNED statement over a shared MockPod (real MemoryStorageBackend,
 * real sealing, real stoop fan core). The pod stays transport, never authority: the row carries the signed
 * statement, and whoever reads it back verifies at their chat rail exactly like a fanned statement.
 *
 *   pod-signal  A seals+writes the statement row, fans a REF (subtype kring-chat-statement, no body) →
 *               B's statement handler resolves the ref from the pod, VERIFIES, renders.
 *   pod-only    A seals+writes, fans NOTHING → B's pod catch-up range-reads the rows, VERIFIES, renders.
 *   dedup       a ref for a message already landed costs NO pod read.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart, MemoryStorageBackend } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  resolveCircleStorage, generateGroupKey, isSealed,
  writeSealedMessage, readSealedMessage, readSealedMessagesSince,
} from '@onderling/pod-client';
import { createNeighborhoodAgent } from '@onderling-app/stoop';
import { EventLog } from '../../src/eventLog.js';
import { makeChatRail, makeChatPeerHandler, makePodChatCatchUp, CHAT_STATEMENT_BROADCAST } from '../../src/v2/chatRail.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';
const CIRCLE = 'pod-circle';

async function callSkill(agent, id, args, from = ANNE) {
  const def = agent.skills.get(id);
  if (!def) throw new Error(`no such skill: ${id}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

/** A member's chat rail over a real EventLog, bound through a shared test roster. */
async function chatDevice(ref, rosterAll) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const row = rosterAll.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  const eventLog = new EventLog({ initial: [] });
  const rail = makeChatRail({
    eventLog,
    circleIdentityFor: async () => cid,
    myRef: ref,
    callSkill: async () => ({}),
    verifyBinding: async ({ author, ref: r }) => rosterAll.some((m) => m.circleAddress === author && m.webid === r),
  });
  return { ref, cid, eventLog, rail };
}

/** Sender A: a real stoop bundle whose pod seam seals+writes the shared MockPod; the fan is captured. */
async function bootSenderA({ backend, seal, circleDataMove, deliver }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: ANNE, peers: [] },
    members: [{ webid: ANNE, role: 'member' }, { webid: BOB, role: 'member' }],
    circleDataMove,
    podWrite: (circleId, env) => writeSealedMessage(backend, seal, env).then((ref) => ({ ref })),
    reliableSend: async (addr, envelope) => { deliver(addr, envelope); return { held: false, delivered: true }; },
  });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('chat pod re-root — the SIGNED statement over the shared pod', () => {
  it('pod-signal: the sealed row carries the statement; B resolves the ref and VERIFIES before rendering', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const roster = [{ webid: ANNE, role: 'member' }, { webid: BOB, role: 'member' }];
    const anne = await chatDevice(ANNE, roster);
    const bob  = await chatDevice(BOB, roster);
    const delivered = [];
    const A = await bootSenderA({ backend, seal, circleDataMove: () => 'pod-signal', deliver: (addr, env) => delivered.push(env) });

    // Anne writes locally (the signed render entry) and fans THROUGH the stoop core.
    const { statement } = await anne.rail.appendMessage(CIRCLE, { msgId: 'p1', ts: Date.now(), text: 'hoi via de pod', actor: 'me' });
    const r = await callSkill(A.agent, 'broadcastCircleChatStatement', { groupId: CIRCLE, event: statement, msgId: 'p1', ts: Date.now() });

    expect(r.podSignal).toBe(true);
    const raw = await backend.get(r.ref);
    expect(isSealed(raw)).toBe(true);                       // sealed bytes, never plaintext
    expect(String(raw).includes('hoi via de pod')).toBe(false);

    expect(delivered).toHaveLength(1);
    const wire = delivered[0];
    expect(wire.subtype).toBe(CHAT_STATEMENT_BROADCAST);    // the ref routes to the STATEMENT path
    expect(wire.ref).toBe(r.ref);
    expect(wire.event).toBeUndefined();                     // no body on the wire — the pod carries it

    const handler = makeChatPeerHandler({
      rail: bob.rail,
      resolveRef: (refEnv) => readSealedMessage(backend, open, refEnv.ref),
    });
    await handler(ANNE, wire);
    const onBob = bob.eventLog.query({}).find((e) => e.id === 'p1');
    expect(onBob?.payload.text).toBe('hoi via de pod');
    expect(onBob?.actor).toBe(ANNE);                        // derived from the VERIFIED statement
    expect(onBob?.payload.statement.sig).toBeTruthy();
  });

  it('pod-only: no fan at all; B converges by reading the pod through the rail\'s verify gate', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const roster = [{ webid: ANNE, role: 'member' }, { webid: BOB, role: 'member' }];
    const anne = await chatDevice(ANNE, roster);
    const bob  = await chatDevice(BOB, roster);
    const delivered = [];
    const A = await bootSenderA({ backend, seal, circleDataMove: () => 'pod-only', deliver: (addr, env) => delivered.push(env) });

    const { statement } = await anne.rail.appendMessage(CIRCLE, { msgId: 'q1', ts: Date.now(), text: 'stil naar de pod', actor: 'me' });
    const r = await callSkill(A.agent, 'broadcastCircleChatStatement', { groupId: CIRCLE, event: statement, msgId: 'q1', ts: Date.now() });
    expect(r.podOnly).toBe(true);
    expect(delivered).toHaveLength(0);                      // truly no fan

    const catchUp = makePodChatCatchUp({
      rail: bob.rail,
      podReadSince: (circleId, q) => readSealedMessagesSince(backend, open, { circleId, ...q }).then((res) => res.items),
      eventLog: bob.eventLog,
    });
    const res = await catchUp.catchUpCircle(CIRCLE);
    expect(res.ingested).toBe(1);
    const onBob = bob.eventLog.query({}).find((e) => e.id === 'q1');
    expect(onBob?.payload.text).toBe('stil naar de pod');
    expect(onBob?.payload.statement.sig).toBeTruthy();      // verified, not trusted
  });

  it('a ref for a message already landed costs NO pod read', async () => {
    const roster = [{ webid: ANNE, role: 'member' }, { webid: BOB, role: 'member' }];
    const anne = await chatDevice(ANNE, roster);
    const bob  = await chatDevice(BOB, roster);
    const { statement } = await anne.rail.appendMessage(CIRCLE, { msgId: 'd1', ts: 1, text: 'al gezien' });
    await bob.rail.ingest(CIRCLE, statement);               // landed via the live fan earlier

    let reads = 0;
    const handler = makeChatPeerHandler({
      rail: bob.rail,
      resolveRef: async () => { reads += 1; return null; },
    });
    await handler(ANNE, { subtype: CHAT_STATEMENT_BROADCAST, circleId: CIRCLE, msgId: 'd1', ref: 'pod-circle/000-d1', ts: 1 });
    expect(reads).toBe(0);                                  // deduped before the pod
    expect(bob.eventLog.query({}).filter((e) => e.id === 'd1')).toHaveLength(1);
  });
});
