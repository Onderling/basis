/**
 * The host frame — one line at the top of a HOSTED web build that links back to the site that hosts it.
 * @vitest-environment happy-dom
 *
 * The site is a build ARGUMENT, never a literal in the tree (a self-built shell shows nothing): `hostFrameOf` reads
 * the two build values and keeps only an absolute http(s) link; the painter draws the line through t().
 */
import { describe, it, expect } from 'vitest';
import { hostFrameOf } from '../src/v2/hostFrame.js';
import { renderHostFrame } from '../web/v2/hostFrameBar.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('hostFrameOf — the frame is an argument, or nothing', () => {
  it('absent or empty → no frame', () => {
    expect(hostFrameOf()).toBeNull();
    expect(hostFrameOf({ returnTo: '', label: 'x' })).toBeNull();
    expect(hostFrameOf({ returnTo: '   ' })).toBeNull();
  });
  it('only an absolute http(s) link becomes a frame', () => {
    expect(hostFrameOf({ returnTo: 'javascript:alert(1)', label: 'x' })).toBeNull();
    expect(hostFrameOf({ returnTo: '/relative', label: 'x' })).toBeNull();
    expect(hostFrameOf({ returnTo: 'not a url' })).toBeNull();
    expect(hostFrameOf({ returnTo: 'https://site.example/', label: ' Site ' })).toEqual({ href: 'https://site.example/', label: 'Site' });
  });
  it('no label → the link\'s host names the site', () => {
    expect(hostFrameOf({ returnTo: 'https://site.example/basis-home' })).toEqual({ href: 'https://site.example/basis-home', label: 'site.example' });
  });
});

describe('renderHostFrame — one line, through t()', () => {
  it('paints one link back to the site, once; no frame → nothing', () => {
    const host = document.createElement('div');
    host.appendChild(document.createElement('main'));
    expect(renderHostFrame(host, { frame: null, t })).toBeNull();
    expect(host.querySelector('.cc-host-frame')).toBeNull();
    const frame = hostFrameOf({ returnTo: 'https://site.example/', label: 'Site' });
    renderHostFrame(host, { frame, t });
    renderHostFrame(host, { frame, t });
    expect(host.querySelectorAll('.cc-host-frame').length).toBe(1);
    expect(host.firstElementChild.classList.contains('cc-host-frame')).toBe(true);
    const a = host.querySelector('.cc-host-frame a');
    expect(a.getAttribute('href')).toBe('https://site.example/');
    expect(a.textContent).toBe('circle.hostFrame.back:{"site":"Site"}');
  });
});
