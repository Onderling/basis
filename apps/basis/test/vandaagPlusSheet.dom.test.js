/**
 * Vandaag's "+" sheet makes things: a button beside the free line reads it (Enter does too), each own act carries its
 * ☆ inside its own row, "Klaar" is the way out (not one of the acts), and Share my card / Scan are not here — they live
 * on Mij.
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderVandaagPlus } from '../web/v2/vandaagPlus.js';
import { sectionsOf } from '../src/v2/screenSections.js';

const t = (k) => k;

describe('the "+" sheet', () => {
  it('the free line has a button that reads it', () => {
    const read = [];
    const el = renderVandaagPlus(document.body.appendChild(document.createElement('div')), { t, onRead: (v) => read.push(v) });
    el.querySelector('.circle-vandaag-plus__line').value = 'notitie: melk';
    const go = el.querySelector('.circle-vandaag-plus__read');
    expect(go?.textContent).toBe('circle.vandaag.plus_line_read');
    go.click();
    expect(read).toEqual(['notitie: melk']);
  });

  it('each act and its ☆ share one row; the way out is not styled as an act', () => {
    const el = renderVandaagPlus(document.createElement('div'), { t, onTogglePin: () => {} });
    const rows = [...el.querySelectorAll('.circle-vandaag-plus__act-row')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.querySelector('.circle-vandaag-plus__act')).toBeTruthy();
      expect(r.querySelector('.circle-vandaag-plus__pin')?.getAttribute('aria-label')).toBe('circle.vandaag.pin');
    }
    expect(el.querySelector('.circle-vandaag-plus__close').className).toMatch(/cc-btn--ghost/);
  });

  it('holds no Share my card / Scan: the "+" makes things, the Me actions live on Mij', () => {
    expect(sectionsOf('plusSheet').map((s) => s.id)).not.toContain('plus-me');
    const el = renderVandaagPlus(document.createElement('div'), { t, meActions: [{ id: 'share-contact', labelKey: 'x' }], onMeAction: () => {} });
    expect(el.querySelector('[data-me]')).toBe(null);
  });
});
