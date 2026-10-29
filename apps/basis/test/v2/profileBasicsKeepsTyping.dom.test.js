// @vitest-environment happy-dom
//
// A NAME TYPED WHILE THE PROFILE LOADS IS KEPT. The editor paints at once and paints again when `getMyProfile`
// answers; the second paint used to replace the fields with the stored values, so a name typed in between was wiped
// and Save saw no change and sent nothing (the rename never left the device). A repaint keeps what the person typed.
import { describe, it, expect, vi } from 'vitest';
import { renderProfileBasics } from '../../web/v2/profileBasics.js';

const t = (k) => k;

describe('the profile editor keeps what was typed across a repaint', () => {
  it('a name typed before the profile arrives survives the repaint and is what Save sends', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const onSaveProfile = vi.fn();
    renderProfileBasics(el, { profile: {}, t, onSaveProfile });                      // first paint: nothing loaded yet
    el.querySelector('.cc-profile__display').value = 'Bea Jansen';                   // the person types
    renderProfileBasics(el, { profile: { displayName: 'Bea', handle: 'bea' }, t, onSaveProfile });   // the load lands
    expect(el.querySelector('.cc-profile__display').value).toBe('Bea Jansen');
    expect(el.querySelector('.cc-profile__handle').value, 'an untouched field takes the loaded value').toBe('bea');
    el.querySelector('.cc-profile__save').click();
    expect(onSaveProfile).toHaveBeenCalledWith({ handle: 'bea', displayName: 'Bea Jansen' });
  });

  it('after a save the fields show the saved values again (nothing typed is pending)', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    renderProfileBasics(el, { profile: { displayName: 'Bea' }, t });
    renderProfileBasics(el, { profile: { displayName: 'Bea Jansen' }, t });
    expect(el.querySelector('.cc-profile__display').value).toBe('Bea Jansen');
  });

  it('the field being typed into is the same element after the repaint, still focused, so typing lands on it', () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const onSaveProfile = vi.fn();
    renderProfileBasics(el, { profile: {}, t, onSaveProfile });
    const typing = el.querySelector('.cc-profile__display');
    typing.focus();                                                                    // the person starts typing
    renderProfileBasics(el, { profile: { displayName: '' }, t, onSaveProfile });      // the load lands mid-typing
    typing.value = 'Bea';                                                              // the rest of the keystrokes
    expect(el.querySelector('.cc-profile__display'), 'the repaint kept the element').toBe(typing);
    expect(document.activeElement, 'and its focus').toBe(typing);
    el.querySelector('.cc-profile__save').click();
    expect(onSaveProfile).toHaveBeenCalledWith({ handle: '', displayName: 'Bea' });
  });
});
