/**
 * Bundle F follow-up — state-machine smoke for the 6 wizards
 * added alongside conflictDispute (2026-05-26).
 *
 * Same shape as test/wizardRegistry.test.js — pins the portable
 * contract that each RN modal consumes.  The modal itself (React
 * render) is verified by Detox; here we verify the substrate
 * dispatches go through the right (origin, opId, args).
 */
import { describe, it, expect } from 'vitest';

import * as createGroupState         from '../../basis/src/core/wizards/createGroupState.js';
import * as joinGroupState           from '../../basis/src/core/wizards/joinGroupState.js';
import * as restoreFromMnemonicState from '../../basis/src/core/wizards/restoreFromMnemonicState.js';
import * as postAudienceState        from '../../basis/src/core/wizards/postAudienceState.js';
import * as encryptedBackupState     from '../../basis/src/core/wizards/encryptedBackupState.js';
import * as settingsState            from '../../basis/src/core/wizards/settingsState.js';

describe('Bundle F P2 — createGroup state machine', () => {
  it('slugify produces buurt-id-shaped strings', () => {
    expect(createGroupState.slugify('Onze Buurt 2026!')).toBe('onze-buurt-2026');
    expect(createGroupState.isValidSlug('onze-buurt')).toBe(true);
    expect(createGroupState.isValidSlug('UPPERCASE')).toBe(false);
  });

  it('finalSubmit calls stoop.createGroupV2 with assembled rules', async () => {
    const calls = [];
    const callSkill = async (o, op, args) => {
      calls.push({ o, op, args });
      return { ok: true, groupId: args.groupId };
    };
    const s = createGroupState.initialState();
    s.name              = 'Onze Buurt';
    s.groupId           = 'onze-buurt';
    s.purpose           = 'Sharing tools';
    s.tags              = 'tools, quiet';
    s.additionalAdmins  = 'https://alice.example/#me';
    s.accessPolicy      = 'request';
    s.conflictPolicy    = 'mediation';
    s.storagePolicy     = 'no-pod';
    const { result }    = await createGroupState.finalSubmit({ state: { ...s }, callSkill });
    expect(result?.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('createGroupV2');
    expect(calls[0].args.groupId).toBe('onze-buurt');
    expect(calls[0].args.rules.purpose).toBe('Sharing tools');
    expect(calls[0].args.rules.tags).toEqual(['tools', 'quiet']);
    expect(calls[0].args.rules.accessPolicy).toBe('request');
  });
});

describe('Bundle F P2 — joinGroup state machine', () => {
  it('decodeInvite handles base64url onderling-invite URLs', () => {
    const s = joinGroupState.initialState();
    const payload = { kind: 'membershipCode', code: 'C42', groupId: 'g1' };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    joinGroupState.decodeInvite(`onderling-invite://${b64}`, s);
    expect(s.inviteParseError).toBeFalsy();
    expect(s.invite).toEqual(payload);
  });

  it('decodeInvite raises a parse error for garbage input', () => {
    const s = joinGroupState.initialState();
    joinGroupState.decodeInvite('not-an-invite', s);
    expect(s.inviteParseError).toBeTruthy();
  });

  it('isValidHandle accepts shape-conformant strings', () => {
    expect(joinGroupState.isValidHandle('alice')).toBe(true);
    expect(joinGroupState.isValidHandle('UPPER')).toBe(false);
    expect(joinGroupState.isValidHandle('-leading-dash')).toBe(false);
    expect(joinGroupState.isValidHandle('trailing-dash-')).toBe(false);
  });
});

describe('Bundle F P2 — restoreFromMnemonic state machine', () => {
  it('isMnemonicValid accepts 12 or 24 words only', () => {
    expect(restoreFromMnemonicState.isMnemonicValid(
      'a a a a a a a a a a a a',
    )).toBe(true);
    expect(restoreFromMnemonicState.isMnemonicValid(
      Array(24).fill('a').join(' '),
    )).toBe(true);
    expect(restoreFromMnemonicState.isMnemonicValid(
      'a a a',
    )).toBe(false);
  });

  it('submitRestore installs the owner root then calls stoop.restoreFromMnemonic', async () => {
    const calls = [];
    const callSkill = async (o, op, args) => {
      calls.push({ o, op, args });
      return { ok: true };
    };
    const s = restoreFromMnemonicState.initialState();
    s.mnemonic = Array(12).fill('a').join(' ');
    const after = await restoreFromMnemonicState.submitRestore({ state: { ...s }, callSkill });
    // step 1b — the owner root (household.restoreOwnerPhrase) is installed FIRST, then the legacy stoop restore
    expect(calls).toHaveLength(2);
    expect(calls[0].op).toBe('restoreOwnerPhrase');
    expect(calls[1].op).toBe('restoreFromMnemonic');
    expect(calls[1].args.confirm).toBe(true);
    expect(after.successResult).toBeTruthy();
  });
});

describe('Bundle F P2 — postAudience state machine', () => {
  it('buildAudience omits empty slots', () => {
    const s = postAudienceState.initialState();
    s.text     = 'Anyone got a ladder?';
    s.tags     = 'ladder';
    s.distanceKm = 5;
    s.minTrust   = 'known';
    const a = postAudienceState.buildAudience(s);
    expect(a).toEqual({ minTrust: 'known', tags: ['ladder'], distanceKm: 5 });
  });

  it('submitPost calls stoop.postRequest with audience', async () => {
    const calls = [];
    const callSkill = async (o, op, args) => {
      calls.push({ o, op, args });
      return { ok: true, id: 'post-1' };
    };
    const s = postAudienceState.initialState();
    s.text = 'Hi';
    s.kind = 'announce';
    const { result } = await postAudienceState.submitPost({ state: { ...s }, callSkill });
    expect(result?.ok).toBe(true);
    expect(calls[0].op).toBe('postRequest');
    expect(calls[0].args.text).toBe('Hi');
    expect(calls[0].args.kind).toBe('announce');
  });
});

describe('Bundle F P2 — encryptedBackup state machine', () => {
  it('canCreateBackup requires matching passphrase + confirm', () => {
    const s = encryptedBackupState.initialState();
    s.passphrase = 'secret';
    s.confirm    = 'secret';
    expect(encryptedBackupState.canCreateBackup(s)).toBe(true);
    s.confirm    = 'mismatch';
    expect(encryptedBackupState.canCreateBackup(s)).toBe(false);
  });

  it('submitCreateBackup advances to step 2 on success', async () => {
    const callSkill = async () => ({ ok: true, blob: 'fake-encrypted-bytes' });
    const s = encryptedBackupState.initialState();
    s.passphrase = 'pw';
    s.confirm    = 'pw';
    const after = await encryptedBackupState.submitCreateBackup({ state: { ...s }, callSkill });
    expect(after.step).toBe(2);
    expect(after.blob).toBe('fake-encrypted-bytes');
  });
});

describe('Bundle F P2 — settings state machine', () => {
  it('loadSettings hydrates profile + holiday from stoop', async () => {
    const callSkill = async (o, op) => {
      if (op === 'getStoopProfile') return { handle: 'alice', displayName: 'Alice' };
      if (op === 'getHolidayMode')  return { holidayMode: true };
      return null;
    };
    const s = settingsState.initialState();
    const after = await settingsState.loadSettings({ state: { ...s }, callSkill });
    expect(after.profile.handle).toBe('alice');
    expect(after.holiday).toBe(true);
    expect(after.loading).toBe(false);
  });

  it('saveHandle short-circuits on empty input', async () => {
    const r = await settingsState.saveHandle({ callSkill: async () => null, handle: '   ' });
    expect(r.ok).toBe(false);
  });

  it('setHolidayMode round-trips via callSkill', async () => {
    const calls = [];
    const callSkill = async (o, op, args) => {
      calls.push({ o, op, args });
      return { holidayMode: !!args.on };
    };
    const r = await settingsState.setHolidayMode({ callSkill, on: true });
    expect(r.ok).toBe(true);
    expect(r.holidayMode).toBe(true);
    expect(calls[0].op).toBe('setHolidayMode');
  });
});
