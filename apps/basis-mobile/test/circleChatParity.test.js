import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Circle-chat receive/fan parity fitness — pins two fixes so the drift cannot recur:
//
// 1. ONE inbox. The circle-chat inbox is the App.js singleton (validation, dedup, ingest mirror,
//    resolveRef, receipts). ChatScreen once built a private fallback twin when the prop was missing —
//    no resolveRef, no receipts, a SECOND dedup domain that could double-render against catch-up.
//    Nothing ever reached it; it is deleted, and this test fails if a screen grows an inbox again.
//
// 2. The media fan is a WEB ≡ MOBILE agreement. Both shells call the SAME shared fan helper; web
//    threads the message's `media` embed through and mobile silently dropped it, so a media message
//    fanned from mobile would arrive as bare text. Both sides must thread `media` — this reads both
//    sources and holds them to it (pin the agreement, not either value).

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

const chatScreen = read('../src/screens/ChatScreen.js');
const launcher   = read('../src/screens/v2/CircleLauncherScreen.js');
const appJs      = read('../App.js');
const webShell   = read('../../basis/web/v2/circleApp.js');

describe('circle chat — one inbox, media-fan parity (web ≡ mobile)', () => {
  it('no screen constructs its own chat inbox — the App.js singleton is the only one', () => {
    expect(chatScreen).not.toMatch(/createChatMessageInbox\s*\(/);
    expect(launcher).not.toMatch(/createChatMessageInbox\s*\(/);
    const appCalls = appJs.match(/createChatMessageInbox\s*\(/g) ?? [];
    expect(appCalls).toHaveLength(1);                       // the singleton, and nothing else
  });

  it('the legacy plain-envelope receive is GONE — live chat arrives only as signed statements', () => {
    expect(chatScreen).not.toMatch(/makeFallbackInbox/);
    expect(chatScreen).not.toMatch(/'circle-chat-message'\s*:/);          // no unsigned receive path
    expect(chatScreen).toMatch(/CHAT_STATEMENT_BROADCAST/);               // the signed one is registered
  });

  it('the App singleton carries the full receive config (resolveRef + receipts + self-author)', () => {
    const singleton = appJs.slice(appJs.indexOf('createChatMessageInbox('));
    for (const key of ['resolveRef', 'onStored', 'isSelfAuthored']) {
      expect(singleton).toContain(key);
    }
  });

  it('BOTH shells thread `media` through the shared circle fan helper', () => {
    // The agreement: the shared broadcastCircleFanOut receives the media embed on both platforms.
    const mobileFan = launcher.slice(launcher.indexOf('broadcastCircleFanOut({'));
    expect(mobileFan.slice(0, 300)).toMatch(/\bmedia\b/);
    const webFanIdx = webShell.indexOf('broadcastCircleFanOut({');
    expect(webFanIdx).toBeGreaterThan(-1);
    expect(webShell.slice(webFanIdx, webFanIdx + 300)).toMatch(/\bmedia\b/);
    // And the mobile retry re-fans the ORIGINAL media, exactly like web's retry.
    expect(launcher).toMatch(/broadcastFanOut\(\{\s*msgId,\s*text,\s*ts,\s*media/);
    expect(webShell).toMatch(/broadcastFanOut\(\{\s*msgId,\s*text,\s*ts,\s*media/);
  });
});
