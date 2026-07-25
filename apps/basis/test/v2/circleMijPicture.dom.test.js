// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderMij } from '../../web/v2/circleMij.js';

const model = { ok: true, defaultId: 'default', general: { properties: [] }, personas: [], circles: [] };

describe('renderMij — profile-picture set affordance', () => {
  it('renders a file picker when onSetPicture is wired', () => {
    const c = document.createElement('div');
    renderMij(c, { model, t: (k) => k, onSetPicture: () => {}, resolvePicture: () => 'u', currentPicture: null });
    expect(c.querySelector('[data-key="profilePicture"]')).toBeTruthy();
    expect(c.querySelector('.cc-mij__picture-input')).toBeTruthy();
  });
  it('omits the picker when onSetPicture is absent (no sealed-media seam)', () => {
    const c = document.createElement('div');
    renderMij(c, { model, t: (k) => k });
    expect(c.querySelector('[data-key="profilePicture"]')).toBeNull();
  });
  it('previews the current picture via the resolver', async () => {
    const c = document.createElement('div');
    const PIC = { type: 'blob', ref: 'blob://p', enc: { sealed: true } };
    renderMij(c, { model, t: (k) => k, onSetPicture: () => {}, resolvePicture: (ref) => `url:${ref.ref}`, currentPicture: PIC });
    const img = c.querySelector('.cc-mij__picture-preview');
    expect(img).toBeTruthy();
    await Promise.resolve();
    expect(img.getAttribute('src')).toBe('url:blob://p');
  });
});
