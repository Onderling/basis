/**
 * ENROLLMENT, BORN A FLOW (add-a-device): the enroll-device flow — declared on the
 * household manifest, verified, executed by the one runner against the REAL composition — plus
 * the boot cutover it exists for: an enrolled device derives its per-circle keys from its
 * DELEGATION seed, so two devices holding ONE phrase present DISTINCT addresses per circle,
 * while the member identity (the chat pubKey) stays one.
 *
 * The ceremony happens on the NEW device (the phrase is typed there, never on one that already
 * has authority); the reload after it lets boot finish the job: the derivation cutover, and the
 * root-signed delegation record self-healing onto the owner's registry.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { verifyFlows, createFlowRunner, renderFlow } from '@onderling/app-manifest';
import {
  Bootstrap, deriveCircleAddress, deriveDeviceSeed, deviceDelegationPubKey, verifyDeviceDelegation,
} from '@onderling/core';
import { DEVICE_DELEGATIONS_KEY } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { householdManifest } from '../../household/manifest.js';

const FLOW = householdManifest.flows.find((f) => f.id === 'enroll-device');
const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));
const CIRCLE = 'circle-enroll-test';

const freshVaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
const boot = (vaults) => createRealHouseholdAgent({ seedHousehold: false, ...vaults });

describe('the enroll-device flow (declared → verified → run → the boot cutover)', () => {
  it('the declaration verifies against the household manifest', () => {
    const r = verifyFlows(householdManifest);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('two devices, one phrase, DISTINCT per-circle addresses — the whole ceremony end to end', async () => {
    // ── Device 1: the existing device. Its per-circle address is profile-derived. ──
    const v1 = freshVaults();
    const dev1 = await boot(v1);
    const phrase = (await dev1.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(typeof phrase).toBe('string');
    const addr1 = dev1.circleAddressFor(CIRCLE);

    // ── Device 2: a fresh install. Pre-enroll it has its own random root — a stranger. ──
    const v2 = freshVaults();
    const dev2 = await boot(v2);
    const preEnrollAddr = dev2.circleAddressFor(CIRCLE);
    expect(preEnrollAddr).not.toBe(addr1);

    // The ceremony runs AS THE DECLARED FLOW: the phrase is a required secret param, so the
    // flow pauses awaiting input (the shell's masked form) — the runner never persists it.
    const saved = [];
    const runner = createFlowRunner({
      ops: OPS,
      saveInstance: (inst) => saved.push(JSON.stringify(inst)),
      callSkill: (opId, args) => dev2.callSkill('household', opId, args),
    });
    let inst = await runner.start(FLOW, {});
    expect(inst.status).toBe('awaiting-input');
    expect(inst.awaiting.params.map((p) => p.name)).toContain('mnemonic');
    const view = renderFlow(FLOW, inst, { ops: OPS });
    expect(view.form.params.find((p) => p.name === 'mnemonic').kind).toBe('secret');

    inst = await runner.resume(FLOW, inst, { input: { mnemonic: phrase, label: 'tweede telefoon' } });
    expect(inst.status).toBe('done');
    expect(inst.steps.ceremony.outcome).toBe('ok');
    const deviceId = inst.produces.deviceId;
    expect(typeof deviceId).toBe('string');
    expect(inst.produces.reloadRequired).toBe(true);
    // THE SECRETS RULE, at the ceremony: the phrase never reached the persistence seam.
    expect(saved.length).toBeGreaterThan(0);
    for (const s of saved) expect(s.includes(phrase.split(' ')[0])).toBe(false);

    // ── The "reload": device 2 boots again on the same vaults — the enrolled boot. ──
    const dev2b = await boot(v2);
    const addr2 = dev2b.circleAddressFor(CIRCLE);
    // The collision fix, live: same phrase, same circle, DISTINCT address per device…
    expect(addr2).not.toBe(addr1);
    expect(addr2).not.toBe(preEnrollAddr);
    // …and exactly the delegation-derived one (the full chain, recomputed from the phrase).
    const profileSeed = Bootstrap.fromMnemonic(phrase).deriveAgentSeed('default');
    expect(addr2).toBe(deriveCircleAddress(deriveDeviceSeed(profileSeed, deviceId), CIRCLE));

    // The delegation record self-healed onto the registry, root-signed, label kept.
    const props = (await dev2b.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
    const record = props[DEVICE_DELEGATIONS_KEY]?.value?.[deviceId]
      ?? props[DEVICE_DELEGATIONS_KEY]?.[deviceId];
    expect(record).toBeTruthy();
    expect(verifyDeviceDelegation(record)).toBe(true);
    expect(record.pubKey).toBe(deviceDelegationPubKey(deriveDeviceSeed(profileSeed, deviceId)));
    expect(record.label).toBe('tweede telefoon');

    // Stability: a third boot derives the SAME address (the delegation is this device's root now).
    const dev2c = await boot(v2);
    expect(dev2c.circleAddressFor(CIRCLE)).toBe(addr2);
  }, 60_000);

  it('a wrong phrase ends the flow with the invalid-phrase outcome and enrolls nothing', async () => {
    const v = freshVaults();
    const dev = await boot(v);
    const before = dev.circleAddressFor(CIRCLE);
    const runner = createFlowRunner({
      ops: OPS,
      callSkill: (opId, args) => dev.callSkill('household', opId, args),
    });
    let inst = await runner.start(FLOW, {});
    inst = await runner.resume(FLOW, inst, { input: { mnemonic: 'niet een echte herstelzin' } });
    expect(inst.steps.ceremony.outcome).toBe('invalid-phrase');
    // nothing enrolled: the next boot still derives the same (profile) address
    const again = await boot(v);
    expect(again.circleAddressFor(CIRCLE)).toBe(before);
  }, 60_000);
});
