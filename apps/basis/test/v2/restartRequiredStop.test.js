/**
 * THE STOP AFTER A RESTART-REQUIRED RESULT: a phrase restore leaves the running process as the device's former self,
 * so from the restore's result on the outer waist refuses every write (the phone walk went on as the old person and
 * lost what was written after). Reads the manifests declare still pass; the shells hear the state once.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { createRestartState, restartRefusal, asksRestart, RESTART_REQUIRED_CODE } from '../../src/v2/restartRequired.js';

describe('the restart-required stop', () => {
  it('after a phrase restore, a write through callSkill is refused with the restart state; a read still answers', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const fresh = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const heard = [];
    fresh.onRestartRequired((e) => heard.push(e));
    expect(fresh.restartRequired()).toBe(false);
    // before the restore a write goes through
    expect((await fresh.callSkill('agents', 'createProfile', { name: 'Voor' }))?.created).toBe(true);

    const restored = await fresh.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase });
    expect(restored?.ok, JSON.stringify(restored)).toBe(true);
    expect(fresh.restartRequired(), 'the restore\'s result set the stop').toBe(true);
    expect(heard, 'the shell hears it once').toEqual([{ cause: 'household.restoreOwnerPhrase' }]);

    const after = await fresh.callSkill('agents', 'createProfile', { name: 'Na' });
    expect(after).toMatchObject({ ok: false, code: RESTART_REQUIRED_CODE });
    const read = await fresh.callSkill('pinboard', 'listMyCircles', {});
    expect(read?.code ?? null, 'a declared read still answers').not.toBe(RESTART_REQUIRED_CODE);
    // a listener added later hears it at once (a screen remounted in the same process)
    const late = [];
    fresh.onRestartRequired((e) => late.push(e));
    expect(late).toHaveLength(1);
    await phone.shutdown?.(); await fresh.shutdown?.();
  }, 120_000);

  it('the state: set once, never cleared in the process; an unknown op is refused, a declared read is not', () => {
    const s = createRestartState();
    const manifests = [{ app: 'a', operations: [{ id: 'look', verb: 'list' }, { id: 'put', verb: 'add' }] }];
    expect(restartRefusal(s, manifests, 'a', 'put')).toBe(null);
    let n = 0;
    s.on(() => { n += 1; });
    s.set('a.put'); s.set('a.other');
    expect(n).toBe(1);
    expect(s.cause).toBe('a.put');
    expect(restartRefusal(s, manifests, 'a', 'look')).toBe(null);
    expect(restartRefusal(s, manifests, 'a', 'put')?.code).toBe(RESTART_REQUIRED_CODE);
    expect(restartRefusal(s, manifests, 'a', 'unknown')?.code).toBe(RESTART_REQUIRED_CODE);
    expect(asksRestart({ ok: true, reloadRequired: true })).toBe(true);
    expect(asksRestart({ ok: true })).toBe(false);
    expect(asksRestart(null)).toBe(false);
  });
});
