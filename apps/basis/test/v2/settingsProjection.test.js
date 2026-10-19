/**
 * The settings surface, projected from the parameter register: one projection both shells paint — a label key per
 * param, a typed control per value (switch · choice · duration · number · list · text), grouped by scope.
 */
import { describe, it, expect } from 'vitest';
import { settingsProjection, SETTINGS_SCOPE_ORDER } from '../../src/v2/settingsProjection.js';
import { basisParamRegistry } from '../../src/v2/paramsService.js';
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const has = (bundle, key) => key.replace(/^circle\./, '').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), bundle) != null;

describe('the settings surface from the register', () => {
  it('each value takes the control its kind needs', () => {
    const g = settingsProjection([
      { key: 'wake.nudges', scope: 'device', default: false, value: true },
      { key: 'display.theme', scope: 'device', default: 'system', value: 'dark', choices: ['system', 'light', 'dark'] },
      { key: 'home.startScreen', scope: 'device', default: 'vandaag', value: 'vandaag', choices: [{ value: 'vandaag', labelKey: 'circle.mydata.start_vandaag' }] },
      { key: 'nearby.ask.defaultTtlMs', scope: 'agent', default: 3_600_000, value: 7_200_000 },
      { key: 'history.restore.recencyDays', scope: 'agent', default: 30, value: 30 },
      { key: 'assistant.apps', scope: 'device', default: ['household', 'lists'], value: ['lists'] },
      { key: 'relay.url', scope: 'device', default: '', value: '' },
    ]);
    const row = (k) => g.groups.flatMap((x) => x.rows).find((r) => r.key === k);
    expect(row('wake.nudges')).toMatchObject({ labelKey: 'circle.params.key.wake_nudges', control: { kind: 'switch' }, value: true });
    expect(row('display.theme').control).toEqual({ kind: 'choice', options: [
      { value: 'system', labelKey: 'circle.params.opt.system' }, { value: 'light', labelKey: 'circle.params.opt.light' }, { value: 'dark', labelKey: 'circle.params.opt.dark' }] });
    expect(row('home.startScreen').control.options[0].labelKey).toBe('circle.mydata.start_vandaag');
    expect(row('nearby.ask.defaultTtlMs').control).toEqual({ kind: 'duration', unit: 'hours' });
    expect(row('nearby.ask.defaultTtlMs').shown).toBe(2);
    // a 0 default reads in minutes (not hours); a sub-minute one in seconds
    const d = settingsProjection([{ key: 'a.waitMs', scope: 'device', default: 0 }, { key: 'b.pollMs', scope: 'device', default: 5000 }]).groups[0].rows;
    expect(d.map((r) => r.control.unit)).toEqual(['minutes', 'seconds']);
    expect(row('history.restore.recencyDays').control).toEqual({ kind: 'number' });
    expect(row('assistant.apps').control).toEqual({ kind: 'list' });
    expect(row('relay.url').control).toEqual({ kind: 'text' });
    expect(g.groups.map((x) => x.scope)).toEqual(['device', 'agent']);
    expect(g.groups[0].labelKey).toBe('circle.params.scope.device');
  });

  it('a control\'s input goes back as the value the register holds (ms from hours, a list from text)', () => {
    const { valueFor } = settingsProjection([]);
    expect(valueFor({ control: { kind: 'duration', unit: 'hours' } }, '3')).toBe(10_800_000);
    expect(valueFor({ control: { kind: 'duration', unit: 'minutes' } }, '5')).toBe(300_000);
    expect(valueFor({ control: { kind: 'duration', unit: 'seconds' } }, '5')).toBe(5_000);
    expect(valueFor({ control: { kind: 'number' } }, '12')).toBe(12);
    expect(valueFor({ control: { kind: 'list' } }, 'a, b ,')).toEqual(['a', 'b']);
    expect(valueFor({ control: { kind: 'switch' } }, true)).toBe(true);
    expect(valueFor({ control: { kind: 'number' } }, 'x')).toEqual({ error: 'circle.params.bad_number' });
  });

  it('every settable param of basis has a label, every choice an option label, in both languages (no raw key on screen)', () => {
    const g = settingsProjection(basisParamRegistry().userParams());
    const keys = [...SETTINGS_SCOPE_ORDER.map((s) => `circle.params.scope.${s}`),
      ...g.groups.flatMap((x) => x.rows.flatMap((r) => [r.labelKey, ...(r.control.options ?? []).map((o) => o.labelKey)]))];
    const missing = [...new Set(keys)].filter((k) => !has(en, k) || !has(nl, k));
    expect(missing).toEqual([]);
    // the register carries the choices: an enum param projects as a choice, not free text
    expect(g.groups.flatMap((x) => x.rows).find((r) => r.key === 'transport.mode').control.kind).toBe('choice');
  });
});
