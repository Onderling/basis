import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CIRCLE_POLICY, CIRCLE_FEATURES,
  normalizeCirclePolicy, mergeCirclePolicy,
  isFeatureEnabled, enabledFeatures,
  defaultViewModeFromPolicy, autoEnacts,
  DEFAULT_MEMBER_OVERRIDE, normalizeMemberOverride, mergeMemberOverride,
  shouldPushNotify,
  DECISION_KINDS, requiredClassFor, settingsChangeNeedsProposal, decisionClassFor, GOVERNANCE_ACTIONS,
} from '../../src/v2/circlePolicy.js';

describe('circlePolicy · normalizeCirclePolicy', () => {
  it('fills defaults for an empty/garbage input', () => {
    expect(normalizeCirclePolicy()).toEqual(DEFAULT_CIRCLE_POLICY);
    expect(normalizeCirclePolicy(null)).toEqual(DEFAULT_CIRCLE_POLICY);
    expect(normalizeCirclePolicy('nope')).toEqual(DEFAULT_CIRCLE_POLICY);
  });

  it('keeps valid enum values and rejects invalid ones', () => {
    const p = normalizeCirclePolicy({ llmTool: 'local', pod: 'shared', agents: 'bogus' });
    expect(p.llmTool).toBe('local');
    expect(p.pod).toBe('shared');
    expect(p.agents).toBe('admin-approval'); // invalid → default
  });

  it('merges features per-key and ignores non-boolean / unknown features', () => {
    const p = normalizeCirclePolicy({ features: { noticeboard: true, chat: 'yes', bogus: true } });
    expect(p.features.noticeboard).toBe(true);
    expect(p.features.chat).toBe(true); // non-boolean → default (true)
    expect(Object.keys(p.features).sort()).toEqual([...CIRCLE_FEATURES].sort());
    expect(p.features.bogus).toBeUndefined();
  });

  it('keeps only string admins', () => {
    expect(normalizeCirclePolicy({ admins: ['a', 2, null, 'b'] }).admins).toEqual(['a', 'b']);
  });

  it('S6.C — policy.apps defaults to null (all apps) + keeps a string list', () => {
    expect(normalizeCirclePolicy().apps).toBeNull();
    expect(normalizeCirclePolicy({ apps: ['stoop', 'tasks'] }).apps).toEqual(['stoop', 'tasks']);
    expect(normalizeCirclePolicy({ apps: ['stoop', 7, null] }).apps).toEqual(['stoop']);   // strings only
    expect(normalizeCirclePolicy({ apps: 'nope' }).apps).toBeNull();                        // non-array → all
  });

  it('S6.C — a policy.apps edit replaces the list (not per-key merge like features)', () => {
    const merged = mergeCirclePolicy({ apps: ['stoop', 'tasks'] }, { apps: ['stoop'] });
    expect(merged.apps).toEqual(['stoop']);
  });
});

describe('circlePolicy · isFeatureEnabled (P6.1)', () => {
  it('returns the default for null / undefined / non-object policy', () => {
    expect(isFeatureEnabled(null,      'chat')).toBe(true);   // default on
    expect(isFeatureEnabled(undefined, 'tasks')).toBe(false); // default off
    expect(isFeatureEnabled('garbage', 'houseRules')).toBe(true);
    expect(isFeatureEnabled(42,        'memberDirectory')).toBe(true);
  });

  it('returns the default when policy has no .features field', () => {
    expect(isFeatureEnabled({}, 'chat')).toBe(true);
    expect(isFeatureEnabled({ view: 'chat' }, 'tasks')).toBe(false);
    expect(isFeatureEnabled({ features: null }, 'houseRules')).toBe(true);
  });

  it('returns the explicit flag when set', () => {
    const off = { features: { chat: false, houseRules: false } };
    expect(isFeatureEnabled(off, 'chat')).toBe(false);
    expect(isFeatureEnabled(off, 'houseRules')).toBe(false);
    // unset → default
    expect(isFeatureEnabled(off, 'memberDirectory')).toBe(true);
  });

  it('rejects unknown feature keys', () => {
    expect(isFeatureEnabled({ features: { bogus: true } }, 'bogus')).toBe(false);
    expect(isFeatureEnabled(DEFAULT_CIRCLE_POLICY,         'bogus')).toBe(false);
  });

  it('treats non-boolean flag values as the default', () => {
    const garbage = { features: { chat: 'yes', tasks: 1 } };
    expect(isFeatureEnabled(garbage, 'chat')).toBe(true);   // default on
    expect(isFeatureEnabled(garbage, 'tasks')).toBe(false); // default off
  });
});

describe('circlePolicy · enabledFeatures (P6.1)', () => {
  it('returns the default-enabled set for a null/empty policy', () => {
    // Defaults: chat, noticeboard, houseRules, memberDirectory (S1 #1 flipped noticeboard on).
    expect(enabledFeatures(null)).toEqual(['chat', 'noticeboard', 'houseRules', 'memberDirectory']);
    expect(enabledFeatures({})).toEqual(['chat', 'noticeboard', 'houseRules', 'memberDirectory']);
  });

  it('respects explicit on/off overrides + preserves CIRCLE_FEATURES order', () => {
    const p = { features: {
      chat: false, noticeboard: true, tasks: true,
      houseRules: false, memberDirectory: true,
    } };
    expect(enabledFeatures(p)).toEqual(['noticeboard', 'tasks', 'memberDirectory']);
  });

  it('the full-on circle enables every CIRCLE_FEATURES key', () => {
    const allOn = { features: Object.fromEntries(CIRCLE_FEATURES.map((k) => [k, true])) };
    expect(enabledFeatures(allOn)).toEqual([...CIRCLE_FEATURES]);
  });
});

describe('circlePolicy · defaultViewModeFromPolicy (§4)', () => {
  it("maps each view axis value to its landing mode", () => {
    expect(defaultViewModeFromPolicy({ view: 'chat' })).toBe('chat');
    expect(defaultViewModeFromPolicy({ view: 'screen' })).toBe('screen');
    // retired value (batch 5) — an OLD stored blob still lands on chat, never on the 'screen' default
    expect(defaultViewModeFromPolicy({ view: 'cross-stream' })).toBe('chat');
  });

  it("MIGRATION (batch 5): a stored 'cross-stream' view normalizes to 'chat', not to the default", () => {
    expect(normalizeCirclePolicy({ view: 'cross-stream' }).view).toBe('chat');
    // …and the retired value is gone from the settable enum (no radio renders it any more).
    expect(defaultViewModeFromPolicy({ view: 'garbage' })).toBe('screen');
  });

  it("falls back to the policy default ('screen' → screen) for missing/invalid input", () => {
    // DEFAULT_CIRCLE_POLICY.view is 'screen' → 'screen'.
    expect(defaultViewModeFromPolicy(null)).toBe('screen');
    expect(defaultViewModeFromPolicy(undefined)).toBe('screen');
    expect(defaultViewModeFromPolicy('garbage')).toBe('screen');
    expect(defaultViewModeFromPolicy(42)).toBe('screen');
    expect(defaultViewModeFromPolicy({})).toBe('screen');           // no view key
    expect(defaultViewModeFromPolicy({ view: 'bogus' })).toBe('screen'); // invalid enum
  });

  it("only ever returns one of the two mode switch values", () => {
    for (const v of ['chat', 'screen', 'cross-stream', 'bogus', undefined]) {
      expect(['chat', 'screen']).toContain(defaultViewModeFromPolicy({ view: v }));
    }
  });
});

describe('circlePolicy · ε.6 catchUpChooserMode', () => {
  it("defaults to 'auto'", () => {
    expect(DEFAULT_CIRCLE_POLICY.catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy().catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy({}).catchUpChooserMode).toBe('auto');
  });

  it("round-trips 'prompt'", () => {
    const p = normalizeCirclePolicy({ catchUpChooserMode: 'prompt' });
    expect(p.catchUpChooserMode).toBe('prompt');
    // idempotent
    expect(normalizeCirclePolicy(p).catchUpChooserMode).toBe('prompt');
  });

  it("invalid value falls back to 'auto'", () => {
    expect(normalizeCirclePolicy({ catchUpChooserMode: 'bogus' }).catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy({ catchUpChooserMode: 42 }).catchUpChooserMode).toBe('auto');
    expect(normalizeCirclePolicy({ catchUpChooserMode: null }).catchUpChooserMode).toBe('auto');
  });

  it('merges through mergeCirclePolicy without disturbing other axes', () => {
    const base = normalizeCirclePolicy({ pod: 'shared', llmTool: 'local' });
    const next = mergeCirclePolicy(base, { catchUpChooserMode: 'prompt' });
    expect(next.catchUpChooserMode).toBe('prompt');
    expect(next.pod).toBe('shared');
    expect(next.llmTool).toBe('local');
  });
});

describe('circlePolicy · sharePosture (PLAN-circle-share-policy slice 1)', () => {
  it("defaults to 'closed' (INTERIM conservative default)", () => {
    expect(DEFAULT_CIRCLE_POLICY.sharePosture).toBe('closed');
    expect(normalizeCirclePolicy().sharePosture).toBe('closed');
    expect(normalizeCirclePolicy({}).sharePosture).toBe('closed');
  });

  it('is present on the normalised policy', () => {
    expect(normalizeCirclePolicy()).toHaveProperty('sharePosture');
  });

  it('round-trips each valid mode', () => {
    for (const mode of ['closed', 'copy', 'trusted', 'registered']) {
      const p = normalizeCirclePolicy({ sharePosture: mode });
      expect(p.sharePosture).toBe(mode);
      // idempotent
      expect(normalizeCirclePolicy(p).sharePosture).toBe(mode);
    }
  });

  it("invalid value clamps to the default ('closed')", () => {
    expect(normalizeCirclePolicy({ sharePosture: 'bogus' }).sharePosture).toBe('closed');
    expect(normalizeCirclePolicy({ sharePosture: 42 }).sharePosture).toBe('closed');
    expect(normalizeCirclePolicy({ sharePosture: null }).sharePosture).toBe('closed');
  });

  it('merges through mergeCirclePolicy without disturbing other axes', () => {
    const base = normalizeCirclePolicy({ pod: 'shared', storagePosture: 'p2' });
    const next = mergeCirclePolicy(base, { sharePosture: 'trusted' });
    expect(next.sharePosture).toBe('trusted');
    expect(next.pod).toBe('shared');
    expect(next.storagePosture).toBe('p2');
  });
});

describe('circlePolicy · mergeCirclePolicy', () => {
  it('applies a patch over a base without dropping other features', () => {
    const base = normalizeCirclePolicy({ features: { noticeboard: true }, pod: 'shared' });
    const next = mergeCirclePolicy(base, { features: { tasks: true }, llmTool: 'cloud' });
    expect(next.features.noticeboard).toBe(true); // preserved
    expect(next.features.tasks).toBe(true);       // added
    expect(next.pod).toBe('shared');              // preserved
    expect(next.llmTool).toBe('cloud');           // changed
  });
});

describe('memberOverride', () => {
  it('normalises defaults + coerces booleans', () => {
    expect(normalizeMemberOverride()).toEqual(DEFAULT_MEMBER_OVERRIDE);
    const o = normalizeMemberOverride({ chatOff: 1, agentsMayContactMe: false, flowThrough: { tasksToPersonal: 'y' } });
    expect(o.chatOff).toBe(true);
    expect(o.agentsMayContactMe).toBe(false);
    expect(o.flowThrough.tasksToPersonal).toBe(true);
    expect(o.flowThrough.calendarToPersonal).toBe(false);
  });

  it('deep-merges flowThrough on edit', () => {
    const base = normalizeMemberOverride({ flowThrough: { tasksToPersonal: true } });
    const next = mergeMemberOverride(base, { flowThrough: { calendarToPersonal: true } });
    expect(next.flowThrough).toEqual({ tasksToPersonal: true, calendarToPersonal: true });
  });

  // split push toggles (four kinds).
  it('defaults push to the four-kind shape (board 6A · α.5b)', () => {
    expect(DEFAULT_MEMBER_OVERRIDE.push).toEqual({
      onMention:      true,
      onEveryMessage: false,
      onNewItem:      true,
      onProposal:     true,
    });
    expect(normalizeMemberOverride({}).push).toEqual({
      onMention:      true,
      onEveryMessage: false,
      onNewItem:      true,
      onProposal:     true,
    });
  });

  it('coerces push keys to booleans + preserves explicit values', () => {
    const o = normalizeMemberOverride({ push: { onMention: false, onEveryMessage: 'y' /* non-bool */ } });
    expect(o.push.onMention).toBe(false);
    expect(o.push.onEveryMessage).toBe(false);
    // unspecified keys keep their defaults (newItem/proposal default true)
    expect(o.push.onNewItem).toBe(true);
    expect(o.push.onProposal).toBe(true);
    const o2 = normalizeMemberOverride({ push: { onEveryMessage: true, onNewItem: false, onProposal: false } });
    expect(o2.push).toEqual({
      onMention:      true,
      onEveryMessage: true,
      onNewItem:      false,
      onProposal:     false,
    });
  });

  it('deep-merges push on edit', () => {
    const base = normalizeMemberOverride({ push: { onMention: true, onEveryMessage: false } });
    const next = mergeMemberOverride(base, { push: { onEveryMessage: true, onProposal: false } });
    expect(next.push).toEqual({
      onMention:      true,
      onEveryMessage: true,
      onNewItem:      true,    // preserved default
      onProposal:     false,   // patched
    });
  });

  it('α.5b — round-trips a stored doc with the four push keys', () => {
    const stored = {
      chatOff: true,
      revealOpen: false,
      agentsMayContactMe: false,
      push: { onMention: false, onEveryMessage: true, onNewItem: false, onProposal: true },
      flowThrough: { tasksToPersonal: true, calendarToPersonal: false },
    };
    const round = normalizeMemberOverride(stored);
    expect(round.push).toEqual({
      onMention: false, onEveryMessage: true, onNewItem: false, onProposal: true,
    });
    // a second pass is stable (idempotent)
    expect(normalizeMemberOverride(round)).toEqual(round);
  });
});

describe('shouldPushNotify (P6.M4 + α.5b)', () => {
  it('returns push.onMention for kind=mention', () => {
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: false } }, 'mention')).toBe(true);
    expect(shouldPushNotify({ push: { onMention: false, onEveryMessage: false } }, 'mention')).toBe(false);
  });

  it('returns push.onEveryMessage for kind=message', () => {
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: true  } }, 'message')).toBe(true);
    expect(shouldPushNotify({ push: { onMention: true,  onEveryMessage: false } }, 'message')).toBe(false);
  });

  it('α.5b — returns push.onNewItem for kind=newItem', () => {
    expect(shouldPushNotify({ push: { onNewItem: true  } }, 'newItem')).toBe(true);
    expect(shouldPushNotify({ push: { onNewItem: false } }, 'newItem')).toBe(false);
  });

  it('α.5b — returns push.onProposal for kind=proposal', () => {
    expect(shouldPushNotify({ push: { onProposal: true  } }, 'proposal')).toBe(true);
    expect(shouldPushNotify({ push: { onProposal: false } }, 'proposal')).toBe(false);
  });

  it('uses the defaults when override is empty', () => {
    expect(shouldPushNotify({}, 'mention')).toBe(true);
    expect(shouldPushNotify({}, 'message')).toBe(false);
    expect(shouldPushNotify({}, 'newItem')).toBe(true);
    expect(shouldPushNotify({}, 'proposal')).toBe(true);
  });

  it('returns false for unknown kinds (α.5b — new kinds stay silent until wired)', () => {
    expect(shouldPushNotify(DEFAULT_MEMBER_OVERRIDE, 'bogus')).toBe(false);
    expect(shouldPushNotify(DEFAULT_MEMBER_OVERRIDE)).toBe(false);
  });
});

describe('B · Slice 2 — capabilities freedom template + settings values', () => {
  it('default policy carries empty capabilities + settings maps', () => {
    expect(DEFAULT_CIRCLE_POLICY.capabilities).toEqual({});
    expect(DEFAULT_CIRCLE_POLICY.settings).toEqual({});
  });
  it('normalize keeps object maps + coerces bad values to {}', () => {
    const p = normalizeCirclePolicy({ capabilities: { 'tasks add task': { enabled: false } }, settings: { 'household.assignable': true } });
    expect(p.capabilities).toEqual({ 'tasks add task': { enabled: false } });
    expect(p.settings).toEqual({ 'household.assignable': true });
    expect(normalizeCirclePolicy({ capabilities: 'nope', settings: [1] }).capabilities).toEqual({});
    expect(normalizeCirclePolicy({ settings: [1] }).settings).toEqual({});
  });
  it('merge shallow-merges at the entry key (patch replaces a row/value, keeps siblings)', () => {
    const base = { capabilities: { 'a x y': { enabled: true }, 'b x y': { enabled: true } }, settings: { 'app.k1': 1 } };
    const merged = mergeCirclePolicy(base, { capabilities: { 'b x y': { enabled: false } }, settings: { 'app.k2': 2 } });
    expect(merged.capabilities).toEqual({ 'a x y': { enabled: true }, 'b x y': { enabled: false } });
    expect(merged.settings).toEqual({ 'app.k1': 1, 'app.k2': 2 });
  });
});

describe('B · Slice 4 — member capabilityOptOuts', () => {
  it('defaults to [], dedupes + filters non-strings on normalize', () => {
    expect(DEFAULT_MEMBER_OVERRIDE.capabilityOptOuts).toEqual([]);
    expect(normalizeMemberOverride({ capabilityOptOuts: ['a x y', 'a x y', 5, 'b x y'] }).capabilityOptOuts)
      .toEqual(['a x y', 'b x y']);
    expect(normalizeMemberOverride({ capabilityOptOuts: 'nope' }).capabilityOptOuts).toEqual([]);
  });
  it('merge replaces the opt-out list wholesale (UI sends the full set)', () => {
    const merged = mergeMemberOverride({ capabilityOptOuts: ['a x y'] }, { capabilityOptOuts: ['b x y'] });
    expect(merged.capabilityOptOuts).toEqual(['b x y']);
  });
});

describe('circlePolicy · governanceEnactment (the enactment-trigger setting)', () => {
  it("normalizes to 'settle' by default and accepts 'auto'; junk falls back to the default", () => {
    expect(normalizeCirclePolicy().governanceEnactment).toBe('settle');
    expect(normalizeCirclePolicy({ governanceEnactment: 'auto' }).governanceEnactment).toBe('auto');
    expect(normalizeCirclePolicy({ governanceEnactment: 'nonsense' }).governanceEnactment).toBe('settle');
  });

  it('autoEnacts reads the enum as a boolean, default-safe', () => {
    expect(autoEnacts({ governanceEnactment: 'auto' })).toBe(true);
    expect(autoEnacts({ governanceEnactment: 'settle' })).toBe(false);
    expect(autoEnacts({})).toBe(false);          // default is settle
    expect(autoEnacts(null)).toBe(false);
    expect(autoEnacts({ governanceEnactment: 'bogus' })).toBe(false);
  });
});


describe('THE ONE DECISION TABLE (the decision-kind unification)', () => {
  it('every governed decision kind maps to a governance action, and the class resolves through it', () => {
    for (const [kind, action] of Object.entries(DECISION_KINDS)) {
      expect(GOVERNANCE_ACTIONS).toContain(action);
      expect(requiredClassFor({}, kind)).toBe(decisionClassFor({}, action));
    }
    expect(requiredClassFor({}, 'not-a-kind')).toBe(null);
  });

  it('report-ban and fork-resolution ride removeMember; settings-change rides changePolicy', () => {
    const policy = { governance: { removeMember: 'member-vote', changePolicy: 'admin-quorum' } };
    expect(requiredClassFor(policy, 'report-ban')).toBe('member-vote');
    expect(requiredClassFor(policy, 'fork-resolution')).toBe('member-vote');
    expect(requiredClassFor(policy, 'settings-change')).toBe('admin-quorum');
  });

  it('settingsChangeNeedsProposal — the one gate: any-admin direct · single-admin quorum direct · member-vote always proposes', () => {
    expect(settingsChangeNeedsProposal({ admins: ['a', 'b'] })).toBe(false);                                    // lived default: any-admin
    expect(settingsChangeNeedsProposal({ admins: ['a'], governance: { changePolicy: 'admin-quorum' } })).toBe(false);
    expect(settingsChangeNeedsProposal({ admins: ['a', 'b'], governance: { changePolicy: 'admin-quorum' } })).toBe(true);
    expect(settingsChangeNeedsProposal({ admins: ['a'], governance: { changePolicy: 'member-vote' } })).toBe(true);
  });

  it('the LEGACY LIFT: a stored consensusRequired:true becomes changePolicy admin-quorum; an explicit class wins; the boolean never survives', () => {
    const lifted = normalizeCirclePolicy({ consensusRequired: true });
    expect(lifted.governance.changePolicy).toBe('admin-quorum');
    expect('consensusRequired' in lifted).toBe(false);
    const explicit = normalizeCirclePolicy({ consensusRequired: true, governance: { changePolicy: 'member-vote' } });
    expect(explicit.governance.changePolicy).toBe('member-vote');
    const off = normalizeCirclePolicy({ consensusRequired: false });
    expect(off.governance.changePolicy).toBe('any-admin');
  });
});
