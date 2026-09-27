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
  it('the QR encodes the LINK when there is one, else the code (2026-09-21: a camera opens a link, not a scheme)', () => {
    const withLink = renderShareMyContact(document.createElement('div'), { payload: CARD, link: LINK, qr: LINK, t, onBack: () => {} });
    expect(withLink.querySelector('canvas.cc-share__qr').dataset.encodes).toBe('link');
    const codeOnly = renderShareMyContact(document.createElement('div'), { payload: CARD, link: null, qr: CARD, t, onBack: () => {} });
    expect(codeOnly.querySelector('canvas.cc-share__qr').dataset.encodes).toBe('code');
  });
  it('a card without a link form (no app url) still shows the code and the QR', () => {
    const el = renderShareMyContact(document.createElement('div'), { payload: CARD, link: null, t, onBack: () => {} });
    expect(el.querySelector('.cc-share__code input').value).toBe(CARD);
    expect(el.querySelector('.cc-share__link')).toBeNull();
    expect(el.querySelector('canvas.cc-share__qr')).toBeTruthy();
  });
});

describe('the contact QR is drawn to be read by a phone camera', () => {
  it('one set of drawing settings for both shells: level L, the standard four-module quiet zone', async () => {
    const { CONTACT_QR } = await import('../src/v2/contactCardLink.js');
    expect(CONTACT_QR).toMatchObject({ errorCorrectionLevel: 'L', quietZoneModules: 4 });
  });

  it('web draws with those settings, sharp on a high-density screen', async () => {
    const toCanvas = vi.fn();
    vi.doMock('qrcode', () => ({ default: { toCanvas } }));
    vi.resetModules();
    const { renderShareMyContact: render } = await import('../web/v2/shareMyContact.js');
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: 2, configurable: true });
    render(document.createElement('div'), { payload: CARD, link: LINK, qr: LINK, t, onBack: () => {} });
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalled());
    const [, value, opts] = toCanvas.mock.calls[0];
    expect(value).toBe(LINK);
    expect(opts).toMatchObject({ errorCorrectionLevel: 'L', margin: 4 });
    expect(opts.width).toBeGreaterThanOrEqual(2 * 280);   // drawn at the screen's pixel density
    vi.doUnmock('qrcode');
    vi.resetModules();
  });

  it('a tap enlarges the QR, and a second tap brings it back', () => {
    const el = renderShareMyContact(document.createElement('div'), { payload: CARD, link: LINK, qr: LINK, t, onBack: () => {} });
    const qr = el.querySelector('canvas.cc-share__qr');
    qr.click();
    expect(qr.classList.contains('cc-share__qr--large')).toBe(true);
    qr.click();
    expect(qr.classList.contains('cc-share__qr--large')).toBe(false);
  });
});
