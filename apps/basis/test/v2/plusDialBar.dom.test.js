/**
 * The web tab bar paints the "+" IN the bar (no floating button) and opens it into round buttons, from the shared model
 * (`plusDial.js`). The bar decides nothing: every press goes to the host as 'plus', a button id, or 'outside'.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderCircleTabBar } from '../../web/v2/circleTabBar.js';
import { basisManifest } from '../../src/index.js';
import { plusDialFor, PLUS_MIDDLE_NONE } from '../../src/v2/plusDial.js';

const t = (k) => k;
const slots = (el) => [...el.querySelectorAll('.circle-tabbar__tab, .circle-tabbar__plus')].map((b) => b.dataset.tab ?? '+');
const bar = (plus) => {
  const el = document.createElement('nav');
  document.body.appendChild(el);
  return renderCircleTabBar(el, { active: 'screens', t, plus });
};

afterEach(() => { document.body.innerHTML = ''; });

describe('the "+" docked in the web tab bar', () => {
  it('sits in the middle of the bar, between Kringen and Contacten', () => {
    const el = bar({ dial: plusDialFor(basisManifest), open: false, onPress: () => {} });
    expect(slots(el)).toEqual(['screens', 'circles', '+', 'contacten', 'mij']);
  });

  it('a screen without the "+" gets the bar without it', () => {
    expect(slots(bar(null))).toEqual(['screens', 'circles', 'contacten', 'mij']);
  });

  it('closed: a "+" with its name, and no round buttons; a tap is the press "plus"', () => {
    const onPress = vi.fn();
    const el = bar({ dial: plusDialFor(basisManifest), open: false, onPress });
    const plus = el.querySelector('.circle-tabbar__plus');
    expect(plus.textContent).toBe('+');
    expect(plus.getAttribute('aria-label')).toBe('circle.vandaag.plus');
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('.circle-plusdial')).toBeNull();
    plus.click();
    expect(onPress).toHaveBeenCalledWith('plus');
  });

  it('open: the "+" spot becomes Chat, with Scan and My QR around it, each a labelled button', () => {
    const onPress = vi.fn();
    const el = bar({ dial: plusDialFor(basisManifest), open: true, onPress });
    const plus = el.querySelector('.circle-tabbar__plus');
    expect(plus.dataset.dial).toBe('chat');
    expect(plus.textContent).toContain('circle.plus.chat');
    expect(plus.getAttribute('aria-expanded')).toBe('true');
    const around = [...el.querySelectorAll('.circle-plusdial__btn')];
    expect(around.map((b) => b.dataset.dial)).toEqual(['scan', 'share']);
    expect(around.map((b) => b.textContent)).toEqual(['circle.plus.scan', 'circle.plus.my_qr']);
    around[1].click();
    expect(onPress).toHaveBeenCalledWith('share');
    plus.click();
    expect(onPress).toHaveBeenLastCalledWith('plus');
  });

  it('open with nothing in the middle: the "+" spot is a close button, every button around', () => {
    const el = bar({ dial: plusDialFor(basisManifest, { middle: PLUS_MIDDLE_NONE }), open: true, onPress: () => {} });
    const plus = el.querySelector('.circle-tabbar__plus');
    expect(plus.dataset.dial).toBeUndefined();
    expect(plus.getAttribute('aria-label')).toBe('circle.plus.close');
    expect([...el.querySelectorAll('.circle-plusdial__btn')].map((b) => b.dataset.dial)).toEqual(['chat', 'scan', 'share']);
  });

  it('a touch outside the buttons, on a tab, or Escape is the press "outside" (a tab does not switch)', () => {
    const onPress = vi.fn();
    const onCircles = vi.fn();
    const el = document.createElement('nav');
    document.body.appendChild(el);
    renderCircleTabBar(el, { active: 'screens', t, onCircles, plus: { dial: plusDialFor(basisManifest), open: true, onPress } });
    el.querySelector('.circle-plusdial__backdrop').click();
    expect(onPress).toHaveBeenLastCalledWith('outside');
    el.querySelector('[data-tab="circles"]').click();
    expect(onCircles).not.toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onPress).toHaveBeenCalledTimes(3);
    expect(onPress).toHaveBeenLastCalledWith('outside');
  });

  it('a repaint keeps the "+" itself: a press begun before a repaint (a count landing) still ends on it', () => {
    // A tap is mousedown + mouseup on ONE node; the bar repaints whenever a count lands. If the repaint replaced the "+",
    // the mouseup fell on a new node and the browser fired no click: the second tap was lost, the dial stayed open.
    const onPress = vi.fn();
    const el = document.createElement('nav');
    document.body.appendChild(el);
    const plus = { dial: plusDialFor(basisManifest, { middle: PLUS_MIDDLE_NONE }), open: true, onPress };
    renderCircleTabBar(el, { active: 'screens', t, plus });
    const before = el.querySelector('.circle-tabbar__plus');
    renderCircleTabBar(el, { active: 'screens', t, plus, badges: { contacten: 2 } });
    const after = el.querySelector('.circle-tabbar__plus');
    expect(after).toBe(before);
    after.click();
    expect(onPress).toHaveBeenCalledTimes(1);   // one listener, not one per paint
    expect(onPress).toHaveBeenCalledWith('plus');
  });

  it('Escape is heard only while open: a repaint closed stops listening', () => {
    const onPress = vi.fn();
    const el = document.createElement('nav');
    document.body.appendChild(el);
    renderCircleTabBar(el, { active: 'screens', t, plus: { dial: plusDialFor(basisManifest), open: true, onPress } });
    renderCircleTabBar(el, { active: 'screens', t, plus: { dial: plusDialFor(basisManifest), open: false, onPress } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
