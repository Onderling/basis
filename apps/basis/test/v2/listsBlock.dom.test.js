// @vitest-environment happy-dom
// The circle screen paints the lists block: each list's name, its open entries, and one act per entry (tick it off,
// through the lists' own op); a list with nothing on it says so.
import { describe, it, expect, vi } from 'vitest';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';

const t = (k) => k;
const tick = (id) => ({ kind: 'op', app: 'lists', opId: 'markListItemDone', args: { circleId: 'k1', item: id, list: 'l1' }, labelKey: 'circle.vandaag.act_done' });
const block = {
  blockId: 'b1', type: 'lists', status: 'ok',
  content: { lists: [
    { id: 'l1', title: 'Boodschappen', entries: [{ id: 'e1', label: 'melk', done: false, primary: tick('e1') }] },
    { id: 'l2', title: 'Klusjes', entries: [] },
  ] },
};

describe('the lists block on the circle screen', () => {
  it('shows each list and its entries, and an entry\'s act ticks it off through the lists op', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const onAction = vi.fn();
    renderCircleScreen(el, { blocks: [block], t, onAction });
    expect([...el.querySelectorAll('.circle-screen__list-title')].map((h) => h.textContent)).toEqual(['Boodschappen', 'Klusjes']);
    expect(el.querySelector('.circle-screen__list-entry .circle-screen__list-text').textContent).toBe('melk');
    expect(el.querySelector('.circle-screen__list-empty').textContent).toBe('circle.screen.list_empty');
    el.querySelector('.circle-screen__list-entry .circle-screen__row-act').click();
    expect(onAction).toHaveBeenCalledWith({ kind: 'row-op', op: { app: 'lists', opId: 'markListItemDone', args: { circleId: 'k1', item: 'e1', list: 'l1' } } });
  });
});
