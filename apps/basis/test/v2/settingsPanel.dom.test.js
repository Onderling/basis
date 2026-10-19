// @vitest-environment happy-dom
/** The web paint of the register-projected settings: each control reports its row and its input to the host. */
import { describe, it, expect, vi } from 'vitest';
import { settingsProjection } from '../../src/v2/settingsProjection.js';
import { renderSettingsGroups } from '../../web/v2/settingsPanel.js';

describe('the web settings paint', () => {
  it('a switch, a choice and a duration each report their input; the raw key stays visible small', async () => {
    const projection = settingsProjection([
      { key: 'wake.nudges', scope: 'device', default: false, value: false },
      { key: 'display.theme', scope: 'device', default: 'system', value: 'system', choices: ['system', 'dark'] },
      { key: 'nearby.ask.defaultTtlMs', scope: 'agent', default: 3_600_000, value: 3_600_000 },
    ]);
    const onSet = vi.fn(async () => ({ ok: true }));
    const el = document.createElement('div');
    renderSettingsGroups(el, { projection, t: (k) => k, onSet });
    expect([...el.querySelectorAll('section')].map((s) => s.dataset.scope)).toEqual(['device', 'agent']);
    const sw = el.querySelector('input[data-param="wake.nudges"]');
    sw.checked = true; sw.dispatchEvent(new Event('change'));
    expect(onSet).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'wake.nudges' }), true);
    const sel = el.querySelector('select[data-param="display.theme"]');
    sel.selectedIndex = 1; sel.dispatchEvent(new Event('change'));
    expect(onSet).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'display.theme' }), 'dark');
    const dur = el.querySelector('input[data-param="nearby.ask.defaultTtlMs"]');
    expect(dur.value).toBe('1');
    dur.value = '2'; dur.dispatchEvent(new Event('change'));
    expect(onSet).toHaveBeenLastCalledWith(expect.objectContaining({ control: { kind: 'duration', unit: 'hours' } }), '2');
    expect(el.querySelector('.cc-settings__key').textContent).toBe('wake.nudges');
    expect(el.querySelector('label').textContent).toBe('circle.params.key.wake_nudges');
  });
});
