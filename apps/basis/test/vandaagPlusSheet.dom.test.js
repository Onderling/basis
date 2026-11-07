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

// THE LINE DOES NOT TAKE THE FORM'S TYPING. A walk typed an appointment into the form while the keyboard moved the sheet,
// and the text landed in "Say what you want" above it as well. With a form open the line shows what was said, read-only,
// so focus and typing stay in the form; both shells.
describe('the free line while a form is open', () => {
  it('is read-only on web once an act is picked, and editable before', () => {
    const before = renderVandaagPlus(document.createElement('div'), { t, onRead: () => {} });
    expect(before.querySelector('.circle-vandaag-plus__line').readOnly).toBe(false);
    const open = renderVandaagPlus(document.createElement('div'), { t, onRead: () => {}, actId: 'calendar.calendar-event', line: 'koffie vrijdag 14:00' });
    const li = open.querySelector('.circle-vandaag-plus__line');
    expect(open.querySelector('.circle-vandaag-plus__form')).toBeTruthy();
    expect(li.readOnly).toBe(true);
    expect(li.tabIndex).toBe(-1);
    expect(li.value).toBe('koffie vrijdag 14:00');
  });
  it('is not editable on mobile once an act is picked', async () => {
    const fs = await import('node:fs'); const path = await import('node:path');
    const src = fs.readFileSync(path.join(process.cwd(), '../basis-mobile/src/screens/v2/VandaagPlusModal.js'), 'utf8');
    const line = src.slice(src.indexOf('testID="vandaag-plus-line"') - 400, src.indexOf('testID="vandaag-plus-line"'));
    expect(line).toMatch(/editable=\{!act\}/);
  });
});
