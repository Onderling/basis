// @vitest-environment happy-dom
// The "+" sheet's circle card on web: the line read to an act more than one circle holds, so the sheet asks which. A
// pick runs it in that circle (the host's `onCircleRun`), Cancel drops it; nothing runs before a pick. An act that ran
// says what it did (`done`).
import { describe, it, expect, vi } from 'vitest';
import { renderVandaagPlus } from '../../web/v2/vandaagPlus.js';
import { plusCircleOp } from '../../src/v2/vandaagPlus.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('the "+" circle card', () => {
  it('asks which circle, runs only on a pick, Cancel drops it', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const onCircleRun = vi.fn(); const onCircleCancel = vi.fn();
    const card = { line: 'zet melk op de boodschappen', to: [{ circleId: 'c1', name: 'Thuis' }, { circleId: 'c2', name: 'Ouders' }] };
    renderVandaagPlus(el, { t, circleCard: card, onCircleRun, onCircleCancel, onClose: () => {} });
    const box = el.querySelector('.circle-vandaag-plus__card');
    expect(box.querySelector('p').textContent).toContain('zet melk op de boodschappen');
    const picks = [...box.querySelectorAll('.circle-vandaag-plus__card-in')];
    expect(picks.map((b) => b.dataset.circleId)).toEqual(['c1', 'c2']);
    expect(onCircleRun).not.toHaveBeenCalled();
    picks[1].click();
    expect(onCircleRun).toHaveBeenCalledWith('c2');
    box.querySelector('.circle-vandaag-plus__card-no').click();
    expect(onCircleCancel).toHaveBeenCalled();
  });

  it('an act that ran says what it did', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    renderVandaagPlus(el, { t, done: 'Op de lijst Boodschappen: melk.', onClose: () => {} });
    expect(el.querySelector('.circle-vandaag-plus__done').textContent).toBe('Op de lijst Boodschappen: melk.');
  });

  it('the op it runs is the command, in the circle picked', () => {
    const command = { appOrigin: 'lists', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } };
    expect(plusCircleOp(command, 'c2')).toEqual({ app: 'lists', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk', circleId: 'c2' } });
    expect(plusCircleOp(command, '')).toBeNull();
    expect(plusCircleOp(null, 'c2')).toBeNull();
  });
});
