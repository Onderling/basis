// @vitest-environment happy-dom
/**
 * OPBERGEN on the web launcher (Frits 2026-09-24): a circle put away — or not held on this device — folds out of the
 * list under "Opgeborgen (n)", each tile saying which; the tile menu offers Opbergen / Terugzetten.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleLauncher } from '../../web/v2/circleLauncher.js';

const circles = [{ id: 'a', name: 'Alfa' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }];

describe('the launcher folds what is out of sight', () => {
  it('put away and not-on-this-device leave the list and sit in the fold, each labelled', () => {
    const el = document.createElement('div');
    renderCircleLauncher(el, { circles, t: (k) => k, sights: { b: { putAway: true, at: 1 } }, kringOn: (id) => id !== 'c' });
    const inList = [...el.querySelectorAll('.circle-launcher__list:not(.circle-launcher__list--folded) .circle-tile')].map((t) => t.dataset.circleId);
    expect(inList).toEqual(['a']);
    const folded = [...el.querySelectorAll('.circle-launcher__list--folded .circle-tile')].map((t) => [t.dataset.circleId, t.dataset.sight]);
    expect(folded).toEqual([['b', 'put-away'], ['c', 'not-on-this-device']]);
    expect(el.querySelector('.circle-launcher__fold-title').textContent).toBe('circle.launcher.fold');
  });

  it('the tile menu puts away — and takes out again', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const onPutAway = vi.fn();
    renderCircleLauncher(el, { circles, t: (k) => k, sights: { b: { putAway: true, at: 1 } }, onPutAway });
    el.querySelector('[data-circle-id="a"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const put = document.querySelector('.circle-launcher__tile-menu [data-action="put-away"]');
    expect(put.textContent).toBe('circle.tile.menu.put_away');
    put.click();
    expect(onPutAway).toHaveBeenCalledWith('a', true);
    el.querySelector('[data-circle-id="b"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const out = document.querySelector('.circle-launcher__tile-menu [data-action="put-away"]');
    expect(out.textContent).toBe('circle.tile.menu.take_out');
    out.click();
    expect(onPutAway).toHaveBeenLastCalledWith('b', false);
  });
});
