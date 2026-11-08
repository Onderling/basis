/**
 * THE OWN BUBBLE SAYS A MESSAGE WAITS WHEN THERE IS NO CONNECTION POINT — not the composer.
 *
 * Until 2026-11-07 the contact thread's composer carried a line "no connection point, the message waits" from the relay
 * question's predicate (Fable, 2026-11-06; rows 16/9/11). The bubble now carries its own delivery state (L716): a held turn
 * reads `pending` with the `held` reason, in the chip every own bubble has, so the composer says nothing of its own and
 * the thread never says the same thing twice about one message. (The circle composer keeps its line: its bubbles are
 * per-circle fan-outs with a card of their own for the no-point case.)
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderContactThread } from '../../web/v2/contactThread.js';
import { DELIVERY_REASON_LABELS } from '../../src/v2/deliveryState.js';

const t = (k) => k;

describe('the contact thread with no connection point', () => {
  it('the composer carries no line of its own; the held bubble says it', () => {
    const held = renderContactThread(document.createElement('div'), {
      t, name: 'Tester B',
      messages: [{ origin: 'user', text: 'hoi', messageId: 'm1' }],
      deliveryStateFor: () => 'pending', deliveryReasonFor: () => 'held',
    });
    expect(held.querySelector('[data-role="no-point"]'), 'the composer line is gone').toBeNull();
    const chip = held.querySelector('.cc-cthread__msg--user .cc-cthread__bubble[data-row-id="m1"] .circle-view__bubble-delivery');
    expect(chip?.dataset.deliveryState).toBe('pending');
    expect(chip?.getAttribute('aria-label')).toBe(DELIVERY_REASON_LABELS.held);
  });
  it('a failed turn is a retryable chip under my bubble; the other side\'s bubble carries none', () => {
    const taps = [];
    const el = renderContactThread(document.createElement('div'), {
      t, name: 'Tester B',
      messages: [{ origin: 'user', text: 'hoi', messageId: 'm1' }, { origin: 'bot', text: 'hallo', messageId: 'their-1' }],
      deliveryStateFor: () => 'failed', deliveryReasonFor: () => 'peer-unreachable', onRetryDelivery: (id) => taps.push(id),
    });
    const chip = el.querySelector('[data-row-id="m1"] .circle-view__bubble-delivery');
    expect(chip?.tagName).toBe('BUTTON');
    expect(chip?.getAttribute('aria-label')).toBe(DELIVERY_REASON_LABELS['peer-unreachable']);
    chip.click();
    expect(taps).toEqual(['m1']);
    expect(el.querySelectorAll('.cc-cthread__msg--bot .circle-view__bubble-delivery')).toHaveLength(0);
  });
  it('without the hooks, or without an id, the bubble says nothing (as before)', () => {
    const plain = renderContactThread(document.createElement('div'), { t, name: 'Tester B', messages: [{ origin: 'user', text: 'hoi', messageId: 'm1' }, { origin: 'user', text: 'oud' }] });
    expect(plain.querySelectorAll('.circle-view__bubble-delivery')).toHaveLength(0);
    const noId = renderContactThread(document.createElement('div'), { t, name: 'Tester B', messages: [{ origin: 'user', text: 'oud' }], deliveryStateFor: () => 'pending' });
    expect(noId.querySelectorAll('.circle-view__bubble-delivery')).toHaveLength(0);
  });
});
