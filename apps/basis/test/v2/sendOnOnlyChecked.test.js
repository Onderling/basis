/**
 * WHAT MY DEVICE CANNOT VOUCH FOR, IT DOES NOT HAND ON.
 *
 * A stored statement whose signature no longer checks (damaged or planted after it landed), or a tombstone, would be
 * refused by every receiver of a catch-up; serving it gives them a hole they cannot explain. Both serve paths (the
 * pull-all catch-up of the governance-shaped lanes and the frontier replay of items and chat) send on only what passes
 * the rail's own check here, now. Through the REAL circle entry rail with real keys.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';
import { makeGovernanceCatchUp, GOV_CATCHUP_REQUEST } from '../../src/v2/governanceCatchUp.js';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';
import { sendOnOnlyChecked } from '../../src/v2/sendOnOnlyChecked.js';

const CIRCLE = 'circle:send-on';

function fakeEventLog() {
  const entries = []; const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id, ts }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, ts, silent: true };
      entries.push(entry); return entry;
    },
  };
}

async function setup() {
  const me = await AgentIdentity.generate(new VaultMemory());
  const eventLog = fakeEventLog();
  const rail = makeCircleEntryRail({ eventLog, signerFor: async () => ({ identity: me, ref: 'webid:me' }), entryKind: 'governance', declaredKinds: ['propose', 'vote', 'resolve'] });
  const good = await rail.append(CIRCLE, { kind: 'propose', subject: 'p1', payload: { text: 'one' } });
  await rail.append(CIRCLE, { kind: 'vote', subject: 'p1', payload: { vote: 'yes' } });
  // the second statement's stored signature is damaged after it landed (one character flipped)
  const damaged = eventLog.entries.find((e) => e.payload?.body?.kind === 'vote');
  const sig = damaged.payload.sig;
  damaged.payload = { ...damaged.payload, sig: (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1) };
  return { rail, eventLog, goodHash: (good?.statement ?? good)?.body?.hash ?? eventLog.entries[0].payload.body.hash, damagedHash: damaged.payload.body.hash };
}

const hashesIn = (sent) => sent.flatMap((m) => (m.payload?.statements ?? []).map((s) => s?.body?.hash));

describe('a catch-up hands on only what this device can vouch for', () => {
  it('the pull-all catch-up leaves out a stored statement whose signature no longer checks', async () => {
    const { rail, goodHash, damagedHash } = await setup();
    const sent = [];
    const cu = makeGovernanceCatchUp({ rail, sendToPeer: async (addr, payload) => { sent.push({ addr, payload }); } });
    await cu.onRequest('peer:x', { subtype: GOV_CATCHUP_REQUEST, circleId: CIRCLE });
    expect(hashesIn(sent)).toContain(goodHash);
    expect(hashesIn(sent)).not.toContain(damagedHash);
  });

  it('the frontier replay leaves it out too', async () => {
    const { rail, goodHash, damagedHash } = await setup();
    const sent = [];
    const fr = makeFrontierReplay({ rail, sendToPeer: async (addr, payload) => { sent.push({ addr, payload }); }, subtypes: { request: 'req', batch: 'bat', offer: 'off' } });
    await fr.onRequest('peer:x', { subtype: 'req', circleId: CIRCLE, frontier: [] });
    expect(hashesIn(sent)).toContain(goodHash);
    expect(hashesIn(sent)).not.toContain(damagedHash);
  });

  it('a tombstone is never handed on, and a rail that cannot check hands on nothing', () => {
    const tomb = { tombstone: true, body: { hash: 'h' } };
    expect(sendOnOnlyChecked([tomb], CIRCLE, { checkSigned: (c, s) => s.tombstone !== true })).toEqual([]);
    expect(sendOnOnlyChecked([{ body: { hash: 'x' } }], CIRCLE, {})).toEqual([]);
  });
});
