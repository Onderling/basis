/**
 * THE PAIR-A-VIEW WALK, READING HALF (remote surface slice 2) — the "addressed edition": a
 * paired view's read grant names SECTIONS, and the acting device writes a partial mirror lane
 * holding only those sections, sealed to owner + that view. The view hydrates its lane like a
 * restoring device — with only its own keypair, no live link to the actor — and can open
 * nothing else on the backend: not the owner's device lane, not another circle's entries
 * (those never enter its lane at all). Revoking stops WRITING the lane — every batch after the
 * revoke simply never exists for that view; what it already read, it read.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createSealedPodDataSource } from '@onderling/pod-client';
import { memoryDataSource } from '@onderling/item-store';
import { createHistoryMirror, createHistoryPodMedium, hydrateHistory } from '../src/v2/historyMirror.js';
import { settingsSealStrategyForIdentity, sealStrategyForRecipients } from '../src/v2/sharedCopyOpener.js';
import { compileReadFilter, normaliseReads, viewLaneId } from '../src/v2/surfaceGrants.js';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { EventLog } from '../src/eventLog.js';

/** A SolidPodSource-shaped memory backend whose raw stored bodies we can byte-inspect. */
function memoryPodSource(map = new Map()) {
  return {
    map,
    async read(uri) { if (!map.has(uri)) { const e = new Error('404'); e.status = 404; throw e; } return { content: map.get(uri) }; },
    async write(uri, body) { map.set(uri, String(body)); },
    async delete(uri) { map.delete(uri); },
    async list(pre) { return [...map.keys()].filter((k) => k.startsWith(pre)); },
  };
}

const sealedOver = (map, strategy) =>
  createSealedPodDataSource({ podSource: memoryPodSource(map), podUrl: 'mem://', strategy });

const famEntry    = (id, text) => ({ id, ts: Date.now(), circleId: 'fam',  app: 'circle', type: 'chat-message', payload: { text } });
const werkEntry   = (id, text) => ({ id, ts: Date.now(), circleId: 'werk', app: 'circle', type: 'chat-message', payload: { text } });
const deviceEntry = (id)       => ({ id, ts: Date.now(), app: 'basis', type: 'settings-change', payload: { key: 'display.theme' } });

describe('the sections vocabulary — default-strict on every axis', () => {
  it('nothing granted matches nothing; circles match their entries; device scope is an explicit opt-in', () => {
    expect(normaliseReads(null)).toBe(null);
    expect(normaliseReads({})).toBe(null);
    expect(normaliseReads({ circles: [] })).toBe(null);

    const famOnly = compileReadFilter({ circles: ['fam'] });
    expect(famOnly(famEntry('a', 'x'))).toBe(true);
    expect(famOnly(werkEntry('b', 'x'))).toBe(false);
    expect(famOnly(deviceEntry('c'))).toBe(false);          // unscoped never leaks through a circle pick

    const withDevice = compileReadFilter({ circles: ['fam'], device: true });
    expect(withDevice(deviceEntry('c'))).toBe(true);

    const kindsToo = compileReadFilter({ circles: '*', kinds: ['chat-message'] });
    expect(kindsToo(famEntry('a', 'x'))).toBe(true);
    expect(kindsToo(deviceEntry('c'))).toBe(false);
  });
});

describe('the addressed edition — a partial lane only the granted view (and the owner) can open', () => {
  it('writes only the granted sections, sealed past everyone else; the view hydrates its lane alone; revoke stops the presses', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const view  = await AgentIdentity.generate(new VaultMemory());
    const mailbox = new Map();                       // ONE backend: owner lane + view lane side by side
    const log = new EventLog({ initial: [], muted: [] });

    // The owner's own device lane (seal-to-self) and the view's edition lane (owner + view).
    const ownLane = createHistoryMirror({
      eventLog: log, source: sealedOver(mailbox, settingsSealStrategyForIdentity(owner)),
      laneId: 'dev-1', batchMax: 2, flushMs: 5,
    });
    const lane = viewLaneId(view.pubKey);
    const viewMirror = createHistoryMirror({
      eventLog: log, source: sealedOver(mailbox, sealStrategyForRecipients(owner, [view.pubKey])),
      laneId: lane, filter: compileReadFilter({ circles: ['fam'] }), batchMax: 2, flushMs: 5,
    });
    await ownLane.start();
    await viewMirror.start();

    log.append(famEntry('m-fam-1', 'fam-geheim'));
    log.append(werkEntry('m-werk-1', 'werk-geheim'));
    log.append(deviceEntry('m-dev-1'));
    await ownLane.flush();
    await viewMirror.flush();

    // The mailbox holds ciphertext only — no circle content in the raw bytes, any lane.
    const raw = [...mailbox.values()].join('\n');
    expect(raw).not.toContain('geheim');

    // The view hydrates ITS lane with only its own keypair — and sees exactly the granted section.
    const viewLog = new EventLog({ initial: [], muted: [] });
    const viewSource = sealedOver(mailbox, sealStrategyForRecipients(view, []));
    const r = await hydrateHistory({
      source: viewSource, eventLog: viewLog,
      lanes: (l) => l === lane, logger: { warn: () => {} },
    });
    const seen = viewLog.query().map((e) => e.id);
    expect(seen).toContain('m-fam-1');
    expect(seen).not.toContain('m-werk-1');
    expect(seen).not.toContain('m-dev-1');
    expect(r.recent).toBe(1);

    // The seal is the gate: over ALL lanes, the owner's device-lane batches fail to OPEN for the
    // view — hydrate skips them loudly and still yields only the edition's entry.
    const viewLogAll = new EventLog({ initial: [], muted: [] });
    await hydrateHistory({ source: viewSource, eventLog: viewLogAll, logger: { warn: () => {} } });
    expect(viewLogAll.query().map((e) => e.id)).toEqual(['m-fam-1']);

    // ...while the OWNER opens both lanes (a recipient of each) — restore is unaffected by
    // view lanes: their entries are subsets, deduped by id.
    const ownerLog = new EventLog({ initial: [], muted: [] });
    const ownerHydrate = await hydrateHistory({ source: sealedOver(mailbox, settingsSealStrategyForIdentity(owner)), eventLog: ownerLog, logger: { warn: () => {} } });
    await ownerHydrate.tailDone;   // the device-scoped entry (no circle bucket) rides the background tail
    const ownerSeen = ownerLog.query().map((e) => e.id).sort();
    expect(ownerSeen).toEqual(['m-dev-1', 'm-fam-1', 'm-werk-1']);

    // REVOKE = stop the presses: the owner keeps mirroring, the edition ends. A later fam entry
    // reaches the owner's lane and never the view's.
    await viewMirror.stop();
    const batchesBefore = [...mailbox.keys()].filter((k) => k.includes(`/${lane}/`) && k.includes('batch-')).length;
    log.append(famEntry('m-fam-2', 'na-de-opzegging'));
    await ownLane.flush();
    const batchesAfter = [...mailbox.keys()].filter((k) => k.includes(`/${lane}/`) && k.includes('batch-')).length;
    expect(batchesAfter).toBe(batchesBefore);

    const viewLog2 = new EventLog({ initial: [], muted: [] });
    await hydrateHistory({ source: viewSource, eventLog: viewLog2, lanes: (l) => l === lane, logger: { warn: () => {} } });
    expect(viewLog2.query().map((e) => e.id)).toEqual(['m-fam-1']);
    await ownLane.stop();
  });
});

describe('the agent wires it end to end — grant makes the lane, the switch governs it, revoke ends it', () => {
  it('a read grant before the mirror runs waits; the switch starts the lane WITH backfill; revoke stops it live', async () => {
    const podMap = new Map();
    const log = new EventLog({ initial: [], muted: [] });
    const view = await AgentIdentity.generate(new VaultMemory());
    const A = await createRealHouseholdAgent({
      seedHousehold: false,
      settingsDataSource: memoryDataSource(),
      deviceLog: log,
      provisionHistoryMirror: async (strategy) => createHistoryPodMedium({ podSource: memoryPodSource(podMap), strategy }),
    });

    // Content exists BEFORE the grant and the switch — the lane must backfill it later.
    log.append(famEntry('pre-fam', 'geheim vooraf'));
    log.append(werkEntry('pre-werk', 'ander geheim'));

    // Grant with sections while the mirror is OFF: recorded, honest laneActive:false, no lane yet.
    const grant = await A.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], reads: { circles: ['fam'] }, label: 'tablet',
    });
    expect(grant.ok).toBe(true);
    expect(grant.laneActive).toBe(false);
    const lane = grant.laneId;
    expect(lane).toBe(viewLaneId(view.pubKey));
    const laneBatches = () => [...podMap.keys()].filter((k) => k.includes(`/${lane}/`) && k.includes('batch-')).length;
    expect(laneBatches()).toBe(0);

    // The switch starts the lane too — and its own backfill carries the pre-existing fam entry.
    await A.callSkill('params', 'set-param', { key: 'history.mirror', value: true });
    let deadline = Date.now() + 5000;
    while (laneBatches() === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(laneBatches()).toBeGreaterThan(0);

    const viewLog = new EventLog({ initial: [], muted: [] });
    const viewSource = createSealedPodDataSource({
      podSource: memoryPodSource(podMap), podUrl: 'mem://', strategy: sealStrategyForRecipients(view, []),
    });
    await hydrateHistory({ source: viewSource, eventLog: viewLog, lanes: (l) => l === lane, logger: { warn: () => {} } });
    const ids = viewLog.query().map((e) => e.id);
    expect(ids).toContain('pre-fam');
    expect(ids).not.toContain('pre-werk');

    // Revoke ends the edition live: a later fam entry never reaches the lane.
    const before = laneBatches();
    const rev = await A.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey });
    expect(rev).toMatchObject({ ok: true, revoked: true });
    await new Promise((r) => setTimeout(r, 100));   // the serialized reconciler stops the lane
    log.append(famEntry('post-fam', 'na-de-opzegging'));
    await new Promise((r) => setTimeout(r, 300));
    expect(laneBatches()).toBe(before);

    // The mailbox never held plaintext at any point of this story.
    expect([...podMap.values()].join('\n')).not.toContain('geheim');
    await A.callSkill('params', 'set-param', { key: 'history.mirror', value: false });
  }, 30_000);
});
