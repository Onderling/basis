// @vitest-environment happy-dom
//
// Profile-picture render: a media-typed attribute in `sees` renders as an <img>
// whose src comes from the injected host resolver (sealed ref → object-url via
// the circle media gateway); a hidden one never renders an img or leaks the ref.
import { describe, it, expect } from 'vitest';
import { renderMemberPersonaCard } from '../../web/v2/circleMemberCard.js';

const PIC = { type: 'blob', ref: 'blob://pic1', enc: { sealed: true, keyRef: 'k' } };
const picAttr = { key: 'profilePicture', media: true, value: PIC, labelKey: 'circle.memberCard.attr.profilePicture' };

describe('member-persona card — profile picture render', () => {
  it('renders the pic as an <img> and sets its src from resolvePicture', async () => {
    const c = document.createElement('div');
    renderMemberPersonaCard(c, {
      member: { handle: 'jan', profilePicture: PIC },
      split: { sees: [picAttr], hides: [], preset: 'full' },
      t: (k) => k,
      resolvePicture: (ref) => `blob-url:${ref.ref}`,
    });
    const img = c.querySelector('.circle-membercard__attr-pic');
    expect(img).toBeTruthy();
    expect(img.tagName).toBe('IMG');
    await Promise.resolve(); // flush the resolver microtask
    expect(img.getAttribute('src')).toBe('blob-url:blob://pic1');
    // never rendered the raw ref object as text
    expect(c.textContent).not.toContain('[object Object]');
  });

  it('a HIDDEN picture renders no img and no ref — only the hidden marker', () => {
    const c = document.createElement('div');
    renderMemberPersonaCard(c, {
      member: { handle: 'jan', profilePicture: PIC },
      split: { sees: [], hides: [picAttr], preset: 'handle' },
      t: (k) => k,
      resolvePicture: (ref) => `blob-url:${ref.ref}`,
    });
    expect(c.querySelector('.circle-membercard__attr-pic')).toBeNull();
    expect(c.textContent).not.toContain('blob://pic1');
  });

  it('no resolver → an empty <img> (never the raw ref as text)', () => {
    const c = document.createElement('div');
    renderMemberPersonaCard(c, {
      member: { handle: 'jan' },
      split: { sees: [picAttr], hides: [], preset: 'full' },
      t: (k) => k,
    });
    const img = c.querySelector('.circle-membercard__attr-pic');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBeNull();
    expect(c.textContent).not.toContain('[object Object]');
  });
});
