/**
 * A person hidden from the room says nothing to it. "Even stil", the radio off, or no level chosen yet: the room does
 * not see this device, yet a chat line or a question would go to every peer it sees, from its room address — telling
 * the room someone is there. So the controller itself refuses (not the button that happens to render), with a reason
 * the screen can say. Announced against the person's wish ("still visible") is visible, not hidden. Answering stays
 * open: it is the deliberate disclosure to one asker, and says so ("you are now visible to them").
 */
import { describe, it, expect, vi } from 'vitest';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';
import { nearbyMineSummary } from '../../src/v2/nearbyStream.js';
import circleNl from '../../src/locales/circle.nl.json' with { type: 'json' };
import circleEn from '../../src/locales/circle.en.json' with { type: 'json' };

const text = (bundle, key) => key.split('.').slice(1).reduce((o, k) => o?.[k], bundle)?.text;
const T0 = 1_700_000_000_000;
const flush = () => new Promise((r) => setTimeout(r, 0));
// a readable invite (what `buildCircleInviteUri` makes), so only being hidden can refuse it
const URI = `onderling-invite://${globalThis.btoa(JSON.stringify({ kind: 'membershipCode', groupId: 'c1', code: 'CODE-1' }))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

/** A discoverability control that reports exactly what it is asked (or, `degraded`, announces regardless). */
function controlOf({ degraded = false } = {}) {
  let report = null;
  return {
    set: (state) => {
      report = degraded && state !== 'browse+publish'
        ? { requested: state, effective: 'browse+publish', degraded: true, perTransport: [] }
        : { requested: state, effective: state, degraded: false, perTransport: [] };
      return report;
    },
    report: () => report,
    subscribe: () => () => {},
  };
}

function room({ levelChosen = true, radioOff = false, degraded = false } = {}) {
  let pushAsk = null;
  const broadcastKind = vi.fn(async () => ({ sent: 2, failed: 0, peers: 2 }));
  const broadcast = vi.fn(async () => ({ sent: 2, failed: 0, peers: 2 }));
  const sendAnswer = vi.fn(async () => ({ ok: true }));
  const screen = createNearbyScreen({
    control: controlOf({ degraded }),
    subscribeToAsks: (fn) => { pushAsk = fn; return () => {}; },
    askChannel: { broadcastKind, broadcast, sendAnswer },
    radio: { get: () => (radioOff ? 'off' : 'on'), set: () => {} },
    allows: { chat: true, card: true },
    invitePublish: { c1: true },
    levelChosen: () => levelChosen,
    myRoomAddress: () => 'me', now: () => T0, t: (k) => k,
  });
  screen.open();
  return { screen, broadcastKind, broadcast, sendAnswer, pushAsk: (a) => pushAsk?.(a) };
}

const HIDDEN = {
  'even stil': (r) => r.screen.setQuiet(true),
  'the radio off': null,
  'no level chosen yet': null,
};
const build = (name) => (name === 'the radio off' ? room({ radioOff: true }) : name === 'no level chosen yet' ? room({ levelChosen: false }) : room());

describe('hidden from the room: the controller sends nothing', () => {
  for (const name of Object.keys(HIDDEN)) {
    it(`${name}: a chat line goes to no peer, and the refusal says why`, async () => {
      const r = build(name);
      HIDDEN[name]?.(r);
      const out = await r.screen.say('hoi');
      expect(r.broadcastKind).not.toHaveBeenCalled();
      expect(out).toMatchObject({ ok: false, reason: 'hidden', notice: 'chat_hidden_line' });
      expect(r.screen.model().chat ?? []).toEqual([]);
    });

    it(`${name}: showing my card goes to no peer, and the refusal says why`, async () => {
      const r = build(name);
      HIDDEN[name]?.(r);
      const out = await r.screen.showCard({ label: 'Anna', line: 'fietsen' });
      expect(r.broadcastKind).not.toHaveBeenCalled();
      expect(out).toMatchObject({ ok: false, reason: 'hidden', notice: 'card_hidden' });
    });

    it(`${name}: offering a circle goes to no peer, and the refusal says why`, async () => {
      const r = build(name);
      HIDDEN[name]?.(r);
      const out = await r.screen.publishInvite({ uri: URI, circleId: 'c1', circleName: 'Tuin', expiresAt: T0 + 60_000 });
      expect(r.broadcastKind).not.toHaveBeenCalled();
      expect(out).toMatchObject({ ok: false, reason: 'hidden', notice: 'invite_hidden' });
    });

    it(`${name}: a question to the room goes to no peer, and the refusal says why`, async () => {
      const r = build(name);
      HIDDEN[name]?.(r);
      const out = await r.screen.askRoom({ text: 'heeft iemand een pomp?' });
      expect(r.broadcast).not.toHaveBeenCalled();
      expect(r.broadcastKind).not.toHaveBeenCalled();
      expect(out).toMatchObject({ ok: false, reason: 'hidden', notice: 'ask_hidden' });
    });
  }

  it('visible: the line, the card, the circle and the question go out', async () => {
    const r = room();
    expect((await r.screen.say('hoi')).ok).toBe(true);
    expect((await r.screen.showCard({ label: 'Anna', line: '' })).ok).toBe(true);
    expect((await r.screen.publishInvite({ uri: URI, circleId: 'c1', circleName: 'Tuin', expiresAt: T0 + 60_000 })).ok).toBe(true);
    expect(r.broadcastKind).toHaveBeenCalledTimes(3);
    expect((await r.screen.askRoom({ text: 'pomp?' })).ok).toBe(true);
    expect(r.broadcast).toHaveBeenCalledTimes(1);
  });

  it('back from "even stil": talking works again', async () => {
    const r = room();
    r.screen.setQuiet(true);
    expect((await r.screen.say('hoi')).ok).toBe(false);
    r.screen.setQuiet(false);
    expect((await r.screen.say('hoi')).ok).toBe(true);
  });

  it('announced against the wish (still visible) is visible, not hidden: the room sees this device anyway', async () => {
    const r = room({ degraded: true });
    r.screen.setQuiet(true);
    expect(r.screen.model().visibility.degraded).toBe(true);
    expect((await r.screen.say('hoi')).ok).toBe(true);
  });

  it('answering stays open while hidden: the deliberate disclosure, to the asker alone', async () => {
    const r = room();
    r.screen.setQuiet(true);
    r.pushAsk({ id: 'ask-1', text: 'pomp?', tags: [], from: 'them', createdAt: T0, expiresAt: T0 + 60_000 });
    await flush();
    expect(await r.screen.answer('ask-1', 'ik heb er een')).toMatchObject({ ok: true, peer: 'them' });
    expect(r.sendAnswer).toHaveBeenCalledTimes(1);
    expect(r.broadcastKind).not.toHaveBeenCalled();
  });

  it('the refusals of a card and a circle, in both languages, plain', () => {
    expect(text(circleNl, 'circle.nearbyScreen.card_hidden')).toBe('Je bent verborgen. Je kaartje laat de ruimte weten dat je er bent: word eerst zichtbaar.');
    expect(text(circleEn, 'circle.nearbyScreen.card_hidden')).toBe('You are hidden. Your card tells the room you are here: become visible first.');
    expect(text(circleNl, 'circle.nearbyScreen.invite_hidden')).toBe('Je bent verborgen. Een kring aanbieden laat de ruimte weten dat je er bent: word eerst zichtbaar.');
    expect(text(circleEn, 'circle.nearbyScreen.invite_hidden')).toBe('You are hidden. Offering a circle tells the room you are here: become visible first.');
  });

  it('the refusal of a question, in both languages, plain', () => {
    expect(text(circleNl, 'circle.nearbyScreen.ask_hidden')).toBe('Je bent verborgen. Een vraag laat de ruimte weten dat je er bent: word eerst zichtbaar.');
    expect(text(circleEn, 'circle.nearbyScreen.ask_hidden')).toBe('You are hidden. A question tells the room you are here: become visible first.');
  });
});

describe('the "you here" line does not say you are in the conversation while hidden', () => {
  const visible = { visibility: { publishing: true } };
  const hidden = { visibility: { publishing: false, levelChosen: true }, quiet: true };

  it('in the chat and visible: "in the conversation"', () => {
    expect(nearbyMineSummary({ ...visible, allows: { chat: true, card: false } })).toEqual(['circle.nearbyScreen.mine_chat_on']);
  });

  it('hidden: nothing is shown to the room, whatever is switched on — the card is not said either', () => {
    expect(nearbyMineSummary({ ...hidden, allows: { chat: true, card: false } })).toEqual(['circle.nearbyScreen.mine_none']);
    expect(nearbyMineSummary({ ...hidden, allows: { chat: true, card: true } })).toEqual(['circle.nearbyScreen.mine_none']);
    expect(nearbyMineSummary({ ...hidden, allows: { chat: false, card: true } })).toEqual(['circle.nearbyScreen.mine_none']);
  });

  it('the card alone, or nothing', () => {
    expect(nearbyMineSummary({ ...visible, allows: { chat: false, card: true } })).toEqual(['circle.nearbyScreen.mine_card_on']);
    expect(nearbyMineSummary({ ...visible, allows: { chat: false, card: false } })).toEqual(['circle.nearbyScreen.mine_none']);
    expect(nearbyMineSummary({ ...visible, allows: { chat: true, card: true } })).toEqual(['circle.nearbyScreen.mine_card_on', 'circle.nearbyScreen.mine_chat_on']);
  });
});
