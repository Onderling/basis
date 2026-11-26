// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * The web app runs only in a window of its own, never inside another page's frame (ledger L1041).
 *
 * @guard framed by another page, the web app's main shell refuses to start and a screen address starts (its entry asks before either shell)
 *
 * A page that frames the app could drive it, or overlay it to steer a person's clicks. The frame rule a browser honours
 * (`frame-ancestors`) is a response header only (ignored in a meta tag), and the static host sends none, so the app
 * checks itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isFramed, startsWhenFramed } from '../../src/web/ownWindow.js';

describe('a window of its own', () => {
  it('a top-level window is not framed; a framed one is; one whose top cannot be read is taken as framed', () => {
    const top = {}; top.top = top; top.self = top;
    expect(isFramed(top)).toBe(false);
    expect(isFramed({ self: {}, top: {} })).toBe(true);
    const hidden = { self: {} }; Object.defineProperty(hidden, 'top', { get() { throw new Error('cross-origin'); } });
    expect(isFramed(hidden)).toBe(true);
  });
  it('framed, the main app refuses and a screen address starts (a Telegram client shows the screen in a frame)', () => {
    const framed = { self: {}, top: {} };
    expect(startsWhenFramed(framed, { screen: false })).toBe(false);
    expect(startsWhenFramed(framed, { screen: true })).toBe(true);
    const top = {}; top.top = top; top.self = top;
    expect(startsWhenFramed(top, { screen: false })).toBe(true);
  });

  it('the web app\'s entry asks it before either shell (the app, a connected screen) starts', () => {
    const src = readFileSync(fileURLToPath(new URL('../../web/v2/circleApp.js', import.meta.url)), 'utf8');
    const last = src.trim().split('\n').filter((l) => /startScreenShell\(window\)|\bboot\(\)/.test(l) && !/^\s*(\/\/|\*)/.test(l)).pop();
    expect(last).toMatch(/^if \(!startsWhenFramed\(window, \{ screen: atScreenAddress \}\)\) refuseFramed\(/);
    expect(src).toMatch(/const atScreenAddress = isScreenAddress\(window\.location\.hash, window\.location\.search\);/);
  });
});
