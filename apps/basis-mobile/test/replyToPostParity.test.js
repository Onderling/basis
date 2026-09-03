/**
 * Reply-to-post parity (web ≡ mobile) — a reply to a noticeboard post has ONE home on both v2 shells:
 * the contact thread. Both peer routers register the SAME shared handler for the reply's wire subtype,
 * both reply doors go through the SAME shared helper (send + persist our side + open the thread), and
 * both thread renderers paint the same "reply to a post" marker. A shell that drops any of the three is
 * the drift this test exists for (decided 2026-09-03; before it, web dropped the reply and mobile
 * painted it into a thread v2 hides).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const here = (p) => resolve(__dirname, p);
const read = (p) => readFileSync(here(p), 'utf8');

describe('reply-to-post surface parity', () => {
  const webApp    = read('../../basis/web/v2/circleApp.js');
  const mobileApp = read('../src/screens/ChatScreen.js');
  const webThread    = read('../../basis/web/v2/contactThread.js');
  const mobileThread = read('../src/screens/v2/ContactThreadScreen.js');
  const mobileBoard  = read('../src/screens/v2/CircleNoticeboard.js');

  it('both peer routers route chat-message through the shared threaded-chat handler', () => {
    for (const src of [webApp, mobileApp]) {
      expect(src).toMatch(/'chat-message':\s+makeHandleThreadedChat\(/);
      expect(src).toMatch(/core\/handlers\/threadedChat\.js/);
    }
  });

  it('both reply doors go through the shared replyToPost helper (no raw respondToItem call)', () => {
    // Matched piecewise, not as one line: the call spans lines on web and reformatting it is not drift.
    expect(webApp).toMatch(/replyToPost\(\{[\s\S]{0,240}callSkill: stoopCall[\s\S]{0,240}contactChannel: circleContactChannel/);
    expect(mobileBoard).toMatch(/replyToPost\(\{[\s\S]{0,120}callSkill, contactChannel[\s\S]{0,120}itemId: post\.id, body/);
    expect(webApp).not.toMatch(/stoopCall\('stoop', 'respondToItem'/);
    expect(mobileBoard).not.toMatch(/callSkill\('stoop', 'respondToItem'/);
  });

  it('both reply doors make the poster a contact row (the first-DM rule)', () => {
    // Walked on the A33: without this the thread a reply starts is unreachable once you navigate away.
    expect(webApp).toMatch(/replyToPost\(\{[\s\S]{0,320}notePeer:/);
    expect(mobileBoard).toMatch(/replyToPost\(\{[\s\S]{0,160}notePeer/);
  });

  it('both thread renderers paint the reply-to-post marker from the one locale key', () => {
    expect(webThread).toMatch(/circle\.contacts\.reply_to_post/);
    expect(mobileThread).toMatch(/circle\.contacts\.reply_to_post/);
  });
});
