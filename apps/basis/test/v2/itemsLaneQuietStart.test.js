/**
 * A QUIET START: the device starts with items statements and settings changes already on its log, and no new settings
 * change arrives. The kept settings changes are recorded per device and per run (`keptPolicyChanges.js`), so at the
 * start they are not known, and every statement the re-apply hands the judge PARKS. Nothing arrives that would make the
 * settings lane apply by itself; the rail asks it, the lane applies from its own log, and the parked statements are
 * judged and applied (or refused). Without that, "not known" would park for good.
 *
 * Composed as a shell composes a start: a fresh device log holding the old one's entries, the agent's items rail and the
 * shell's settings lane over it, the lane handed its governance rail at boot, then the re-apply when the store opens.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, frontier } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createCircleStores, memoryDataSource, wireStoreMirror, addTasks } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { EventLog } from '../../src/eventLog.js';
import { makeItemsRail, makeItemsEmitter, routeItemsMirror } from '../../src/v2/itemsRail.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { makePolicyUpdateEmitter, makeCirclePolicyLane, makePolicyHeadStore, membersOfViaSkill } from '../../src/v2/policyUpdateLane.js';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import { keptPolicyChangesOf } from '../../src/v2/keptPolicyChanges.js';
import { allManifests } from '../../src/v2/manifestSources.js';

const CIRCLE = 'circle:quiet-start';
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };

function memPolicies() {
  const mem = new Map();
  const io = { getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => { mem.set(k, v); } };
  const policies = createCirclePolicyStore({ load: async (id) => (mem.has(`p:${id}`) ? JSON.parse(mem.get(`p:${id}`)) : null), save: async (id, p) => { mem.set(`p:${id}`, JSON.stringify(p)); } });
  return { io, policies };
}

describe('a quiet start applies what parked', () => {
  it('held statements and held settings changes, no new change: the parked statements are judged and applied', async () => {
    const anna = await AgentIdentity.generate(new VaultMemory());   // the admin
    const cato = await AgentIdentity.generate(new VaultMemory());   // a member who writes
    const bo = await AgentIdentity.generate(new VaultMemory());     // the device that restarts
    const roster = [
      { webid: anna.pubKey, circleAddress: anna.pubKey, role: 'admin' },
      { webid: cato.pubKey, circleAddress: cato.pubKey, role: 'member' },
      { webid: bo.pubKey, circleAddress: bo.pubKey, role: 'member' },
    ];
    const callSkill = async (app, op) => (op === 'listGroupMembers' ? { members: roster.map((m) => ({ ...m })) } : {});
    const verifyBinding = async ({ author, ref }) => roster.some((m) => m.circleAddress === author && m.webid === ref);
    const manifests = () => allManifests();
    const registry = () => { const r = createRegistry(); registerCanonicalTypes(r); return r; };

    // Cato's device: writes tasks on the items lane
    const catoLog = new EventLog({ initial: [], muted: [] });
    const catoStores = createCircleStores({ dataSource: memoryDataSource(), registry: registry() });
    const catoRail = makeItemsRail({ eventLog: catoLog, circleIdentityFor: async () => cato, myRef: cato.pubKey, callSkill, storeFor: (c) => catoStores.getStore(c), verifyBinding });
    const catoWire = [];
    wireStoreMirror(catoStores.getStore(CIRCLE), routeItemsMirror({ circleId: CIRCLE, emitter: makeItemsEmitter({ rail: catoRail, fan: (c, st) => catoWire.push(st) }) }));
    // Anna's device: states the settings, the line drawn at what Cato's lane holds (what her device held then)
    const annaLog = new EventLog({ initial: [], muted: [] });
    const annaGov = makeGovernanceRail({ eventLog: annaLog, circleIdentityFor: async () => anna, myRef: anna.pubKey, callSkill, verifyBinding });
    const govWire = [];
    const emit = makePolicyUpdateEmitter({
      rail: annaGov, fan: (c, st) => { govWire.push(st); },
      contentUpToFor: () => ({ items: frontier(catoRail.storedStatements(CIRCLE).map((s) => s.body)), chat: [] }),
    });

    // Bo's device, its first run: everything lands on its log
    const boLog = new EventLog({ initial: [], muted: [] });
    const boStores = createCircleStores({ dataSource: memoryDataSource(), registry: registry() });
    const boRail = makeItemsRail({ eventLog: boLog, circleIdentityFor: async () => bo, myRef: bo.pubKey, callSkill, storeFor: (c) => boStores.getStore(c), verifyBinding, judge: { manifests } });
    const boGov = makeGovernanceRail({ eventLog: boLog, circleIdentityFor: async () => bo, myRef: bo.pubKey, callSkill, verifyBinding });
    const drain = async () => {
      await settle();
      for (const st of govWire.splice(0)) await boGov.ingest(CIRCLE, st);
      for (const st of catoWire.splice(0)) await boRail.ingest(CIRCLE, st);
      await settle();
    };
    await emit({ groupId: CIRCLE, policy: {}, version: 1 });
    const [old] = await addTasks(catoStores.getStore(CIRCLE), [{ text: 'made while adding was on' }], { actor: cato.pubKey });
    await drain();
    await emit({ groupId: CIRCLE, policy: ADD_OFF, version: 2 });
    const [late] = await addTasks(catoStores.getStore(CIRCLE), [{ text: 'made after the switch-off' }], { actor: cato.pubKey });
    await drain();
    expect(boRail.storedStatements(CIRCLE).length, 'Bo holds the items statements').toBe(2);
    expect(boGov.storedStatements(CIRCLE).filter((s) => s.body.kind === 'policy-update').length, 'and the settings changes').toBe(2);

    // ── the restart: the same entries on a new log, the store not opened before; no settings statement arrives ──────
    const restarted = new EventLog({ initial: boLog.query({}), muted: [] });
    expect(keptPolicyChangesOf(restarted, CIRCLE), 'not known at the start').toBeUndefined();
    const store = createCircleStores({ dataSource: memoryDataSource(), registry: registry() });
    const rail = makeItemsRail({ eventLog: restarted, circleIdentityFor: async () => bo, myRef: bo.pubKey, callSkill, storeFor: (c) => store.getStore(c), verifyBinding, judge: { manifests } });
    const govRail = makeGovernanceRail({ eventLog: restarted, circleIdentityFor: async () => bo, myRef: bo.pubKey, callSkill, verifyBinding });
    const { io, policies } = memPolicies();
    const lane = makeCirclePolicyLane({
      emitter: () => null, headStore: makePolicyHeadStore(io),
      readPolicy: (c) => policies.get(c), writePolicy: (c, p) => policies.update(c, p),
      membersOf: membersOfViaSkill(callSkill),
    });
    lane.useRail(govRail);   // what every shell does at boot
    await rail.rebuildHead(CIRCLE);
    await settle();
    expect((keptPolicyChangesOf(restarted, CIRCLE) ?? []).map((b) => b.payload.version), 'the lane answered the ask').toEqual([1, 2]);
    expect((await store.getStore(CIRCLE).get(old.id))?.text, 'the parked statement behind the line: applied').toBe('made while adding was on');
    expect(await store.getStore(CIRCLE).get(late.id), 'the one after it: refused').toBeFalsy();
  });
});
