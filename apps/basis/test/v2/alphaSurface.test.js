// The alpha surface switch: what the alpha paints is one list both shells read; hidden surfaces keep
// existing in the manifest (nothing deleted) but are not projected to either tab bar.
import { describe, it, expect } from 'vitest';
import { ALPHA_TABS, HIDDEN_TABS, alphaTabs, isAlphaTab, alphaViewModes, alphaViewMode, ALPHA_FALLBACK_TAB, HIDDEN_CIRCLE_ACTIONS, alphaActions, isAdvancedSetting, ADVANCED_SETTINGS } from '../../src/v2/alphaSurface.js';
import { circleActions, circleActionsMobile, circleActionRoster, gatedActions } from '../../src/v2/actionProjection.js';
import { DEFAULT_CIRCLE_POLICY, SETTINGS_ENUM_AXES } from '../../src/v2/circlePolicy.js';
import { circleTabs, circleTabsMobile, allManifestTabs } from '../../src/v2/tabProjection.js';
import { basisManifest } from '../../src/index.js';

describe('alphaSurface', () => {
  it('the manifest still declares every tab — hidden ones included (hide, never delete)', () => {
    const all = allManifestTabs(basisManifest).map((t) => t.id);
    for (const id of [...ALPHA_TABS, ...HIDDEN_TABS]) expect(all).toContain(id);
  });

  it('both shells project the same alpha tabs, in manifest order, without the hidden ones', () => {
    const web = circleTabs(basisManifest).map((t) => t.id);
    const mobile = circleTabsMobile(basisManifest).map((t) => t.id);
    expect(web).toEqual(['circles', 'contacten', 'mij']);
    expect(mobile).toEqual(web);
    for (const id of HIDDEN_TABS) { expect(web).not.toContain(id); expect(isAlphaTab(id)).toBe(false); }
  });

  it('alphaTabs keeps order and drops unknowns; a hidden tab lands on the circles list', () => {
    expect(alphaTabs([{ id: 'screens' }, { id: 'mij' }, { id: 'circles' }]).map((t) => t.id)).toEqual(['mij', 'circles']);
    expect(alphaTabs(null)).toEqual([]);
    expect(ALPHA_FALLBACK_TAB).toBe('circles');
  });

  it('one view mode ⇒ no pill; a saved "screen" opens as chat', () => {
    expect(alphaViewModes()).toEqual(['chat']);
    expect(alphaViewMode('screen')).toBe('chat');
    expect(alphaViewMode('chat')).toBe('chat');
    expect(alphaViewMode(undefined)).toBe('chat');
  });

  it('the ⋯ menu is back · invite · settings on both shells; the manifest still declares the rest', () => {
    const web = circleActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id);
    const mobile = circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY }).map((a) => a.id);
    expect(web).toEqual(['back', 'invite', 'settings']);
    expect(mobile).toEqual(web);
    const declared = circleActionRoster(basisManifest).map((a) => a.id);
    for (const id of HIDDEN_CIRCLE_ACTIONS) expect(declared).toContain(id);
    // the gates still work beneath the trim: what a shell would paint once the alpha widens
    expect(gatedActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id)).toContain('viewAs');
    expect(alphaActions([{ id: 'admin' }, { id: 'invite' }]).map((a) => a.id)).toEqual(['invite']);
  });

  it('five settings stay in view; every other policy axis is behind the fold', () => {
    for (const id of ['features', 'axis:pod', 'control:transport-mode', 'control:relay-endpoint', 'control:private-dm']) {
      expect(isAdvancedSetting(id)).toBe(false);
    }
    for (const axis of SETTINGS_ENUM_AXES) if (axis !== 'pod') expect(ADVANCED_SETTINGS).toContain(`axis:${axis}`);
    expect(isAdvancedSetting('control:wake-nudges')).toBe(true);
  });
});
