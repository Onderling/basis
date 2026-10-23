// @vitest-environment happy-dom
/**
 * Vandaag and its customise sheet, as the interface sweep left them (mobile twin: apps/basis-mobile/test/vandaagParity.test.js):
 * the time ranges speak one label set, every control has a heading, the sheet's Done sits at the top, "Remove" is not
 * alarm-red, the onboarding card has one button ("Lees meer") and a text link ("Begrepen") and no "meer" under it, an
 * empty block is a line of text, and the header avatar is named "Profiel".
 */
import { describe, it, expect } from 'vitest';
import { HORIZON_PRESETS, WITHIN_PRESETS, CONTROL_TITLES, customiseModel } from '../../src/v2/vandaag.js';
import { blockOpensWhole } from '../../src/v2/blockTitle.js';
import { renderVandaagCustomise } from '../../web/v2/vandaagCustomise.js';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';
import { renderHeaderAvatar } from '../../web/v2/headerAvatar.js';
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const t = (k) => k;
const book = {
  activeId: 'p',
  screens: [{ id: 'p', name: 'Vandaag', blocks: [
    { id: 'c', type: 'calendar', config: { horizonDays: 7, limit: 5 } },
    { id: 't', type: 'tasks', config: { scope: 'all', limit: 5, withinDays: 0 } },
  ] }],
};

describe('the time ranges: one label set', () => {
  it('the calendar\'s horizon and the tasks\' "within" use the same words; "within" adds Altijd', () => {
    const words = (ps) => ps.map((p) => nl.vandaag[p.labelKey.replace('circle.vandaag.', '')]?.text);
    expect(words(HORIZON_PRESETS)).toEqual(['Vandaag', '3 dagen', 'Deze week', 'Deze maand']);
    expect(words(WITHIN_PRESETS)).toEqual(['Altijd', 'Vandaag', '3 dagen', 'Deze week', 'Deze maand']);
  });
});

describe('the customise sheet', () => {
  it('every control carries a heading, and every heading is a real key in both languages', () => {
    const m = customiseModel(book);
    const controls = m.blocks.flatMap((b) => b.controls);
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) expect(c.titleKey, c.kind).toBe(CONTROL_TITLES[c.kind]);
    for (const key of Object.values(CONTROL_TITLES)) {
      const leaf = key.replace('circle.vandaag.', '');
      expect(en.vandaag[leaf]?.text, key).toBeTruthy();
      expect(nl.vandaag[leaf]?.text, key).toBeTruthy();
    }
  });
  it('Done sits in the head, before the blocks; headings are painted; Remove is not danger', () => {
    const el = renderVandaagCustomise(document.createElement('div'), { model: customiseModel(book), t, onAct: () => {}, onClose: () => {} });
    const head = el.querySelector('.vandaag-customise__head');
    expect(head?.querySelector('[data-act="done"]')).toBeTruthy();
    expect(el.querySelectorAll('[data-act="done"]').length).toBe(1);
    expect([...el.querySelectorAll('.vandaag-customise__control-title')].map((h) => h.textContent))
      .toEqual(expect.arrayContaining(['circle.vandaag.control_horizon', 'circle.vandaag.control_scope', 'circle.vandaag.control_within']));
    for (const b of el.querySelectorAll('[data-act="remove"]')) expect(b.className).not.toMatch(/danger/);
  });
  it('the Vandaag trigger is called "Aanpassen"', () => {
    expect(nl.vandaag.customise.text).toBe('Aanpassen');
  });
});

describe('Vandaag', () => {
  const onboarding = { blockId: 'o', type: 'onboarding', status: 'ok', content: { cards: [{ id: 'intro' }] } };
  it('the onboarding card: "Lees meer" the one button, "Begrepen" a text link, no "meer" under the strip', () => {
    const el = renderCircleScreen(document.createElement('div'), { blocks: [onboarding], t, onAction: () => {}, onMore: () => {} });
    const btns = [...el.querySelectorAll('.circle-screen__onb-card button')];
    expect(btns.filter((b) => b.className.includes('cc-btn--primary')).map((b) => b.textContent)).toEqual(['circle.vandaag.onboarding_intro_more']);
    expect(btns.find((b) => b.textContent === 'circle.vandaag.onboarding_intro_dismiss')?.className).toMatch(/cc-btn--ghost/);
    expect(el.querySelector('.circle-screen__more')).toBeNull();
    expect(blockOpensWhole(onboarding)).toBe(false);
    expect(blockOpensWhole({ type: 'tasks', status: 'ok' })).toBe(true);
  });
  it('the header avatar is named "Profiel", not "Aanpassen"', () => {
    const host = document.createElement('div');
    renderHeaderAvatar(host, { avatar: { initials: '?' }, t: (k) => nl.profile[k.replace('circle.profile.', '')]?.text ?? k, onOpen: () => {} });
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Profiel');
  });
});
