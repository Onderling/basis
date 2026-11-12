import { describe, it, expect } from 'vitest';
import {
  PERSON_ALLOWLIST, personAllowedBy, contactOriginOf, createInviteExchange, exchangeKindOf,
  INVITE_EXCHANGE_LIFETIME_MS, INVITE_EXCHANGE_MAX, sendDecisionFields,
  createHeldSends, HELD_SEND_MAX, HELD_SEND_LIFETIME_MS, createCircleAddressIndex,
} from '../../src/v2/peerSendGate.js';

describe('the person-key allowlist: data, one reason per entry, most specific first', () => {
  it('every entry has an id and a reason, and the address fallback is LAST', () => {
    expect(PERSON_ALLOWLIST.length).toBeGreaterThan(0);
    for (const e of PERSON_ALLOWLIST) {
      expect(typeof e.id).toBe('string');
      expect(e.reason.length, `${e.id} says why`).toBeGreaterThan(20);
      expect(typeof e.matches).toBe('function');
    }
    expect(PERSON_ALLOWLIST.at(-1).id).toBe('address-fallback');
    expect(Object.isFrozen(PERSON_ALLOWLIST)).toBe(true);
  });

  it('names the most specific entry, so the fallback never hides the real reason', () => {
    expect(personAllowedBy({ inviteExchange: 'joiner', contact: { webid: 'x' }, addressFallback: true }).allowedBy).toBe('invite-exchange');
    expect(personAllowedBy({ contact: { webid: 'x' }, addressFallback: true }).allowedBy).toBe('contact-card');
    expect(personAllowedBy({ addressFallback: true }).allowedBy).toBe('address-fallback');
    expect(personAllowedBy({}).allowedBy).toBe('none');
    expect(personAllowedBy(undefined).allowedBy).toBe('none');
  });

  it('a contact reached through the identity link (their other device) records card-via-device', () => {
    expect(personAllowedBy({ contact: { webid: 'x' }, viaDevice: true })).toEqual({ allowedBy: 'contact-card', origin: 'card-via-device' });
  });

  it('a view this self granted is allowed as granted, before a contact match, with its grant kind', () => {
    expect(personAllowedBy({ granted: 'view', contact: { webid: 'x' } })).toEqual({ allowedBy: 'granted', grantKind: 'view' });
    const ids = PERSON_ALLOWLIST.map((e) => e.id);
    expect(ids.indexOf('granted')).toBeLessThan(ids.indexOf('contact-card'));
  });

  it('a contact allow says WHERE the row came from', () => {
    expect(personAllowedBy({ contact: { webid: 'x', bot: true } })).toEqual({ allowedBy: 'contact-card', origin: 'bot' });
    expect(personAllowedBy({ inviteExchange: 'answer' })).toEqual({ allowedBy: 'invite-exchange', side: 'answer' });
  });
});

describe('contactOriginOf: where a book row came from, from the fields it carries', () => {
  it('bot, link, the pair roster, or a card/deliberate add (indistinguishable today)', () => {
    expect(contactOriginOf({ webid: 'a', bot: true })).toBe('bot');
    expect(contactOriginOf({ webid: 'a', linkedAt: 5 })).toBe('link');
    expect(contactOriginOf({ webid: 'a', linkedRow: 'r' })).toBe('link');
    expect(contactOriginOf({ webid: 'a', pairCircleId: 'pc' })).toBe('pair-roster');
    expect(contactOriginOf({ webid: 'a' })).toBe('card-or-add');
  });
});

describe('createInviteExchange: one redeem\'s two sends, bounded, never standing', () => {
  const clock = () => { let t = 1_000; return { now: () => t, tick: (ms) => { t += ms; } }; };

  it('the lifetime and the bound are params, not literals', () => {
    expect(INVITE_EXCHANGE_LIFETIME_MS).toBeGreaterThan(30_000);   // outlives the 30 s redeem timeout
    expect(INVITE_EXCHANGE_MAX).toBeGreaterThan(0);
  });

  it('JOINER: the invite\'s address matches for the redeem\'s lifetime, and not after its release', () => {
    const c = clock();
    const ix = createInviteExchange({ now: c.now });
    const release = ix.expectFromInviter('admin');
    expect(ix.take('admin', { kind: 'joiner' })).toBe('joiner');
    expect(ix.take('admin', { kind: 'joiner' }), 'a retry within the same redeem still matches').toBe('joiner');
    expect(ix.take('someone-else', { kind: 'joiner' })).toBe(null);
    release();
    expect(ix.take('admin', { kind: 'joiner' })).toBe(null);
  });

  it('JOINER: an entry nobody released ends at its lifetime', () => {
    const c = clock();
    const ix = createInviteExchange({ now: c.now, lifetimeMs: 100 });
    ix.expectFromInviter('admin');
    c.tick(101);
    expect(ix.take('admin', { kind: 'joiner' })).toBe(null);
  });

  it('INVITER: the answer to a proven request is consumed by the first reply; a second reply is none', () => {
    const ix = createInviteExchange({ now: clock().now });
    ix.answerProvenRequest('joiner-addr');
    expect(ix.take('joiner-addr', { kind: 'reply' })).toBe('answer');
    expect(ix.take('joiner-addr', { kind: 'reply' })).toBe(null);
  });

  it('INVITER: an answer never sent ends at its lifetime', () => {
    const c = clock();
    const ix = createInviteExchange({ now: c.now, lifetimeMs: 100 });
    ix.answerProvenRequest('j');
    c.tick(101);
    expect(ix.take('j', { kind: 'reply' })).toBe(null);
  });

  it('is bounded: past the bound the oldest entry goes', () => {
    const ix = createInviteExchange({ now: clock().now, max: 2 });
    ix.answerProvenRequest('a'); ix.answerProvenRequest('b'); ix.answerProvenRequest('c');
    expect(ix.take('a', { kind: 'reply' })).toBe(null);
    expect(ix.take('b', { kind: 'reply' })).toBe('answer');
    expect(ix.take('c', { kind: 'reply' })).toBe('answer');
  });

  it('JOINER: two redeems open at once to ONE inviter (two codes from one admin): the first answer does not close the second', () => {
    const ix = createInviteExchange({ now: clock().now });
    const releaseFirst = ix.expectFromInviter('admin');
    const releaseSecond = ix.expectFromInviter('admin');
    releaseFirst();
    expect(ix.take('admin', { kind: 'joiner' }), 'the second redeem is still open').toBe('joiner');
    releaseFirst();   // a release is idempotent: calling it twice does not close the other redeem
    expect(ix.take('admin', { kind: 'joiner' })).toBe('joiner');
    releaseSecond();
    expect(ix.take('admin', { kind: 'joiner' })).toBe(null);
  });

  it('INVITER: a well-formed request that did NOT prove its code earns one refusal reply, consumed once', () => {
    const ix = createInviteExchange({ now: clock().now });
    ix.refuseParsedRequest('joiner-addr');
    expect(ix.take('joiner-addr', { kind: 'reply' })).toBe('refusal');
    expect(ix.take('joiner-addr', { kind: 'reply' })).toBe(null);
  });

  it('INVITER: a request that proved its code turns its registration into the answer', () => {
    const ix = createInviteExchange({ now: clock().now });
    ix.refuseParsedRequest('joiner-addr');
    ix.answerProvenRequest('joiner-addr');
    expect(ix.take('joiner-addr', { kind: 'reply' })).toBe('answer');
    expect(ix.take('joiner-addr', { kind: 'reply' })).toBe(null);
  });

  it('an address that is both an inviter I am redeeming with and a joiner I answer keeps both', () => {
    const ix = createInviteExchange({ now: clock().now });
    const release = ix.expectFromInviter('peer');
    ix.answerProvenRequest('peer');
    expect(ix.take('peer', { kind: 'reply' })).toBe('answer');
    expect(ix.take('peer', { kind: 'joiner' })).toBe('joiner');
    release();
    expect(ix.take('peer', { kind: 'joiner' })).toBe(null);
  });

  it('PAIRING: a scanned pairing code opens one exchange to the scanned key, closed by its release', () => {
    const ix = createInviteExchange({ now: clock().now });
    const release = ix.expectPairing('scanned');
    expect(ix.take('scanned', { kind: 'pairing' })).toBe('pairing');
    release();
    expect(ix.take('scanned', { kind: 'pairing' })).toBe(null);
    expect(personAllowedBy({ inviteExchange: 'pairing' })).toEqual({ allowedBy: 'invite-exchange', side: 'pairing' });
  });

  it('refuses an empty address', () => {
    const ix = createInviteExchange({ now: clock().now });
    expect(() => ix.answerProvenRequest('')).not.toThrow();
    expect(ix.take('', { kind: 'reply' })).toBe(null);
  });
});

describe('the decision record carries allowedBy (codes only)', () => {
  it('a person send says which entry allowed it, and a contact allow its origin', () => {
    const f = sendDecisionFields({ kind: 'person', circleId: null, reason: 'no-roster-hit', allowedBy: 'contact-card', origin: 'pair-roster' });
    expect(f.allowedBy).toBe('contact-card');
    expect(f.origin).toBe('pair-roster');
    expect(sendDecisionFields({ kind: 'own-device', circleId: null, reason: 'device-map', allowedBy: 'own-device' }).allowedBy).toBe('own-device');
    expect(sendDecisionFields({ kind: 'circle-member', circleId: 'c', reason: 'roster-hit' }).allowedBy).toBeUndefined();
  });
});

describe('createInviteExchange: a send uses only the registration of ITS side (take by payload subtype)', () => {
  const clock = () => { let t = 1_000; return { now: () => t }; };
  it('the side is named by the payload: a redeem request, a redeem answer, a pairing request, or none', () => {
    expect(exchangeKindOf({ subtype: 'group-redeem-request' })).toBe('joiner');
    expect(exchangeKindOf({ subtype: 'group-redeem-response' })).toBe('reply');
    expect(exchangeKindOf({ __pairReq: { addr: 'x' } })).toBe('pairing');
    expect(exchangeKindOf({ subtype: 'contact-msg' })).toBe(null);
    expect(exchangeKindOf(null)).toBe(null);
  });
  it('an address that is BOTH (two devices inviting each other): the joiner\'s request does not use up the reply', () => {
    const ix = createInviteExchange({ now: clock().now });
    ix.expectFromInviter('peer');
    ix.answerProvenRequest('peer');
    expect(ix.take('peer', { kind: 'joiner' })).toBe('joiner');
    expect(ix.take('peer', { kind: 'reply' }), 'the reply registration is still there').toBe('answer');
    expect(ix.take('peer', { kind: 'reply' })).toBe(null);
  });
  it('a contact message to an address with an open redeem is NOT the exchange (it was recorded as joiner)', () => {
    const ix = createInviteExchange({ now: clock().now });
    ix.expectFromInviter('bot');
    ix.expectPairing('bot');
    expect(ix.take('bot', { kind: null })).toBe(null);
    expect(ix.take('bot')).toBe(null);
    expect(ix.take('bot', { kind: 'pairing' })).toBe('pairing');
  });
});

describe('createHeldSends: a person-key send with no reason waits, bounded, never standing', () => {
  it('the bound and the lifetime are params, not literals', () => {
    expect(HELD_SEND_MAX).toBeGreaterThan(0);
    expect(HELD_SEND_LIFETIME_MS).toBeGreaterThan(0);
  });

  it('takes what is held, and an entry put back keeps its first time', () => {
    let t = 1000;
    const h = createHeldSends({ now: () => t, lifetimeMs: 100, max: 4 });
    h.hold({ to: 'a', payload: { msgId: 'm1' }, opts: {} });
    expect(h.size).toBe(1);
    const [e] = h.take();
    expect(h.size).toBe(0);
    t = 1050; h.putBack(e);
    t = 1101;
    expect(h.take(), 'the put-back entry kept its first time and ended at its lifetime').toEqual([]);
  });

  it('an entry past its lifetime is dropped and reported', () => {
    let t = 0; const ended = [];
    const h = createHeldSends({ now: () => t, lifetimeMs: 10, max: 4, onEnded: (e, why) => ended.push([e.payload.msgId, why]) });
    h.hold({ to: 'a', payload: { msgId: 'm1' } });
    t = 11;
    expect(h.take()).toEqual([]);
    expect(ended).toEqual([['m1', 'expired']]);
  });

  it('is bounded: past the bound the oldest goes, reported', () => {
    const ended = [];
    const h = createHeldSends({ now: () => 0, lifetimeMs: 10, max: 2, onEnded: (e, why) => ended.push([e.payload.msgId, why]) });
    for (const id of ['m1', 'm2', 'm3']) h.hold({ to: 'a', payload: { msgId: id } });
    expect(h.size).toBe(2);
    expect(ended).toEqual([['m1', 'evicted']]);
  });
});

describe('a co-member\'s PERSON address is no reason to speak as the person', () => {
  it('there is no circle-member entry: a co-member is reached at their circle address, as my circle self', () => {
    expect(PERSON_ALLOWLIST.map((e) => e.id)).not.toContain('circle-member');
    expect(personAllowedBy({ circleMember: 'buren' })).toEqual({ allowedBy: 'none' });
  });
});
