/**
 * A PAUSE CHANGES WHAT THE NEXT START RUNS; IT DOES NOT MAKE THIS PROCESS A FORMER SELF. Werk still runs here until the
 * restart, its keys and data stay, so a write as Werk after the pause, in the same start, is not lost: after a restart
 * (Werk not running) and a resume, it is there. So a pause answers `takesEffectNextStart` and not `reloadRequired`,
 * and the restart stop (restartRequired.js) does not stand after it.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';
import { loadOwnItems } from '../../src/assistant/ownItems.js';

const OWN = OWN_DEVICES_SCOPE;
const NOTE_ADD = encodeGenericOpId('household', 'add', 'note');

describe('a pause takes effect at the next start', () => {
  it('a write as Werk after /pauze, in the same start, is still there after a restart and a resume', async () => {
    const ds = memoryDataSource();
    const keep = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const boot = () => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }), ...keep });
    const first = await boot();
    const w = (await first.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    await first.shutdown?.();
    const a = await boot();
    const werk = a.persona(w).chatId.pubKey;

    const paused = await a.callSkill('household', 'pausePersona', { personaId: w });
    expect(paused).toMatchObject({ ok: true, takesEffectNextStart: true });
    expect(paused.reloadRequired, 'a pause is not a restart-required result').toBeUndefined();
    expect(a.restartRequired(), 'no stop after a pause').toBe(false);
    const wrote = await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'na de pauze geschreven' }, { actAs: werk });
    expect(wrote?.ok, JSON.stringify(wrote)).toBe(true);
    await a.shutdown?.();

    const pausedStart = await boot();   // Werk does not run in this start
    expect((await pausedStart.callSkill('household', 'resumePersona', { personaId: w }))).toMatchObject({ ok: true, takesEffectNextStart: true });
    await pausedStart.shutdown?.();

    const back = await boot();
    const asWerk = (await loadOwnItems({ call: (app, opId, args) => back.callSkill(app, opId, args, { actAs: werk }), self: { key: werk, isDefault: false } })()).map((i) => i.text).join('\n');
    expect(asWerk, 'the note written as Werk after the pause').toContain('na de pauze geschreven');
    await back.shutdown?.();
  }, 120_000);
});
