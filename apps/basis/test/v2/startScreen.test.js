// @vitest-environment happy-dom
/**
 * Where the app opens: Vandaag by default, the circles list, or the tab last used — a device setting in the param
 * register, painted on My data, written through set-param like every setting.
 */
import { describe, it, expect, vi } from 'vitest';
import { startTabFor, startScreenStillApplies, firstFrameTab, START_SCREEN, START_SCREEN_CHOICES } from '../../src/v2/startScreen.js';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';
import { settingsGroupFor } from '../../src/v2/settingsHome.js';
import { basisManifest as settingsManifest } from '../../manifest.js';
const WEERGAVE = settingsGroupFor(settingsManifest, 'appearance').sections.map((x) => x.id);

const t = (k) => k;

describe('the start screen', () => {
  it('opens on Vandaag unless the person chose otherwise', () => {
    expect(START_SCREEN).toBe('vandaag');
    expect(startTabFor(undefined, null)).toBe('screens');
    expect(startTabFor('vandaag', 'contacten')).toBe('screens');
    expect(startTabFor('circles', 'contacten')).toBe('circles');
    expect(startTabFor('last', 'mij'), 'Mij is no tab any more: the home').toBe('screens');
    expect(startTabFor('last', 'contacten')).toBe('contacten');
    expect(startTabFor('last', null), 'no last tab yet: the home').toBe('screens');
    expect(startTabFor('last', 'nearby'), 'a tab the alpha does not paint: the home').toBe('screens');
  });

  it('the Weergave settings screen shows the choice and writes it', () => {
    const onSetStartScreen = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), {
      t, only: WEERGAVE, podStatus: { signedIn: true }, startScreen: { value: 'circles', choices: START_SCREEN_CHOICES }, onSetStartScreen,
    });
    const sel = el.querySelector('[data-role="start-screen"]');
    expect(sel.value).toBe('circles');
    sel.value = 'last'; sel.dispatchEvent(new Event('change'));
    expect(onSetStartScreen).toHaveBeenCalledWith('last');
  });
});

// The start screen applies once the agent is there, unless the person already moved during the cold start: a tap on
// a tab (even Circles, the one already showing), an opened circle, or "Make a circle" (the emulator walk, 2026-11-13).
describe('the start screen after a cold start', () => {
  it('applies when the person has not moved', () => {
    expect(startScreenStillApplies({ tapped: false, view: 'list', selected: null, creating: false })).toBe(true);
  });
  it('does not when the person tapped a tab, even the one already showing', () => {
    expect(startScreenStillApplies({ tapped: true, view: 'list', selected: null, creating: false })).toBe(false);
  });
  it('does not when a circle is open, the wizard is open, or another view shows', () => {
    expect(startScreenStillApplies({ tapped: false, view: 'list', selected: { id: 'c' }, creating: false })).toBe(false);
    expect(startScreenStillApplies({ tapped: false, view: 'list', selected: null, creating: true })).toBe(false);
    expect(startScreenStillApplies({ tapped: false, view: 'contacten', selected: null, creating: false })).toBe(false);
  });
});

describe('the first frame, before the agent is there (ledger L1051)', () => {
  it('paints the default start, Vandaag, so a person on the default never sees the app jump', () => {
    expect(firstFrameTab()).toBe('screens');
    expect(firstFrameTab()).toBe(startTabFor(undefined, null));
  });
  it('the start may still move it only while the first frame stands: the same view, nothing tapped or opened', () => {
    expect(startScreenStillApplies({ view: 'screens', first: 'screens' })).toBe(true);
    expect(startScreenStillApplies({ view: 'list', first: 'screens' })).toBe(false);
    expect(startScreenStillApplies({ view: 'screens', first: 'screens', tapped: true })).toBe(false);
  });
});
