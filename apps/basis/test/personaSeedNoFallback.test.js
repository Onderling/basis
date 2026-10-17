/**
 * NO SILENT FALLBACK TO THE DEFAULT. A device that holds only the default, with a persona's circle in its imported
 * recovery file, has no self in that circle: it asks for no seed there (nothing to sign it with), and a request for that
 * circle's seed gets no answer from it — never the default's key, record or verifier standing in for the persona's.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

describe('a circle with no self on this device gets no device kit', () => {
  it('the default-only device neither asks for nor serves the seed of a persona\'s circle', async () => {
    const phone = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const Y = 'werk-circle';
    expect((await phone.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: w })).ok).toBe(true);
    expect((await phone.callSkill('agents', 'setProfileCircleMembership', { id: w, circleId: Y, address: phone.persona(w).circleAddressFor(Y) }))?.ok).toBe(true);
    await phone.callSkill('pinboard', 'recordRosterSeed', { groupId: Y, rows: [{ id: 'redeem-cor', text: 'cor', kind: 'membership-redemption', source: { groupId: Y, redeemedBy: 'cor-webid-0123456789' } }] });
    const file = (await phone.callSkill('household', 'exportRecoveryFile', {}))?.file;

    // device A: restored with the default only, the file imported (Werk's circle is in it)
    const ownerRootVault = new VaultMemory();
    const vaults = { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const pre = await createRealHouseholdAgent({ seedHousehold: false, ...vaults });
    expect((await pre.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    const a = await createRealHouseholdAgent({ seedHousehold: false, ...vaults });
    expect((await a.callSkill('household', 'importRecoveryFile', { file }))?.ok).toBe(true);
    expect(a.persona(w), 'A does not hold Werk').toBeFalsy();

    // A asks nothing in Y: it has no self there to sign with
    expect(await a.rosterSeed.buildRequest(Y, 'some-reply-address'), 'no request for a circle A has no self in').toBe(null);

    // …and a request for Y's seed from a Werk device gets nothing back from A
    const req = await phone.rosterSeed.buildRequest(Y, phone.persona(w).circleAddressFor(Y));
    expect(req, 'the phone, as Werk, can ask').toBeTruthy();
    const sent = [];
    const orig = a.sa.peer.sendTo.bind(a.sa.peer);
    a.sa.peer.sendTo = (to, env, o) => { sent.push({ to, subtype: env?.subtype, circleId: env?.circleId ?? null }); return orig(to, env, o); };
    try { await a.rosterSeed.onRequest('some-sibling', req); } finally { a.sa.peer.sendTo = orig; }
    expect(sent.filter((s) => s.circleId === Y), 'nothing about Y leaves A').toEqual([]);
    await phone.shutdown?.(); await a.shutdown?.();
  }, 120_000);
});
