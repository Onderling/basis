// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderUserLlmSettings, mountUserLlmSettings } from '../../web/v2/userLlmSettings.js';
import { createUserLlmDefaultStore } from '../../src/v2/userLlmDefault.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderUserLlmSettings', () => {
  it('renders 3 mode radios with the current one checked', () => {
    const el = mount();
    renderUserLlmSettings(el, { current: { mode: 'local' }, t });
    const radios = el.querySelectorAll('input[type=radio][name=user-llm]');
    expect([...radios].map((r) => r.value)).toEqual(['off', 'local', 'cloud']);
    expect(el.querySelector('input[value=local]').checked).toBe(true);
    expect(el.querySelector('input[value=off]').checked).toBe(false);
  });

  it('defaults to off for a missing/invalid mode', () => {
    const el = mount();
    renderUserLlmSettings(el, { current: { mode: 'gpt' }, t });
    expect(el.querySelector('input[value=off]').checked).toBe(true);
  });

  it('fires onChange with the selected mode', () => {
    const el = mount();
    const onChange = vi.fn();
    renderUserLlmSettings(el, { current: { mode: 'off' }, onChange, t });
    const cloud = el.querySelector('input[value=cloud]');
    cloud.checked = true;
    cloud.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('cloud');
  });
});

describe('mountUserLlmSettings — wired to a store', () => {
  it('loads the current value + persists a change', async () => {
    let saved = { mode: 'local' };
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    const el = mount();
    await mountUserLlmSettings(el, { store, t });
    expect(el.querySelector('input[value=local]').checked).toBe(true);   // loaded

    const cloud = el.querySelector('input[value=cloud]');
    cloud.checked = true;
    cloud.dispatchEvent(new Event('change'));
    await Promise.resolve();                                              // let the async onChange settle
    expect(saved).toEqual({ mode: 'cloud' });                            // persisted
    expect(el.querySelector('input[value=cloud]').checked).toBe(true);   // re-rendered with the new value
  });
});
