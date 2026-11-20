/**
 * Vandaag's top on the web: the availability words as a block whose tap opens the availability screen, and "Wacht op
 * jou" painted by the same block painter Mij used. The words come from the shared reading words (`identityLineWords`).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('Vandaag: the availability block', () => {
  it('says the words of now; a tap opens the availability screen', () => {
    const onAction = vi.fn();
    const el = document.createElement('div');
    renderCircleScreen(el, { t, onAction, blocks: [{ blockId: 'today-availability-0', type: 'availability', status: 'ok', titleKey: 'circle.availability.title',
      content: { reading: { key: 'availability', state: 'available' }, open: { kind: 'open-availability' } } }] });
    const b = el.querySelector('.circle-screen__availability');
    expect(b).not.toBeNull();
    expect(b.textContent).toContain('circle.profile.reading_available');
    b.click();
    expect(onAction).toHaveBeenCalledWith({ kind: 'open-availability' });
  });
});
