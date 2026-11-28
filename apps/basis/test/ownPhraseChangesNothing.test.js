/**
 * THE PHRASE THIS DEVICE ALREADY IS CHANGES NOTHING, AND SAYS SO BEFORE THE CONFIRM STEP.
 *
 * The phone walk: typing the phone's OWN recovery phrase in Settings, Recovery ran the whole restore, forgot the
 * running self as a throwaway, and the person's circle and name were gone. A phrase that derives the identity this
 * device already speaks as is not a restore: the op answers `alreadyYou` and touches nothing, and the wizard asks
 * that before its confirm step (a check that restores nothing), so the person never reaches "will be lost" for it.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { Bootstrap } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { initialState, checkPhrase } from '../src/core/wizards/restoreFromMnemonicState.js';

const boot = (v) => createRealHouseholdAgent({ ownerRootVault: v.ownerRootVault, chatVault: v.chatVault });
const fresh = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });

describe('the device\'s own phrase', () => {
  it('restoreOwnerPhrase with the phrase this device is: alreadyYou, no restart, the same identity after a reboot', async () => {
    const v = fresh();
    const a = await boot(v);
    const before = a.sa.agent.identity.pubKey;
    const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic });
    expect(res).toMatchObject({ ok: true, alreadyYou: true });
    expect(res.reloadRequired, 'nothing to start again for').toBeFalsy();
    const again = await boot(v);
    expect(again.sa.agent.identity.pubKey).toBe(before);
  });

  it('a check (checkOnly) restores nothing: another person\'s phrase is checked, and this device stays itself', async () => {
    const v = fresh();
    const a = await boot(v);
    const before = a.sa.agent.identity.pubKey;
    const other = Bootstrap.create().mnemonic;
    const res = await a.callSkill('household', 'restoreOwnerPhrase', { mnemonic: other, checkOnly: true });
    expect(res).toMatchObject({ ok: true, alreadyYou: false, checked: true });
    expect(res.reloadRequired).toBeFalsy();
    const again = await boot(v);
    expect(again.sa.agent.identity.pubKey, 'a check wrote nothing').toBe(before);
  });

  it('the wizard asks before its confirm step: the own phrase stops at "already you", another goes on', async () => {
    const a = await boot(fresh());
    const { mnemonic } = await a.callSkill('household', 'revealOwnerPhrase', {});
    const callSkill = (app, op, args) => a.callSkill(app, op, args);
    const own = await checkPhrase({ state: { ...initialState(), mnemonic }, callSkill });
    expect(own.alreadyYou).toBe(true);
    expect(own.step, 'never reaches the confirm step').toBe(1);
    const other = await checkPhrase({ state: { ...initialState(), mnemonic: Bootstrap.create().mnemonic }, callSkill });
    expect(other.alreadyYou).toBe(false);
    expect(other.step).toBe(2);
  });
});
