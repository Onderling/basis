/**
 * The contact card's wire form — compact enough for a phone camera to read the QR it becomes.
 *
 * Frits 2026-09-26: a friend's camera could not read the "share my contact" QR. The card was base64url JSON whose
 * keys were themselves base64url strings (every key encoded twice), with empty fields written out and the address
 * repeating the id. The codec packs the same card in binary fields and must give back exactly what went in.
 */
import { describe, it, expect } from 'vitest';
import { encodeContactCard, decodeContactCard } from '../src/lib/contactCard.js';

const KEY = (c) => Buffer.alloc(32, c).toString('base64url');   // a 32-byte key, as the agent writes it
const REAL = {
  webid: KEY(1), pubKey: KEY(2), stableId: 'c_eKyns55717SbtEm9CWuA',
  handle: 'frits', displayName: 'Frits de Roos', avatarUrl: null, trustOffer: 'bekend',
  peerAddr: KEY(1), relays: ['wss://relay.test'],
  personKey: { version: 1, pubKey: KEY(3), linkKeyPub: KEY(4) },
};
const legacyLength = (card) => Buffer.from(JSON.stringify(card)).toString('base64url').length;
const clean = (card) => Object.fromEntries(Object.entries(card).filter(([, v]) => v !== null && v !== undefined));

describe('contact card codec', () => {
  it('round-trips a real card exactly (empty fields are simply absent)', () => {
    expect(decodeContactCard(encodeContactCard(REAL))).toEqual(clean(REAL));
  });

  it('is well under two thirds of the old base64 JSON', () => {
    const body = encodeContactCard(REAL);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.length).toBeLessThan(legacyLength(REAL) * 0.66);
  });

  it('keeps what does not fit the packed fields — a url webid, a named trust, a key chain, an unknown field', () => {
    const odd = {
      webid: 'https://pod.example/profile/card#me', pubKey: KEY(2), trustOffer: 'vertrouwd',
      peerAddr: 'nkn.abcdef', relays: ['wss://a.example', 'wss://b.example'],
      personKey: { version: 300, pubKey: KEY(3), linkKeyPub: KEY(4), extra: 'x' },
      personKeyLinks: [{ from: 1, to: 2, sig: 'abc' }], future: { a: 1 }, handle: 'ünïcødé ✓',
    };
    expect(decodeContactCard(encodeContactCard(odd))).toEqual(odd);
  });

  it('a card without a trust offer reads as the default, "bekend"', () => {
    const { trustOffer, ...rest } = REAL;
    expect(decodeContactCard(encodeContactCard(rest)).trustOffer).toBe('bekend');
  });

  it('refuses what is not a card: garbage, an old JSON body, a card without a webid', () => {
    expect(decodeContactCard('not base64!!')).toBeNull();
    expect(decodeContactCard(Buffer.from(JSON.stringify(REAL)).toString('base64url'))).toBeNull();
    expect(decodeContactCard(encodeContactCard({ pubKey: KEY(2) }))).toBeNull();
    expect(decodeContactCard('')).toBeNull();
    expect(decodeContactCard(null)).toBeNull();
  });
});

describe('a card may say it is a bot — for display only', () => {
  it('round-trips as one flag, costs two bytes, and is absent otherwise', () => {
    const base = { webid: 'Abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE', peerAddr: 'Abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE' };
    const plain = encodeContactCard(base);
    const bot = encodeContactCard({ ...base, bot: true });
    expect(decodeContactCard(bot).bot).toBe(true);
    expect(decodeContactCard(plain).bot).toBeUndefined();
    expect(bot.length - plain.length).toBeLessThanOrEqual(3);
    expect(bot).not.toMatch(/eyJ/);   // not the JSON catch-all
  });
});
