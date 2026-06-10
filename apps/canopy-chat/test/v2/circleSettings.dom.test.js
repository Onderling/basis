// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleSettings } from '../../web/v2/circleSettings.js';
import { DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleSettings', () => {
  it('renders 8 feature toggles + 5 enum axes reflecting the policy (5.9a: + view)', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t });
    expect(el.querySelectorAll('.circle-settings__feature input[type=checkbox]')).toHaveLength(8);
    expect(el.querySelectorAll('.circle-settings__axis')).toHaveLength(5);
    expect(el.querySelector('input[data-feature=chat]').checked).toBe(true);
    expect(el.querySelector('.circle-settings__axis[data-axis=pod] input[value=none]').checked).toBe(true);
    // 5.9a — view axis is editable; default flipped to 'screen' so
    // tap-on-kring opens the per-circle detail instead of auto-
    // routing to the classic chat shell (see DEFAULT_CIRCLE_POLICY).
    expect(el.querySelector('.circle-settings__axis[data-axis=view] input[value=screen]').checked).toBe(true);
  });

  it('fires onChange with a feature patch on toggle', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const tasks = el.querySelector('input[data-feature=tasks]');
    tasks.checked = true;
    tasks.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ features: { tasks: true } });
  });

  it('fires onChange with an axis patch on radio select', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const local = el.querySelector('.circle-settings__axis[data-axis=llmTool] input[value=local]');
    local.checked = true;
    local.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ llmTool: 'local' });
  });

  it('fires onSave and onBack', () => {
    const el = mount();
    const onSave = vi.fn();
    const onBack = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onSave, onBack });
    el.querySelector('.circle-settings__save').click();
    el.querySelector('.circle-settings__back').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the consensus toggle and honours custom saveLabel + note', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, saveLabel: 'Send proposal', note: 'pending note' });
    expect(el.querySelector('input[data-field=consensusRequired]')).not.toBeNull();
    expect(el.querySelector('.circle-settings__save').textContent).toBe('Send proposal');
    expect(el.querySelector('.circle-settings__note').textContent).toBe('pending note');
  });

  it('consensus toggle fires onChange({ consensusRequired })', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const c = el.querySelector('input[data-field=consensusRequired]');
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ consensusRequired: true });
  });

  it('omits ⓘ consequence toggles when no consequence copy is translated', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t }); // t echoes the key → miss
    expect(el.querySelectorAll('.circle-settings__info')).toHaveLength(0);
    expect(el.querySelectorAll('.circle-settings__consequence')).toHaveLength(0);
  });

  it('renders a ⓘ + collapsed panel per enum option when consequence copy exists', () => {
    const el = mount();
    const tc = (k) => (k.startsWith('circle.settings.consequence.') ? `why ${k.split('.').pop()}` : k);
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tc });
    // 5.9a — 3 view + 4 llmTool (off/local/cloud/user) + 3 agents + 2 revealPolicy + 4 pod = 16 enum options
    expect(el.querySelectorAll('.circle-settings__info')).toHaveLength(16);
    const panels = el.querySelectorAll('.circle-settings__consequence');
    expect(panels).toHaveLength(16);
    for (const p of panels) expect(p.hidden).toBe(true);
  });

  it('clicking ⓘ reveals its option panel and flips aria-expanded', () => {
    const el = mount();
    const tc = (k) => (k.startsWith('circle.settings.consequence.') ? `why ${k.split('.').pop()}` : k);
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tc });
    const info = el.querySelector('.circle-settings__info[data-opt=cloud]');
    const panel = el.querySelector('.circle-settings__consequence[data-opt=cloud]');
    expect(panel.hidden).toBe(true);
    expect(info.getAttribute('aria-expanded')).toBe('false');
    info.click();
    expect(panel.hidden).toBe(false);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(panel.textContent).toBe('why cloud');
    info.click();
    expect(panel.hidden).toBe(true);
    expect(info.getAttribute('aria-expanded')).toBe('false');
  });
});
