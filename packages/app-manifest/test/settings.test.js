/**
 * manifest.settings — B · (ruling) declarative settings schema.
 * Validates the shape the creation wizard + inline forms render from.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, SETTING_KINDS, SETTING_SCOPES, buildSettingsForm } from '../src/index.js';

const base = (settings) => ({ app: 'demo', itemTypes: ['thing'], operations: [], settings });

describe('SETTING_KINDS / SETTING_SCOPES', () => {
  it('are the frozen ruling-Q1 allow-lists', () => {
    // `multi` joined the list on 2026-07-29 for the conversation-kinds axis (decision 3). It is the one
    // kind whose options are NOT declared here: it names an `optionsFrom` source the shell resolves
    // against a registry, because a list frozen into a manifest drifts the moment the registry gains a
    // member. Extending this allow-list is deliberate — that is why this test exists.
    expect(SETTING_KINDS).toEqual(['toggle', 'choice', 'multi', 'text', 'number', 'member']);
    expect(SETTING_SCOPES).toEqual(['circle', 'user']);
    expect(() => SETTING_KINDS.push('x')).toThrow();
  });
});

describe('settings validation — happy path', () => {
  it('accepts a well-formed settings array covering every kind + scope', () => {
    const m = base([
      { key: 'assignable',   label: 'Members can be assigned tasks', kind: 'toggle', default: true, scope: 'circle' },
      { key: 'visibility',   label: 'Who can see the board', kind: 'choice', of: ['members', 'admins'], default: 'members' },
      { key: 'displayName',  label: 'Circle name', kind: 'text', scope: 'circle', adminOnly: true },
      { key: 'quietHours',   label: 'Quiet hours (24h)', kind: 'number', default: 22 },
      { key: 'owner',        label: 'Owner', kind: 'member', scope: 'circle' },
      { key: 'shareLocation', label: 'Share my location', kind: 'toggle', scope: 'user', default: false,
        description: 'When on, the app may share your coarse location with the circle.' },
      { key: 'realName',     label: 'Reveal my real name', kind: 'toggle', scope: 'user',
        requiredWhen: { shareLocation: true } },
    ]);
    const { ok, errors } = validateManifest(m);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  it('a manifest with no settings is still valid (forward-additive)', () => {
    expect(validateManifest({ app: 'x', itemTypes: [], operations: [] }).ok).toBe(true);
  });
});

describe('settings validation — rejections', () => {
  const err = (settings, code) => {
    const { errors } = validateManifest(base(settings));
    return code ? errors.some((e) => e.code === code) : errors;
  };

  it('rejects a non-array settings', () => {
    expect(validateManifest({ ...base([]), settings: {} }).ok).toBe(false);
  });
  it('rejects a duplicate key', () => {
    expect(err([{ key: 'a', label: 'A', kind: 'toggle' }, { key: 'a', label: 'A2', kind: 'text' }], 'duplicate-setting')).toBe(true);
  });
  it('rejects an unknown kind', () => {
    const e = err([{ key: 'a', label: 'A', kind: 'slider' }]);
    expect(e.some((x) => x.path === '/settings/0/kind')).toBe(true);
  });
  it("rejects kind='choice' without a non-empty of[]", () => {
    const e = err([{ key: 'a', label: 'A', kind: 'choice' }]);
    expect(e.some((x) => x.path === '/settings/0/of')).toBe(true);
  });
  it('rejects an unknown scope', () => {
    const e = err([{ key: 'a', label: 'A', kind: 'toggle', scope: 'device' }]);
    expect(e.some((x) => x.path === '/settings/0/scope')).toBe(true);
  });
  it('rejects a default that does not fit the kind', () => {
    expect(err([{ key: 'a', label: 'A', kind: 'toggle', default: 'yes' }], 'bad-default')).toBe(true);
    expect(err([{ key: 'b', label: 'B', kind: 'number', default: 'x' }], 'bad-default')).toBe(true);
    expect(err([{ key: 'c', label: 'C', kind: 'choice', of: ['x', 'y'], default: 'z' }], 'bad-default')).toBe(true);
  });
  it('rejects an empty requiredWhen', () => {
    const e = err([{ key: 'a', label: 'A', kind: 'toggle', requiredWhen: {} }]);
    expect(e.some((x) => x.path === '/settings/0/requiredWhen')).toBe(true);
  });
});

describe("the `multi` kind — options come from a registry, not from the manifest", () => {
  it('accepts a multi that names its option source', () => {
    const m = {
      name: 'x', origin: 'x', version: '1', ops: [],
      settings: [{ key: 'conversationKinds', label: 'Conversation', kind: 'multi', optionsFrom: 'conversationKinds', scope: 'circle' }],
    };
    expect(validateManifest(m).errors.filter((e) => /settings/.test(e.path))).toEqual([]);
  });

  it('REFUSES a multi with no option source — that is the "declared but unpopulated" failure', () => {
    const m = {
      name: 'x', origin: 'x', version: '1', ops: [],
      settings: [{ key: 'k', label: 'K', kind: 'multi', scope: 'circle' }],
    };
    const errs = validateManifest(m).errors.filter((e) => /optionsFrom/.test(e.path));
    expect(errs.length).toBeGreaterThan(0);
  });

  it('REFUSES a multi that freezes its list with `of` — it would drift from the registry', () => {
    const m = {
      name: 'x', origin: 'x', version: '1', ops: [],
      settings: [{ key: 'k', label: 'K', kind: 'multi', optionsFrom: 'conversationKinds', of: ['a', 'b'], scope: 'circle' }],
    };
    const errs = validateManifest(m).errors.filter((e) => /\/of$/.test(e.path));
    expect(errs.length).toBeGreaterThan(0);
  });

  it('the projector passes `optionsFrom` through so a shell can resolve it', () => {
    const m = {
      name: 'x', origin: 'x', version: '1', ops: [],
      settings: [{ key: 'conversationKinds', label: 'Conversation', kind: 'multi', optionsFrom: 'conversationKinds', scope: 'circle' }],
    };
    const form = buildSettingsForm(m, { scope: 'circle' });
    expect(form[0].control).toBe('multi');
    expect(form[0].optionsFrom).toBe('conversationKinds');
    expect(form[0].choices).toBeUndefined();      // never a frozen list
  });
});
