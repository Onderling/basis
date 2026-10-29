import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Circle-chat receive/fan parity fitness — pins two fixes so the drift cannot recur:
//
// 1. NO inbox. Live chat arrives only as signed statements at the chat rail, and the device log is the
//    record; the legacy chat inbox and its one-time history migration are retired (lint-retired-modules
//    holds them retired), so no shell constructs one.
//
// 2. The card fan is a WEB ≡ MOBILE agreement. Both shells call the SAME shared fan helper; web
//    threads the message's `card` embed through and mobile silently dropped it, so a message with a card
//    fanned from mobile would arrive as bare text. Both sides must thread `card` — this reads both
//    sources and holds them to it (pin the agreement, not either value).

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

const chatScreen = read('../src/screens/ChatScreen.js');
const launcher   = read('../src/screens/v2/CircleLauncherScreen.js');
const appJs      = read('../App.js');
const webShell   = read('../../basis/web/v2/circleApp.js');

describe('circle chat — no inbox, card-fan parity (web ≡ mobile)', () => {
  it('no shell constructs a chat inbox — live chat lands at the chat rail only', () => {
    for (const src of [chatScreen, launcher, appJs, webShell]) expect(src).not.toMatch(/createChatMessageInbox\s*\(/);
  });

  it('the legacy plain-envelope receive is GONE — live chat arrives only as signed statements', () => {
    expect(chatScreen).not.toMatch(/makeFallbackInbox/);
    expect(chatScreen).not.toMatch(/'circle-chat-message'\s*:/);          // no unsigned receive path
    // The signed lane is still registered, one level up: since 2026-09-09 the five signed lanes are
    // built once in `src/v2/circleLanes.js` and spread into both shells, so this screen names the
    // table rather than the subtype. `shellsRouteTheSameSubtypes` holds the table itself to routing
    // CHAT_STATEMENT_BROADCAST, and holds both shells to spreading it.
    expect(chatScreen).toMatch(/buildCircleLanes/);
    expect(chatScreen).toMatch(/\.\.\.lanes\.handlers/);
  });

  it('BOTH shells thread `card` through the shared circle fan helper', () => {
    // The agreement: the shared broadcastCircleFanOut receives the embed card on both platforms.
    const mobileFan = launcher.slice(launcher.indexOf('broadcastCircleFanOut({'));
    expect(mobileFan.slice(0, 300)).toMatch(/\bcard\b/);
    const webFanIdx = webShell.indexOf('broadcastCircleFanOut({');
    expect(webFanIdx).toBeGreaterThan(-1);
    expect(webShell.slice(webFanIdx, webFanIdx + 300)).toMatch(/\bcard\b/);
    // And the mobile retry re-fans the ORIGINAL card, exactly like web's retry.
    expect(launcher).toMatch(/broadcastFanOut\(\{\s*msgId,\s*text,\s*ts,\s*card/);
    expect(webShell).toMatch(/broadcastFanOut\(\{\s*msgId,\s*text,\s*ts,\s*card/);
  });
});
