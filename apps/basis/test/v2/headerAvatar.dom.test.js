// @vitest-environment happy-dom
/** The header avatar paints the picture when it has one, else the initials; a tap opens the person's editor. */
import { describe, it, expect, vi } from 'vitest';
import { renderHeaderAvatar } from '../../web/v2/headerAvatar.js';

const t = (k) => k;
describe('renderHeaderAvatar', () => {
  it('initials without a picture; a tap opens', () => {
    const onOpen = vi.fn();
    const el = renderHeaderAvatar(document.createElement('div'), { avatar: { name: 'Frits de Roos', initials: 'FD' }, t, onOpen });
    expect(el.querySelector('.cc-header-avatar__initials').textContent).toBe('FD');
    expect(el.querySelector('img')).toBeNull();
    el.querySelector('.cc-header-avatar__button').click();
    expect(onOpen).toHaveBeenCalled();
  });
  it('the picture when there is one', () => {
    const el = renderHeaderAvatar(document.createElement('div'), { avatar: { name: 'F', initials: 'F' }, pictureUrl: 'blob:x', t });
    expect(el.querySelector('.cc-header-avatar__picture').getAttribute('src')).toBe('blob:x');
    expect(el.querySelector('.cc-header-avatar__initials')).toBeNull();
  });
});
