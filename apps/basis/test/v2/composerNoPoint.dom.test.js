/**
 * THE COMPOSER SAYS A MESSAGE WAITS WHEN THERE IS NO CONNECTION POINT (Fable, 2026-11-06: the composer is where the person
 * stands when a message would vanish; rows 16/9/11). The host hands the relay question's predicate; both composers say it.
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { renderContactThread } from '../../web/v2/contactThread.js';

const t = (k) => k;

describe('the contact composer with no connection point', () => {
  it('says the message waits, and says nothing when a relay is known', () => {
    const none = renderContactThread(document.createElement('div'), { t, name: 'Tester B', messages: [], noRelay: true });
    expect(none.querySelector('[data-role="no-point"]')?.textContent).toBe('circle.composer.no_point');
    const known = renderContactThread(document.createElement('div'), { t, name: 'Tester B', messages: [], noRelay: false });
    expect(known.querySelector('[data-role="no-point"]')).toBeNull();
  });
});
