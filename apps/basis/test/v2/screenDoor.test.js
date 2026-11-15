/**
 * THE SCREEN DOOR AND THE APP'S PAIRING. One door (`screenDoor.js`) asks about a screen's offer for the bot and for the
 * person's own app: three codes, one pick, one try per offer, every refusal said with a code from the closed set. The
 * app's pairing (`appScreenPairing.js`) is the only path from a pasted or scanned offer to `grantSurface`, and it grants
 * nothing without the right pick. The offer itself holds nothing long-lived of the person (ruled 2026-11-13).
 */
import { describe, it, expect, vi } from 'vitest';
import { createScreenDoor, memoryUsedNonces, screenCode, SCREEN_PAIRING_TTL_MS, SCREEN_PAIRING_REFUSAL_CODES } from '../../src/v2/screenDoor.js';
import { createAppScreenPairing } from '../../src/v2/appScreenPairing.js';
import { encodePairingOffer, CONNECT_SCHEME } from '../../src/v2/connectionPairing.js';
import { REFUSAL_CODES } from '../../src/v2/refusalLog.js';
import { createScreenView } from '../../src/v2/screenView.js';
import { encodeScreenStartLink } from '../../src/v2/botScreens.js';

const slot = () => { let r = null; return { get: () => r, set: (_o, v) => { r = v; } }; };
const offerOf = (k = 'SCREEN-KEY', n = 'nonce-1', r = null) => encodePairingOffer({ viewPubKey: k, nonce: n, relayUrl: r, label: 'keuken' });

describe('the screen door', () => {
  it('its refusal codes are in the refusal log\'s closed set', () => {
    for (const c of SCREEN_PAIRING_REFUSAL_CODES) expect(REFUSAL_CODES, c).toContain(c);
  });

  it('refuses a non-offer, an offer for another relay, and a replayed nonce; each said', async () => {
    const said = [];
    let t = 1000;
    const door = createScreenDoor({ pending: slot(), used: memoryUsedNonces({ now: () => t }), relays: () => ['wss://mine.example'], note: (r) => said.push(r.reason), now: () => t });
    expect((await door.ask('o', { viewPubKey: '', nonce: 'x' })).reason).toBe('pairing-not-an-offer');
    expect((await door.ask('o', { viewPubKey: 'K', nonce: 'n', relayUrl: 'wss://other.example' })).reason).toBe('pairing-other-relay');
    const a = await door.ask('o', { viewPubKey: 'K', nonce: 'n', relayUrl: 'wss://mine.example/' });
    expect(a.ok).toBe(true);
    expect((await door.answer('o', await screenCode('K', 'n'))).ok).toBe(true);
    expect((await door.ask('o', { viewPubKey: 'K', nonce: 'n' })).reason, 'the same offer again').toBe('pairing-nonce-replayed');
    expect(said).toEqual(['pairing-not-an-offer', 'pairing-other-relay', 'pairing-nonce-replayed']);
  });

  it('one try per offer: a wrong pick drops it; a late pick is refused', async () => {
    let t = 0;
    const door = createScreenDoor({ pending: slot(), note: () => {}, now: () => t });
    const a = await door.ask('o', { viewPubKey: 'K', nonce: 'n1' });
    expect(a.codes).toHaveLength(3);
    expect(a.codes).toContain(await screenCode('K', 'n1'));
    const wrong = a.codes.find((c) => c !== a.code);
    expect((await door.answer('o', wrong)).reason).toBe('pairing-wrong-code');
    expect((await door.answer('o', a.code)).reason, 'gone after one try').toBe('pairing-nothing-pending');
    await door.ask('o', { viewPubKey: 'K', nonce: 'n2' });
    t += SCREEN_PAIRING_TTL_MS + 1;
    expect((await door.answer('o', await screenCode('K', 'n2'))).reason).toBe('pairing-expired');
  });
});

describe('the app\'s pairing: no grant without the right pick', () => {
  const make = () => { const grant = vi.fn(async () => ({ ok: true })); return { grant, p: createAppScreenPairing({ callSkill: (_app, _op, args) => grant(args), rand: () => 0.42 }) }; };

  it('ticks with no pick grant nothing; grantSurface is never called', async () => {
    const { grant, p } = make();
    expect((await p.offer(offerOf())).ok).toBe(true);
    expect(await p.grant({ ops: ['household.listOpenTasks'] })).toEqual({ ok: false, reason: 'pairing-no-pick' });
    expect(grant).not.toHaveBeenCalled();
  });

  it('a wrong pick grants nothing, and leaves no pick to grant with', async () => {
    const { grant, p } = make();
    const o = await p.offer(offerOf());
    const real = await screenCode('SCREEN-KEY', 'nonce-1');
    expect((await p.pick(o.codes.find((c) => c !== real))).reason).toBe('pairing-wrong-code');
    expect((await p.grant({ ops: ['household.listOpenTasks'] })).reason).toBe('pairing-no-pick');
    expect(grant).not.toHaveBeenCalled();
  });

  it('the right pick releases ONE grant, with the offer\'s key and nonce', async () => {
    const { grant, p } = make();
    await p.offer(offerOf());
    expect((await p.pick(await screenCode('SCREEN-KEY', 'nonce-1'))).ok).toBe(true);
    expect((await p.grant({ ops: ['household.listOpenTasks'] })).ok).toBe(true);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant.mock.calls[0][0]).toMatchObject({ viewPubKey: 'SCREEN-KEY', nonce: 'nonce-1', ops: ['household.listOpenTasks'] });
    expect((await p.grant({ ops: ['household.listOpenTasks'] })).reason, 'one grant per pick').toBe('pairing-no-pick');
    expect((await p.offer(offerOf())).reason, 'the same offer again').toBe('pairing-nonce-replayed');
  });

  it('a text that is not an offer says why (the parse\'s reason)', async () => {
    const { p } = make();
    expect((await p.offer('hello')).reason).toBe('not-a-connect-uri');
  });
});

describe('the offer holds nothing long-lived of the person', () => {
  it('a screen\'s offer carries only its own key, its relay, a fresh nonce and a label', async () => {
    const PERSON = 'PERSON-CHAT-KEY';
    const BOT = 'BOT-ADDRESS';
    const view = createScreenView({
      link: encodeScreenStartLink('https://app.example', { botAddress: BOT, relayUrl: 'wss://relay.example' }),
      makeAgent: async () => ({ agent: { pubKey: 'SCREEN-OWN-KEY' }, relay: { connect: async () => {} }, peer: { sendTo: async () => {} } }),
      storage: { getItem: () => null, setItem: () => {} },
      setTimer: () => null, clearTimer: () => {},
    });
    const { offer } = await view.connect({ label: 'keuken' });
    expect(offer.startsWith(CONNECT_SCHEME)).toBe(true);
    const body = JSON.parse(Buffer.from(offer.slice(CONNECT_SCHEME.length).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(Object.keys(body).sort()).toEqual(['k', 'l', 'n', 'r', 'v']);
    expect(body.k, 'the screen\'s own key').toBe('SCREEN-OWN-KEY');
    expect(Object.values(body)).not.toContain(PERSON);
    expect(Object.values(body), 'no address of the bot or the person rides the offer').not.toContain(BOT);
    view.stop?.();
  });
});
