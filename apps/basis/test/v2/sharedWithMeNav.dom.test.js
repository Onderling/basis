// @vitest-environment happy-dom
/**
 * SILENT out-of-circle delivery — the way IN to the "shared with me" view.
 *
 * The view (renderSharedWithMe) + selector (buildSharedWithMe) already existed; this proves the way to them. Since the
 * settings regroup (2026-10-24) it is a chip on Mij, in "wat wacht op jou": what was shared with you is waiting for
 * you, not a setting — it was a door behind My data before. The chip comes from the shared `awaitingItems`, so web ≡
 * mobile: both paint the same item and open the same view through the SAME `buildSharedWithMe`.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleProfile } from '../../web/v2/circleProfile.js';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';
import { renderSharedWithMe } from '../../web/v2/sharedWithMe.js';
import { buildSharedWithMe } from '../../src/v2/sharedWithMe.js';
import { awaitingItems } from '../../src/v2/awaiting.js';

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }
const tagT = (k) => `T:${k}`;
const awaitingBlock = (items) => ({ blockId: 'aw', type: 'awaiting', status: items.length ? 'ok' : 'empty', content: { items } });

describe('shared-with-me: a chip on Mij (no longer a door behind My data)', () => {
  it('the chip shows when something was shared, labelled via t(); none when nothing was', () => {
    const withChip = mount();
    renderCircleProfile(withChip, { t: tagT, blocks: [awaitingBlock(awaitingItems({ sharedWithMe: 2 }))], onBlockAction: () => {} });
    const chip = withChip.querySelector('.circle-screen__awaiting[data-kind="shared"]');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('T:circle.mij.awaiting_shared');
    const without = mount();
    renderCircleProfile(without, { t: tagT, blocks: [awaitingBlock(awaitingItems({ sharedWithMe: 0 }))], onBlockAction: () => {} });
    expect(without.querySelector('.circle-screen__awaiting[data-kind="shared"]')).toBeNull();
  });

  it('the chip opens the inbox (its action), and My data has no door to it any more', () => {
    const el = mount();
    const onBlockAction = vi.fn();
    renderCircleProfile(el, { t: tagT, blocks: [awaitingBlock(awaitingItems({ sharedWithMe: 1 }))], onBlockAction });
    el.querySelector('.circle-screen__awaiting[data-kind="shared"]').click();
    expect(onBlockAction).toHaveBeenCalledWith({ kind: 'open-shared-with-me' });
    const data = mount();
    renderCircleMyData(data, { t: tagT, doors: { sharedWithMe: () => {} } });
    expect(data.querySelector('.cc-profile__shared-with-me')).toBeNull();
  });

  it('OPENS the shared-with-me view fed the store entries', () => {
    const received = [
      { id: 'a', sealed: { id: 'a', text: 'x' }, itemMeta: { sourceType: 'note' }, from: 'alice', receivedAt: 100 },
      { id: 'b', sealed: { id: 'b', text: 'y' }, itemMeta: { sourceType: 'task' }, from: 'bob',   receivedAt: 300 },
    ];
    const root = mount();
    // the host wiring of the chip's action: project the store list through the SHARED selector into the same root
    renderSharedWithMe(root, { entries: buildSharedWithMe(received), t: tagT });
    expect(root.classList.contains('shared-with-me')).toBe(true);
    expect(root.querySelector('.shared-with-me__title').textContent).toBe('T:circle.sharedWithMe.title');
    const rows = [...root.querySelectorAll('.shared-with-me__row')];
    expect(rows.map((r) => r.dataset.copyId)).toEqual(['b', 'a']);   // newest-first
    expect(root.querySelector('.shared-with-me__back')).not.toBeNull();
  });

  it('shows the empty state when nothing has been shared', () => {
    const root = mount();
    renderSharedWithMe(root, { entries: buildSharedWithMe([]), t: tagT });
    expect(root.querySelector('.shared-with-me__empty').textContent).toBe('T:circle.sharedWithMe.empty');
    expect(root.querySelector('.shared-with-me__row')).toBeNull();
  });
});
