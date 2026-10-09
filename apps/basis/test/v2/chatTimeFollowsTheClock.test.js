/**
 * A Dutch circle chat said "11:22 PM" (exploratory walk, 2026-10-08): the web bubble formatted its time with the
 * BROWSER's locale (`toLocaleTimeString([])`), not the app's — an English browser painted 12-hour times into a Dutch
 * screen. Bubble times now use `timeWords`, the household's clock every other line already uses ("23:22").
 * The same walk found the nl chat filter saying "Agents" between Dutch chips; nl says "Bots" (the word the Dutch copy
 * uses everywhere else).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { timeWords } from '../../src/v2/whenWords.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the chat bubble time follows the household clock, not the browser', () => {
  const VIEW = read('../../web/v2/circleView.js');
  it('circleView formats bubble times with timeWords, never the browser locale', () => {
    const fn = VIEW.match(/function formatTimeLabel\(ts\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(fn).toMatch(/timeWords\(ts\)/);
    expect(fn).not.toMatch(/toLocaleTimeString/);
  });
  it('timeWords is 24-hour whatever the runtime locale', () => {
    expect(timeWords(Date.UTC(2026, 9, 8, 23, 22), { tz: 'UTC' })).toBe('23:22');
  });
});

describe('the nl author chip is Dutch', () => {
  it('chatFilter.authors.agents is not the English word', () => {
    const nl = JSON.parse(read('../../src/locales/circle.nl.json'));
    expect(nl.chatFilter.authors.agents.text).toBe('Bots');
  });
});
