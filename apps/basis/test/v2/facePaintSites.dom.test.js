// @vitest-environment happy-dom
//
// A face is DRAWN only where the host hands the paint site the circle's opener. The shared decision (`faceOf`) and
// the drawing (`paintFace`) were built and tested, but three of the four web sites were never given a resolver —
// the members tab, the Contacten row, the thread header — so they could only ever show the initial (found by the
// face walk, 2026-09-25). These pin that each renderer passes the resolver through to the drawing.
import { describe, it, expect } from 'vitest';
import { renderCircleView } from '../../web/v2/circleView.js';
import { renderContactsRoster } from '../../web/v2/contactsRoster.js';
import { renderContactThread } from '../../web/v2/contactThread.js';

const t = (key) => key;
const PIC = { type: 'blob', ref: 'blob://abc', enc: { sealed: true, keyRef: 'k1', format: 'x', bytes: 900, thumb: 'AAAA' } };
const mount = () => { const el = document.createElement('div'); document.body.appendChild(el); return el; };
const settle = () => new Promise((r) => { setTimeout(r, 0); });
const opened = [];
const resolvePicture = async (ref) => { opened.push(ref); return 'blob:opened'; };

describe('the face paint sites hold the opener', () => {
  it('the members tab draws a released picture', async () => {
    const el = mount();
    renderCircleView(el, {
      circle: { id: 'c', name: 'C' }, rows: [], t,
      tabs: [{ id: 'conversation', label: 'C' }, { id: 'members', label: 'M' }], activeTab: 'members',
      members: [{ id: 'bea', handle: 'bea', realName: null, released: false, profilePicture: PIC }, { id: 'bob', handle: 'bob', realName: null, released: false }],
      selfWebid: 'me', resolvePicture,
    });
    await settle();
    const [bea, bob] = el.querySelectorAll('.circle-view__member-face');
    expect(bea.querySelector('img')?.getAttribute('src')).toBe('blob:opened');
    expect(bob.querySelector('img')).toBeNull();
    expect(bob.textContent).toBe('@');
  });

  it('the Contacten row opens each row\'s picture with ITS pair circle', async () => {
    const el = mount();
    const asked = [];
    renderContactsRoster(el, {
      t, contacts: [{ contactId: 'bea', name: 'Bea', face: PIC, pairCircleId: 'pair-1', reachable: true }],
      resolvePictureFor: (c) => { asked.push(c.pairCircleId); return resolvePicture; },
    });
    await settle();
    expect(asked).toEqual(['pair-1']);
    expect(el.querySelector('.cc-contacts__row[data-contact-id="bea"] .cc-contacts__icon img')?.getAttribute('src')).toBe('blob:opened');
  });

  it('the thread header draws it too', async () => {
    const el = mount();
    renderContactThread(el, { name: 'Bea', face: PIC, resolvePicture, t, messages: [] });
    await settle();
    expect(el.querySelector('.cc-cthread__face img')?.getAttribute('src')).toBe('blob:opened');
  });
});
