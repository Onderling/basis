// @vitest-environment happy-dom
/**
 * The delivery chip repaints in place — the fix for a message the system had given up on keeping its
 * optimistic chip forever.
 *
 * The delivery ladder computes honest states (`failed` when the relay or the local hold queue gives
 * up, `stored` when the recipient's app confirms). Web painted almost none of them: the state map's
 * subscriber rebuilt the whole circle view, which rebuilds the COMPOSER, so it had to be narrowed to
 * one state. Frits watched the relay drop four messages while his screen said nothing was wrong.
 *
 * These pin the three transitions the repaint has to get right, and the property that makes it safe
 * to run on every state change: it must touch NOTHING but the chip.
 */
import { describe, it, expect } from 'vitest';
import { paintDeliveryChip } from '../../web/v2/circleView.js';

const t = (key) => key;

/** One bubble, shaped as the renderer shapes it: the row id on the bubble, the chip in the meta line. */
function mountBubble(rowId, state = null) {
  const root = document.createElement('div');
  const bubble = document.createElement('div');
  bubble.className = 'circle-view__bubble';
  bubble.dataset.rowId = rowId;
  const meta = document.createElement('div');
  meta.className = 'circle-view__bubble-meta';
  if (state) {
    const chip = document.createElement('span');
    chip.className = `circle-view__bubble-delivery circle-view__bubble-delivery--${state}`;
    chip.dataset.deliveryState = state;
    meta.appendChild(chip);
  }
  bubble.appendChild(meta);
  root.appendChild(bubble);
  document.body.appendChild(root);
  return { root, bubble, meta };
}

const chipState = (root) => root.querySelector('.circle-view__bubble-delivery')?.dataset.deliveryState ?? null;

describe('paintDeliveryChip', () => {
  it('advances a chip that is already there — the give-up case', () => {
    const { root } = mountBubble('m1', 'maybe-received');
    expect(paintDeliveryChip(root, 'm1', 'failed', { tr: t })).toBe(true);
    expect(chipState(root), 'a message the relay gave up on must SAY so').toBe('failed');
  });

  it('a retryable state renders a button a person can press', () => {
    const { root } = mountBubble('m1', 'maybe-received');
    paintDeliveryChip(root, 'm1', 'failed', { tr: t });
    const chip = root.querySelector('.circle-view__bubble-delivery');
    expect(chip.tagName).toBe('BUTTON');
  });

  it('calls the retry handler with the message it belongs to', () => {
    const { root } = mountBubble('m1', 'maybe-received');
    let retried = null;
    paintDeliveryChip(root, 'm1', 'failed', { tr: t, onRetryDelivery: (id) => { retried = id; } });
    root.querySelector('.circle-view__bubble-delivery').click();
    expect(retried).toBe('m1');
  });

  it('advances to stored — the receipt the recipient chose to send', () => {
    const { root } = mountBubble('m1', 'maybe-received');
    paintDeliveryChip(root, 'm1', 'stored', { tr: t });
    expect(chipState(root)).toBe('stored');
    expect(root.querySelector('.circle-view__bubble-delivery').tagName)
      .toBe('SPAN');   // arrived: nothing to retry
  });

  it('places a chip on a bubble that had none', () => {
    const { root } = mountBubble('m1');
    expect(chipState(root)).toBe(null);
    paintDeliveryChip(root, 'm1', 'failed', { tr: t });
    expect(chipState(root)).toBe('failed');
  });

  it('CLEARS the chip when the new state shows nothing — never leaves a stale one', () => {
    const { root } = mountBubble('m1', 'failed');
    paintDeliveryChip(root, 'm1', null, { tr: t });
    expect(chipState(root), 'a state that renders nothing must remove what was there').toBe(null);
  });

  it('is a silent no-op for a row that is not on screen', () => {
    const { root } = mountBubble('m1', 'maybe-received');
    expect(paintDeliveryChip(root, 'not-rendered', 'failed', { tr: t })).toBe(false);
    expect(chipState(root), 'the visible row must be untouched').toBe('maybe-received');
  });

  it('touches NOTHING but the chip — the reason it can run on every change', () => {
    const { root, bubble } = mountBubble('m1', 'maybe-received');
    const composer = document.createElement('input');
    composer.className = 'circle-view__composer';
    root.appendChild(composer);
    composer.value = 'half a sentence';
    const text = document.createElement('p');
    text.textContent = 'the message body';
    bubble.prepend(text);

    paintDeliveryChip(root, 'm1', 'failed', { tr: t });

    expect(composer.value, 'a rebuilt composer loses what was typed — that is why this fix exists')
      .toBe('half a sentence');
    expect(bubble.querySelector('p').textContent).toBe('the message body');
  });

  it('refuses to guess without a translator', () => {
    const { root } = mountBubble('m1', 'maybe-received');
    expect(paintDeliveryChip(root, 'm1', 'failed', {})).toBe(false);
    expect(chipState(root)).toBe('maybe-received');
  });
});
