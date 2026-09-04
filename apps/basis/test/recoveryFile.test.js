/**
 * The RECOVERY FILE — the pod-less carrier of the circle list, through the real agent.
 *
 *   JOURNEY 4 (file branch) — Anna, no pod: she saved a recovery file; her phone is gone; on the new
 *   phone she restores her phrase and loads the file. Her circles come back, with the wrapped-key ref.
 *   A stranger holding her file cannot open it; a random file is refused as not a recovery file.
 *   Plus the shared wizard state over a stub callSkill.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { circleMembershipsOf } from '@onderling/agent-registry';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { submitExport, submitImport, initialExportState, initialImportState, importErrorKey } from '../src/core/wizards/recoveryFileState.js';

const CIRCLE = 'circle-oosterpoort';
const boot = (vaults) => createRealHouseholdAgent({
  seedHousehold: false, seedDemoData: false,
  ownerRootVault: vaults.owner, chatVault: vaults.chat, registryBackend: createMemoryBackend(),
});

describe('the recovery file — journey 4, file branch', () => {
  it('export on the old phone → import on the new one: the circles and the key ref come back, sealed in between', async () => {
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const phone = await boot(anna);
    await phone.callSkill('agents', 'setProfileCircleMembership', {
      id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:anna-oosterpoort',
      key: { ref: 'dec:groupkey-oosterpoort-v1', posture: 'p2' },
    });
    const exported = await phone.callSkill('household', 'exportRecoveryFile', {});
    expect(exported).toMatchObject({ ok: true, circles: 1 });
    expect(exported.file, 'sealed: the circle id is not in the file in clear').not.toContain(CIRCLE);
    expect(JSON.parse(exported.file).kind).toBe('onderling-recovery-v1');

    // ── the phone is gone ── a new install, the phrase re-derived the same root, no pod, no QR.
    const newPhone = await boot(anna);
    expect((await newPhone.reopenMemberCircles()).reopened, 'before the file: nothing to re-open').not.toContain(CIRCLE);
    const imported = await newPhone.callSkill('household', 'importRecoveryFile', { file: exported.file });
    expect(imported.ok, imported.error).toBe(true);
    expect(imported.circles).toContain(CIRCLE);
    const props = await newPhone.callSkill('agents', 'getProfileProperties', { id: 'default' });
    const memberships = circleMembershipsOf({ properties: props?.properties ?? {} });
    expect(memberships[CIRCLE], 'the wrapped-key ref rode along').toMatchObject({ handle: 'anna', key: { ref: 'dec:groupkey-oosterpoort-v1' } });
  });

  it("a stranger cannot open her file, and a random file is not a recovery file", async () => {
    const anna = { owner: new VaultMemory(), chat: new VaultMemory() };
    const phone = await boot(anna);
    await phone.callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId: CIRCLE, handle: 'anna', address: 'relay:a' });
    const { file } = await phone.callSkill('household', 'exportRecoveryFile', {});
    const stranger = await boot({ owner: new VaultMemory(), chat: new VaultMemory() });
    expect(await stranger.callSkill('household', 'importRecoveryFile', { file })).toMatchObject({ ok: false, error: 'not-your-file' });
    expect(await stranger.callSkill('household', 'importRecoveryFile', { file: '{"hello":"world"}' })).toMatchObject({ ok: false, error: 'unreadable-file' });
    expect((await stranger.reopenMemberCircles()).reopened, 'nothing leaked into the stranger').not.toContain(CIRCLE);
  });
});

describe('the shared wizard state', () => {
  it('export: keeps the file and a filename; import: maps refusals to translation keys', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push([app, op]);
      if (op === 'exportRecoveryFile') return { ok: true, file: '{"kind":"x"}', circles: 2 };
      if (op === 'importRecoveryFile') return args.file === 'good' ? { ok: true, agents: 1, circles: ['c'] } : { ok: false, error: 'not-your-file' };
      return {};
    };
    const ex = await submitExport({ state: initialExportState(), callSkill });
    expect(ex).toMatchObject({ file: '{"kind":"x"}', circles: 2, submitting: false });
    expect(ex.filename).toMatch(/^onderling-herstel-.*\.json$/);
    const bad = await submitImport({ state: { ...initialImportState(), fileText: 'bad' }, callSkill });
    expect(bad.submitError).toBe('not-your-file');
    expect(importErrorKey(bad.submitError)).toBe('circle.wizard.recovery.err_not_yours');
    const good = await submitImport({ state: { ...initialImportState(), fileText: 'good' }, callSkill });
    expect(good.result).toEqual({ agents: 1, circles: ['c'] });
    expect(calls.every(([app]) => app === 'household')).toBe(true);
  });
});
