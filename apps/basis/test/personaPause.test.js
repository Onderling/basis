/**
 * PAUSE A PERSONA ON THIS DEVICE — local, reversible, no phrase. A paused persona does not run here (in either custody
 * mode): its circles are not reopened or served, it leaves the switcher; its keys and data stay sealed where they are,
 * and nothing reaches the registry or any peer. A reboot keeps it paused; resume is the inverse. The primary (the self
 * this device speaks as) cannot be paused, nor a self the device does not hold.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const device = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });
const boot = (d, extra = {}) => createRealHouseholdAgent({ seedHousehold: false, ...d, ...extra });

describe('pause a persona on this device', () => {
  it('a paused persona does not run here, across a reboot; resume brings it back; nothing reaches the registry', async () => {
    const d = device();
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const phone = await boot(d, { deviceLog });
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    // what a join as Werk writes: the circle under Werk's profile, with Werk's address for it
    expect((await phone.callSkill('agents', 'setProfileCircleMembership', { id: w, circleId: 'werkoverleg', handle: 'w', address: phone.persona(w).circleAddressFor('werkoverleg') }))?.ok).toBe(true);
    expect(phone.persona(w), 'Werk runs').toBeTruthy();
    expect((await phone.reopenMemberCircles()).reopened, 'control: while Werk runs, its circle is reopened').toContain('werkoverleg');
    expect(phone.servedOwnLanes(), 'control: while Werk runs, its own lane is served').toContain(`own-devices:${w}`);

    const paused = await phone.callSkill('household', 'pausePersona', { personaId: w });
    expect(paused, JSON.stringify(paused)).toMatchObject({ ok: true, reloadRequired: true });
    expect(deviceLog.query({}).some((e) => e?.type === 'settings-change' && e?.payload?.op === 'pause-persona' && e?.payload?.target?.ref === w), 'logged as a settings change').toBe(true);
    const here = await phone.callSkill('household', 'listPersonasHere', {});
    expect(here.personas.find((p) => p.id === w)?.paused, 'the screen says paused').toBe(true);
    await phone.shutdown?.();

    const again = await boot(d);
    expect(again.persona(w), 'paused: it does not run here after a reboot').toBeFalsy();
    expect((await again.personasHere()).map((p) => p.id), 'it left the switcher').not.toContain(w);
    const { reopened } = await again.reopenMemberCircles();
    expect(reopened, 'its circle is not reopened').not.toContain('werkoverleg');
    expect(again.servedOwnLanes(), 'its own lane is not served either').not.toContain(`own-devices:${w}`);
    expect(await again.siblingDevicesOf(w), 'nor carried to its devices').toEqual([]);
    expect(((await again.callSkill('agents', 'listAgents', {}))?.items ?? []).map((r) => r.agentId), 'its registry row stays').toContain(w);

    expect((await again.callSkill('household', 'resumePersona', { personaId: w }))).toMatchObject({ ok: true, reloadRequired: true });
    await again.shutdown?.();
    const back = await boot(d);
    expect(back.persona(w), 'resumed: it runs again').toBeTruthy();
    expect((await back.reopenMemberCircles()).reopened, 'and its circle is reopened again').toContain('werkoverleg');
    await back.shutdown?.();
  }, 120_000);

  it('on a delegated device too: a handed persona paused does not run, and is not offered as one to receive', async () => {
    const phone = await boot(device());
    const phrase = (await phone.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const w = (await phone.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const ownerRootVault = new VaultMemory(); const rootKeyStore = new RootKeyStoreVault({ vault: ownerRootVault }); const chatVault = new VaultMemory();
    const registryBackend = createMemoryBackend();
    const lap = { ownerRootVault, rootKeyStore, chatVault, registryBackend };
    const pre = await boot(lap);
    expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, personas: [w] })).ok).toBe(true);
    await pre.shutdown?.();
    const laptop = await boot(lap);
    expect(laptop.persona(w), 'handed and running').toBeTruthy();
    expect(await laptop.callSkill('household', 'pausePersona', { personaId: w })).toMatchObject({ ok: true });
    await laptop.shutdown?.();
    const again = await boot(lap);
    expect(again.persona(w), 'paused on the delegated device').toBeFalsy();
    expect(((await again.callSkill('household', 'listReceivablePersonas', {}))?.personas ?? []).map((p) => p.id), 'held, only paused — not "to receive"').not.toContain(w);
    expect(((await again.callSkill('household', 'listPersonasHere', {}))?.personas ?? []).find((p) => p.id === w)).toMatchObject({ paused: true, running: false });
    await phone.shutdown?.(); await again.shutdown?.();
  }, 120_000);

  it('the primary cannot be paused, nor a self this device does not hold', async () => {
    const phone = await boot(device());
    expect(await phone.callSkill('household', 'pausePersona', { personaId: 'default' })).toMatchObject({ ok: false, error: 'primary' });
    expect(await phone.callSkill('household', 'pausePersona', { personaId: 'p-000000000000' })).toMatchObject({ ok: false, error: 'not-held' });
    await phone.shutdown?.();
  }, 60_000);
});
