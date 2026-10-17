/**
 * A PERSONA'S CIRCLES ON ITS OWN RESTORE RECORD (persona arc c4b): the boot heal puts a persona's circle back on the
 * PERSONA's registry record when it went missing — and that write gives the circle back its persona binding; leaving a
 * persona's circle takes it off the persona's record (or a restore re-opens a circle the person left).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const Y = 'circle-of-buurt';
const wait = async (pred, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await pred(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 100)); } };
// A circle is a persona's exactly while the persona's registry record holds it (the binding is filled from the records
// at boot and follows every membership write/remove) — so the binding is how a test reads whose record it is on.
const selfOf = (agent, circleId) => agent.circleSelf(circleId).webid;

describe('a persona\'s restore record', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the boot heal puts a missing circle back on the PERSONA\'s record, and the circle is the persona\'s again', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'persona-heal-'));
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const registryBackend = createMemoryBackend();
    const boot = () => createRealHouseholdAgent({
      ...vaults, registryBackend, seedHousehold: false, seedDemoData: false,
      pinboardPersistDb: { path: path.join(dir, 'pinboard-state.json') }, deviceLog: new EventLog({ initial: [], muted: [] }),
    });
    const first = await boot();
    const { id } = await first.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const B = first.persona(id);
    const state = createInitial();
    state.groupId = Y; state.name = 'Buurt'; state.purpose = 't'; state.persona = id;
    expect((await createSubmit({ state, callSkill: (a, o, x) => first.callSkill(a, o, x) })).result).toBeTruthy();
    // the create's record lands after the create answers; then the record goes missing
    await new Promise((r) => setTimeout(r, 500));   // the create's record lands after the create answers
    expect(selfOf(first, Y)).toBe(B.chatId.pubKey);
    await first.callSkill('agents', 'removeProfileCircleMembership', { id, circleId: Y });   // the record goes missing
    expect(selfOf(first, Y), 'record gone → the circle reads as the default\'s').toBe(first.identity.chat.pubKey);
    await new Promise((r) => setTimeout(r, 1200));   // the pinboard state reaches disk
    await first.shutdown?.();

    const second = await boot();
    expect(await wait(async () => selfOf(second, Y) === B.chatId.pubKey), 'the heal put it back on B\'s record — the circle is B\'s again').toBe(true);
    await second.shutdown?.();
  }, 90_000);

  it('leaving a persona\'s circle takes it off the persona\'s record', async () => {
    const agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
      seedHousehold: false, seedDemoData: false, deviceLog: new EventLog({ initial: [], muted: [] }),
    });
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const state = createInitial();
    state.groupId = Y; state.name = 'Buurt'; state.purpose = 't'; state.persona = id;
    expect((await createSubmit({ state, callSkill: (a, o, x) => agent.callSkill(a, o, x) })).result).toBeTruthy();
    await new Promise((r) => setTimeout(r, 500));
    expect(selfOf(agent, Y)).toBe(agent.persona(id).chatId.pubKey);
    const left = await agent.callSkill('pinboard', 'leaveGroup', { groupId: Y, confirm: true });
    expect(left?.error ?? null, JSON.stringify(left)).toBe(null);
    expect(await wait(async () => selfOf(agent, Y) === agent.identity.chat.pubKey), 'off B\'s record (its binding gone with it)').toBe(true);
    await agent.shutdown?.();
  }, 60_000);

  it('the default\'s heal runs too (it had raced boot): a default circle missing from the record comes back', async () => {
    const d2 = await mkdtemp(path.join(tmpdir(), 'default-heal-'));
    try {
      const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
      const registryBackend = createMemoryBackend();
      const boot = () => createRealHouseholdAgent({
        ...vaults, registryBackend, seedHousehold: false, seedDemoData: false,
        pinboardPersistDb: { path: path.join(d2, 'pinboard-state.json') }, deviceLog: new EventLog({ initial: [], muted: [] }),
      });
      const first = await boot();
      const state = createInitial();
      state.groupId = 'circle-of-mine'; state.name = 'Mijn'; state.purpose = 't';
      expect((await createSubmit({ state, callSkill: (a, o, x) => first.callSkill(a, o, x) })).result).toBeTruthy();
      await new Promise((r) => setTimeout(r, 500));
      await first.callSkill('agents', 'removeProfileCircleMembership', { id: 'default', circleId: 'circle-of-mine' });
      expect((await first.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: 'circle-of-mine', sight: { putAway: true, at: 1 } }))?.ok, 'no record → a sight write is refused').not.toBe(true);
      await new Promise((r) => setTimeout(r, 1200));
      await first.shutdown?.();
      const second = await boot();
      // healed → the record exists again, so a put-away write is accepted
      const ok = await wait(async () => (await second.setCircleSight('circle-of-mine', true))?.ok === true);
      expect(ok, 'the default\'s circle is back on the default\'s record').toBe(true);
      await second.shutdown?.();
    } finally { await rm(d2, { recursive: true, force: true }).catch(() => {}); }
  }, 90_000);
});
