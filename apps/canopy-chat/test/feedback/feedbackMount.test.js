// @vitest-environment node
// M6 — the platform-neutral feedback mount logic (shared web + mobile). Driven with a FAKE
// surface so the routing decisions are tested without the LLM/bus: /feedback enters, free text
// routes while active, slash commands pass through even while active, /feedback-stop leaves,
// non-feedback text is left for the caller. The agent contact item is surfaced.

import { test, expect } from 'vitest';
import { createFeedbackMount } from '../../src/feedback/feedbackMount.js';

function fakeSurface() {
  const active = new Set();
  const calls = [];
  return {
    calls,
    async start(t) { calls.push(['start', t]); active.add(String(t)); },
    stop(t) { calls.push(['stop', t]); active.delete(String(t)); },
    isActive(t) { return active.has(String(t)); },
    async handle(text, t) { calls.push(['handle', text, t]); return true; },
  };
}

function mk() {
  const surface = fakeSurface();
  const ub = [], bb = [];
  const mount = createFeedbackMount({
    surface,
    appendUserBubble: (t, x) => ub.push([t, x]),
    appendBotBubble:  (t, x) => bb.push([t, x]),
  });
  return { mount, surface, ub, bb };
}

test('/feedback enters feedback mode + echoes the user input', async () => {
  const { mount, surface, ub } = mk();
  expect(await mount.tryHandle('/feedback', 'th')).toBe(true);
  expect(surface.calls).toContainEqual(['start', 'th']);
  expect(ub).toContainEqual(['th', '/feedback']);
  expect(mount.isActive('th')).toBe(true);
});

test('free text while active routes to the bot', async () => {
  const { mount, surface } = mk();
  await mount.tryHandle('/feedback', 'th');
  expect(await mount.tryHandle('de ggz-wachtlijst is te lang', 'th')).toBe(true);
  expect(surface.calls).toContainEqual(['handle', 'de ggz-wachtlijst is te lang', 'th']);
});

test('genuine circle slash commands pass through even while active (returns false)', async () => {
  const { mount } = mk();
  await mount.tryHandle('/feedback', 'th');
  expect(await mount.tryHandle('/show', 'th')).toBe(false);    // a circle command → caller dispatches it
  expect(await mount.tryHandle('/tasks', 'th')).toBe(false);
});

test("the bot's OWN slash commands reach the bot while active (/klaar review, /help, /done)", async () => {
  const { mount, surface } = mk();
  await mount.tryHandle('/feedback', 'th');
  expect(await mount.tryHandle('/klaar', 'th')).toBe(true);    // the review/submit step — must reach the bot
  expect(surface.calls).toContainEqual(['handle', '/klaar', 'th']);
  expect(await mount.tryHandle('/help', 'th')).toBe(true);
  expect(await mount.tryHandle('/done', 'th')).toBe(true);
});

test("the bot's slash commands do NOT reach the bot when feedback is INACTIVE (pass through)", async () => {
  const { mount } = mk();
  expect(await mount.tryHandle('/klaar', 'th')).toBe(false);   // not in feedback → circle bot handles it
});

test('/feedback-stop leaves feedback mode (no UI text emitted by the mount)', async () => {
  const { mount, surface, bb } = mk();
  await mount.tryHandle('/feedback', 'th');
  expect(await mount.tryHandle('/feedback-stop', 'th')).toBe(true);
  expect(surface.calls).toContainEqual(['stop', 'th']);
  expect(mount.isActive('th')).toBe(false);
  expect(bb).toEqual([]);   // localisation is the shell's job
});

test('free text when NOT in feedback mode is left for the caller', async () => {
  const { mount } = mk();
  expect(await mount.tryHandle('hello there', 'th2')).toBe(false);
});

test('open() enters feedback mode directly (the contact action)', async () => {
  const { mount, surface } = mk();
  await mount.open('th3');
  expect(surface.calls).toContainEqual(['start', 'th3']);
  expect(mount.isActive('th3')).toBe(true);
});

test('contactItem() exposes the distinct agent contact', () => {
  const { mount } = mk();
  const item = mount.contactItem({ label: 'Feedback assistant' });
  expect(item.id).toBe('fp-bot');
  expect(item.kind).toBe('agent');
  expect(item.buttons[0].callbackData).toBe('openFeedback:fp-bot');
});
