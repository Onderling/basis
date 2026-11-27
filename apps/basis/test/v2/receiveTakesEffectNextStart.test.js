/**
 * RECEIVING A PERSONA CHANGES WHAT THE NEXT START RUNS; IT DOES NOT MAKE THIS PROCESS A FORMER SELF. The hand-over
 * writes the received persona's slots (and a bootstrap the next boot consumes); this process stays the default self at
 * the same addresses until the restart. So a write as the default self after the receive, in the same start, is not
 * lost: after a restart it is there, and the received persona runs from that start. So a receive answers
 * `takesEffectNextStart` and not `reloadRequired`, and the restart stop (restartRequired.js) does not stand after it.
 * The receive screens still tell the person to start again (their words key on `ok`, not on this answer).
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../../src/v2/personNodeStore.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';
import { loadOwnItems } from '../../src/assistant/ownItems.js';

const OWN = OWN_DEVICES_SCOPE;
const NOTE_ADD = encodeGenericOpId('household', 'add', 'note');
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };

describe('a received persona takes effect at the next start', () => {
  it('a write as the default self after receivePersonas, in the same start, is there after a restart, and the persona runs', async () => {
    // the person's first device: the phrase, and a persona Werk
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const file = (await phone.callSkill('household', 'exportRecoveryFile', {}))?.file;
    expect(typeof file, 'a recovery file').toBe('string');

    // a second device restored from the phrase, without Werk
    const ds = memoryDataSource();
    const ownerRootVault = new VaultMemory();
    const keep = { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), enrollOfferStorage: memStorage() };
    const boot = () => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ownStore: async () => createOwnDevicesStore({ dataSource: ds }), ...keep });
    const pre = await boot();
    expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    await pre.shutdown?.();
    const a = await boot();
    expect((await a.callSkill('household', 'importRecoveryFile', { file }))?.ok, 'the file came back').toBe(true);
    expect(a.persona(w), 'Werk does not run here yet').toBeFalsy();
    const me = a.identity.chat.pubKey;

    const got = await a.callSkill('household', 'receivePersonas', { mnemonic: phrase, personas: [w] });
    expect(got, JSON.stringify(got)).toMatchObject({ ok: true, takesEffectNextStart: true });
    expect(got.reloadRequired, 'a receive is not a restart-required result').toBeUndefined();
    expect(a.restartRequired(), 'no stop after a receive').toBe(false);
    const wrote = await a.callSkill('household', NOTE_ADD, { circleId: OWN, body: 'na het ontvangen geschreven' });
    expect(wrote?.ok, JSON.stringify(wrote)).toBe(true);
    await a.shutdown?.();

    const after = await boot();
    expect(after.identity.chat.pubKey, 'the same default self').toBe(me);
    expect(after.persona(w)?.chatId?.pubKey, 'Werk runs from this start').toBe(phone.persona(w).chatId.pubKey);
    const asMe = (await loadOwnItems({ call: (app, opId, args) => after.callSkill(app, opId, args), self: { key: me, isDefault: true } })()).map((i) => i.text).join('\n');
    expect(asMe, 'the note written after the receive').toContain('na het ontvangen geschreven');
    await after.shutdown?.(); await phone.shutdown?.();
  }, 150_000);
});
