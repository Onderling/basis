/**
 * shareMyContact — the Mij panel that hands out this person's contact: a QR, the code, the link. @vitest-environment happy-dom
 *
 * Frits 2026-09-19: "it is supposed to simply link to the website, including the contact". The panel paints what
 * the host resolved (`getContactShareQr` → the code; `contactCardLink` → the link); it decides nothing itself.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderShareMyContact } from '../web/v2/shareMyContact.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const CARD = 'onderling-contact://eyJ3ZWJpZCI6Ind4In0';
const LINK = 'https://onderling.org/basis/#contact=eyJ3ZWJpZCI6Ind4In0';

describe('renderShareMyContact', () => {
  it('paints the title, the hint, the QR canvas, and the code + link each with a copy button', () => {
    const el = renderShareMyContact(document.createElement('div'), { payload: CARD, link: LINK, t, onBack: () => {} });
    expect(el.querySelector('.cc-share__title').textContent).toBe('circle.shareContact.title');
    expect(el.querySelector('.cc-share__hint').textContent).toBe('circle.shareContact.hint');
    expect(el.querySelector('canvas.cc-share__qr')).toBeTruthy();
    const code = el.querySelector('.cc-share__code input');
    const link = el.querySelector('.cc-share__link input');
    expect(code.value).toBe(CARD);
    expect(code.readOnly).toBe(true);
    expect(link.value).toBe(LINK);
    expect(el.querySelectorAll('.cc-share__copy').length).toBe(2);
  });
  it('the copy buttons hand the value to the clipboard and say so', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const el = renderShareMyContact(document.createElement('div'), { payload: CARD, link: LINK, t, onBack: () => {} });
    const btn = el.querySelector('.cc-share__link .cc-share__copy');
    btn.click();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(btn.textContent).toBe('circle.pairedDevices.copied');
  });
  it('without a card (no identity yet) it says so and still offers the way back', () => {
    const onBack = vi.fn();
    const el = renderShareMyContact(document.createElement('div'), { payload: null, link: null, t, onBack });
    expect(el.querySelector('.cc-share__error').textContent).toBe('circle.shareContact.error');
    expect(el.querySelector('.cc-share__code')).toBeNull();
    el.querySelector('.cc-share__back').click();
    expect(onBack).toHaveBeenCalled();
  });
  it('a card without a link form (no app url) still shows the code and the QR', () => {
    const el = renderShareMyContact(document.createElement('div'), { payload: CARD, link: null, t, onBack: () => {} });
    expect(el.querySelector('.cc-share__code input').value).toBe(CARD);
    expect(el.querySelector('.cc-share__link')).toBeNull();
    expect(el.querySelector('canvas.cc-share__qr')).toBeTruthy();
  });
});
