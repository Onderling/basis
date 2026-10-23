// @vitest-environment happy-dom
/**
 * Where the app opens: Vandaag by default, the circles list, or the tab last used — a device setting in the param
 * register, painted on My data, written through set-param like every setting.
 */
import { describe, it, expect, vi } from 'vitest';
import { startTabFor, START_SCREEN, START_SCREEN_CHOICES } from '../../src/v2/startScreen.js';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';
import { settingsGroupFor } from '../../src/v2/settingsHome.js';
import { basisManifest as settingsManifest } from '../../manifest.js';
const WEERGAVE = settingsGroupFor(settingsManifest, 'appearance').sections.map((x) => x.id);

const t = (k) => k;

describe('the start screen', () => {
  it('opens on Vandaag unless the person chose otherwise', () => {
    expect(START_SCREEN).toBe('vandaag');
    expect(startTabFor(undefined, null)).toBe('screens');
    expect(startTabFor('vandaag', 'mij')).toBe('screens');
    expect(startTabFor('circles', 'mij')).toBe('circles');
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
