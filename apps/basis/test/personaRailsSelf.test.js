/**
 * WHAT A PERSONA'S CIRCLE HOLDS OF THE DEVICE: only the persona (persona arc c3c).
 *
 * Every signed statement this device writes into a circle — the founding and membership lane, the chat, the tasks,
 * the keys, the governance lanes — names its author by a ref beside the per-circle key that signed it. In a persona's
 * circle that ref must be the persona: the key is already the persona's (`personaOf`), so the default's ref beside it
 * would fail every co-member's binding check, and where it did not, it would link the two selves.
 *
 * Driven through the real factory with the device log the shells hand it; the circle is created AS the persona.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { EventLog } from '../src/eventLog.js';
import { initialState as createInitial, finalSubmit as createSubmit } from '../src/core/wizards/createGroupState.js';

const Y = 'circle-of-buurt';

describe('a persona\'s circle carries no byte of the default', () => {
  it('every statement this device writes in Y names the persona, never the default', async () => {
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const agent = await createRealHouseholdAgent({
      seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
      registryBackend: createMemoryBackend(), deviceLog,
    });
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const B = agent.persona(id);
    const A = agent.identity.chat.pubKey;

    // create Y AS B, through the create wizard's own op path (its persona step binds before the create)
    const state = createInitial();
    state.groupId = Y; state.name = 'Buurt'; state.purpose = 'test'; state.persona = id;   // the wizard's "founded as"
    const { result } = await createSubmit({ state, callSkill: (a, o, x) => agent.callSkill(a, o, x) });
    expect(result, 'created').toBeTruthy();

    // say something in Y, and say who I am there
    await agent.chatRail.appendMessage(Y, { msgId: 'm-1', ts: Date.now(), text: 'hallo buren' });
    await agent.emitMemberProps({ circleIds: [Y], props: { displayName: 'Buurman' } });

    const inY = deviceLog.query().filter((e) => JSON.stringify(e).includes(Y));
    expect(inY.length, 'statements were written in Y').toBeGreaterThan(0);
    const defaultBytes = [A, agent.persona('default').authorityPubKeyB64].filter(Boolean);
    for (const e of inY) {
      const s = JSON.stringify(e);
      for (const a of defaultBytes) {
        expect(s.includes(a), `a ${e.type} entry in Y carries the default (${a.slice(0, 8)}…)`).toBe(false);
      }
    }
    // and the persona IS what they name
    expect(inY.some((e) => JSON.stringify(e).includes(B.chatId.pubKey))).toBe(true);
    await agent.shutdown?.();
  }, 60_000);

  it('putting a persona\'s circle away keeps it the persona\'s (the registry write is under its profile)', async () => {
    const agent = await createRealHouseholdAgent({
      seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
      registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }),
    });
    const { id } = await agent.callSkill('agents', 'createProfile', { name: 'Buurt' });
    const state = createInitial();
    state.groupId = Y; state.name = 'Buurt'; state.purpose = 'test'; state.persona = id;
    expect((await createSubmit({ state, callSkill: (a, o, x) => agent.callSkill(a, o, x) })).result).toBeTruthy();
    const B = agent.persona(id);
    expect(agent.circleSelf(Y).webid).toBe(B.chatId.pubKey);
    // the person's circle list (what every launcher reads) holds the circle founded as the persona
    const ids = ((await agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId ?? c?.id));
    expect(ids, 'a circle founded as a persona is in the person\'s list').toContain(Y);
    // the create records the circle on the restore list after answering (not awaited) — put away once it is there
    let put = null;
    for (let i = 0; i < 40 && !put?.ok; i++) { put = await agent.setCircleSight(Y, true); if (!put?.ok) await new Promise((r) => setTimeout(r, 100)); }
    expect(put?.ok, JSON.stringify(put)).toBe(true);
    expect(agent.circleSelf(Y).webid, 'put away: still the persona\'s').toBe(B.chatId.pubKey);
    expect((await agent.circleSights())?.[Y]?.putAway, 'and the person\'s launcher sees it put away').toBe(true);
    expect((await agent.setCircleSight(Y, false))?.ok).toBe(true);
    expect(agent.circleSelf(Y).webid, 'brought back: still the persona\'s').toBe(B.chatId.pubKey);
    await agent.shutdown?.();
  }, 60_000);
});

describe('the create wizard founds as the persona', () => {
  it('binds before the create; a create that fails gives the circle back to the default', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push(`${app}.${op}:${args?.personaId ?? ''}`);
      if (op === 'createGroupV2') return { error: 'kapot' };
      return { ok: true };
    };
    const state = createInitial();
    state.groupId = 'c-1'; state.name = 'X'; state.purpose = 'p'; state.persona = 'p-0123456789ab';
    const { state: out } = await createSubmit({ state, callSkill });
    expect(out.submitError).toMatch(/kapot/);
    expect(calls).toEqual(['household.bindCirclePersona:p-0123456789ab', 'stoop.createGroupV2:', 'household.bindCirclePersona:']);
  });
  it('the default founds as before — no bind at all', async () => {
    const calls = [];
    const state = createInitial();
    state.groupId = 'c-2'; state.name = 'X'; state.purpose = 'p';
    await createSubmit({ state, callSkill: async (app, op) => { calls.push(`${app}.${op}`); return op === 'createGroupV2' ? { groupId: 'c-2', code: 'x' } : { ok: true }; } });
    expect(calls.some((c) => c.startsWith('household.bindCirclePersona'))).toBe(false);
  });
});
