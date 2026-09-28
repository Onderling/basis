/**
 * THE KEYLESS CONTACT — a shape the contact type declares, not a risk readers tolerate.
 *
 * A person admitted through a door that carries no key (a Telegram user of a household bot) is a contact row with a
 * door-shaped id (`telegram:<uid>`), the door it came in by (`channel`), a role, and NO `pubKey`. The type names
 * that shape once (`KEYLESS_CONTACT_EXAMPLE`), and every reader of the book is tested over it in the package that
 * holds the reader (stoop's ContactBook, basis's projections): each works or refuses with a reason, none throws,
 * none invents a key.
 */
import { describe, it, expect } from 'vitest';
import {
  validate, schema,
  CHANNELS, isChannel, channelOfWebid, isKeylessContact, KEYLESS_CONTACT_EXAMPLE, KEYLESS_REFUSAL,
} from '../index.js';

describe('the contact type declares the keyless row', () => {
  it('validates with no pubKey, carrying a channel and a role', () => {
    expect(KEYLESS_CONTACT_EXAMPLE.pubKey).toBeUndefined();
    expect(KEYLESS_CONTACT_EXAMPLE).toMatchObject({ type: 'contact', channel: 'telegram', role: 'member' });
    expect(KEYLESS_CONTACT_EXAMPLE.webid).toBe(`telegram:${KEYLESS_CONTACT_EXAMPLE.webid.split(':')[1]}`);
    expect(validate(KEYLESS_CONTACT_EXAMPLE)).toEqual({ ok: true });
  });

  it('is one of the examples the schema itself carries', () => {
    expect(schema('contact').examples).toContainEqual(KEYLESS_CONTACT_EXAMPLE);
  });

  it('refuses a channel outside the closed set, and an empty role', () => {
    expect(validate({ ...KEYLESS_CONTACT_EXAMPLE, channel: 'sms' }).ok).toBe(false);
    expect(validate({ ...KEYLESS_CONTACT_EXAMPLE, role: '' }).ok).toBe(false);
  });
});

describe('the doors — one closed set', () => {
  it('is telegram · web · whatsapp, frozen', () => {
    expect([...CHANNELS]).toEqual(['telegram', 'web', 'whatsapp']);
    expect(Object.isFrozen(CHANNELS)).toBe(true);
    expect(isChannel('telegram')).toBe(true);
    expect(isChannel('sms')).toBe(false);
    expect(isChannel(null)).toBe(false);
  });

  it('reads the door off a door-shaped id, and nothing off any other id', () => {
    expect(channelOfWebid('telegram:4242')).toBe('telegram');
    expect(channelOfWebid('whatsapp:31612345678')).toBe('whatsapp');
    expect(channelOfWebid('telegram:')).toBe(null);
    expect(channelOfWebid('sms:4242')).toBe(null);
    expect(channelOfWebid('https://anne.pod/profile#me')).toBe(null);
    expect(channelOfWebid('b64keyAAAA')).toBe(null);
    expect(channelOfWebid(undefined)).toBe(null);
  });
});

describe('telling a keyless row from one with a key', () => {
  it('a row is keyless when it names a door and carries no key it can be sealed to or reached at', () => {
    expect(isKeylessContact(KEYLESS_CONTACT_EXAMPLE)).toBe(true);
    expect(isKeylessContact({ webid: 'telegram:1', pubKey: null, peerAddr: null, personKey: null })).toBe(true);
    expect(isKeylessContact({ webid: 'telegram:1' }), 'an id the book does not hold, asked by its shape').toBe(true);
    expect(isKeylessContact({ webid: 'x', channel: 'web' })).toBe(true);
    expect(isKeylessContact({ ...KEYLESS_CONTACT_EXAMPLE, peerAddr: 'a' })).toBe(false);
    expect(isKeylessContact({ ...KEYLESS_CONTACT_EXAMPLE, personKey: { version: 1, pubKey: 'p' } })).toBe(false);
    // a row with no door is never keyless: in the mesh binding its webid IS its key
    expect(isKeylessContact({ webid: 'w' })).toBe(false);
    expect(isKeylessContact({ webid: 'w', pubKey: 'k' })).toBe(false);
    expect(isKeylessContact(null)).toBe(false);
    // the same person later takes a Basis identity: the SAME row gains its key and is no longer keyless
    expect(isKeylessContact({ ...KEYLESS_CONTACT_EXAMPLE, pubKey: 'k' })).toBe(false);
  });

  it('names the refusal once', () => {
    expect(KEYLESS_REFUSAL).toBe('keyless-contact');
  });
});
