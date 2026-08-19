// @vitest-environment happy-dom
//
// S6.B — tapping a "See also" embed chip opens the screen panel AND scrolls to
// + flashes the referenced row.  This covers the render side: renderCircleScreen
// applies the `--highlight` class to the row whose id matches `highlightRef`,
// tolerating the URN-vs-local-id mismatch (urn:dec:item:T2 ↔ T2).
import { describe, it, expect } from 'vitest';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

function tasksBlock(items) {
  return { blockId: 'b1', type: 'tasks', status: 'ok', config: {}, content: { items } };
}
function agendaBlock(items) {
  return { blockId: 'b2', type: 'calendar', status: 'ok', config: {}, content: { items } };
}

describe('renderCircleScreen — highlightRef scroll-to/flash', () => {
  it('flags the task row whose id matches a raw highlightRef', () => {
    const el = mount();
    renderCircleScreen(el, {
      t,
      blocks: [tasksBlock([{ id: 'T1', text: 'one' }, { id: 'T2', text: 'two' }])],
      highlightRef: 'T2',
    });
    const rows = el.querySelectorAll('.circle-screen__tasks-row');
    expect(rows[0].classList.contains('circle-screen__tasks-row--highlight')).toBe(false);
    expect(rows[1].classList.contains('circle-screen__tasks-row--highlight')).toBe(true);
  });

  it('matches a URN highlightRef against a local row id (urn:dec:item:T2 ↔ T2)', () => {
    const el = mount();
    renderCircleScreen(el, {
      t,
      blocks: [tasksBlock([{ id: 'T1', text: 'one' }, { id: 'T2', text: 'two' }])],
      highlightRef: 'urn:dec:item:T2',
    });
    const rows = el.querySelectorAll('.circle-screen__tasks-row');
    expect(rows[1].classList.contains('circle-screen__tasks-row--highlight')).toBe(true);
    expect(rows[0].classList.contains('circle-screen__tasks-row--highlight')).toBe(false);
  });

  it('highlights agenda rows too', () => {
    const el = mount();
    renderCircleScreen(el, {
      t,
      blocks: [agendaBlock([{ id: 'E1', label: 'a' }, { id: 'E2', label: 'b' }])],
      highlightRef: 'urn:dec:item:E2',
    });
    const rows = el.querySelectorAll('.circle-screen__agenda-row');
    expect(rows[1].classList.contains('circle-screen__agenda-row--highlight')).toBe(true);
  });

  it('no highlightRef → no row is flagged', () => {
    const el = mount();
    renderCircleScreen(el, {
      t,
      blocks: [tasksBlock([{ id: 'T1', text: 'one' }, { id: 'T2', text: 'two' }])],
    });
    expect(el.querySelectorAll('.circle-screen__tasks-row--highlight')).toHaveLength(0);
  });
});
