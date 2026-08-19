/**
 * Sender binding — the shared rule, on its own.
 *
 * Boundary authentication, decision 2 (2026-07-31). `senderVerdict` is the one place that decides
 * whether an envelope may claim the sender it claims; every boundary that can answer "who is this
 * connection authenticated to speak as?" plugs its own `authenticatedSender` port into it — nkn's
 * `msg.src` in `@onderling/transports`, the socket's registration set in `@onderling/relay`.
 *
 * These tests are about the RULE, not any transport: the three shapes a port may answer with, and the
 * fact that structural absence is announced rather than passed in silence. The transports' own halves
 * (nkn's prefix normalisation, the relay's registration set) are tested in their own packages.
 */
import { describe, it, expect, vi } from 'vitest';

import { senderVerdict, createSenderBinding } from '../../src/index.js';

const envelope = (from) => ({ _p: 'OW', _from: from, payload: { text: 'hoi' } });

describe('senderVerdict — one authenticated address', () => {
  it('binds when the claim matches', () => {
    const v = senderVerdict(null, envelope('anna'), () => 'anna');
    expect(v).toMatchObject({ ok: true, reason: 'bound', claimed: 'anna', authenticated: 'anna' });
  });

  it('refuses when claim and authenticated sender disagree', () => {
    const v = senderVerdict(null, envelope('bram'), () => 'anna');
    expect(v).toMatchObject({ ok: false, reason: 'sender-mismatch', claimed: 'bram', authenticated: 'anna' });
  });

  it('passes an envelope with no `_from` — there is no claim to disagree with', () => {
    const v = senderVerdict(null, { subtype: 'circle-chat-message' }, () => 'anna');
    expect(v).toMatchObject({ ok: true, reason: 'no-claimed-sender', claimed: null });
  });
});

describe('senderVerdict — a SET of authenticated addresses', () => {
  // One socket legitimately owns many addresses: a device presents a different address per circle.
  // Collapsing that to "the one address" is how a strict-looking check breaks working traffic.
  it('binds against any address the connection owns', () => {
    const owned = () => ['anna', 'anna@oosterpoort', 'anna@voetbalclub'];
    for (const from of owned()) {
      expect(senderVerdict(null, envelope(from), owned)).toMatchObject({ ok: true, reason: 'bound' });
    }
  });

  it('refuses an address the connection does not own', () => {
    const v = senderVerdict(null, envelope('carla'), () => ['anna', 'anna@oosterpoort']);
    expect(v).toMatchObject({ ok: false, reason: 'sender-mismatch' });
  });

  it('an EMPTY set is an answer, not an absence — "authenticated as nobody" refuses every claim', () => {
    // The distinction that keeps this from being vacuous: a socket that has registered nothing must
    // land in `sender-mismatch`, not slide through the unchecked `no-transport-sender` path.
    const v = senderVerdict(null, envelope('anna'), () => []);
    expect(v).toMatchObject({ ok: false, reason: 'sender-mismatch', authenticated: [] });
  });
});

describe('senderVerdict — the two absences', () => {
  it('a port that refuses this frame refuses it by its own reason', () => {
    const v = senderVerdict(null, envelope('anna'), () => ({ refuse: 'unencrypted-sender-unauthenticated' }));
    expect(v).toMatchObject({
      ok: false, reason: 'unencrypted-sender-unauthenticated', claimed: 'anna', authenticated: null,
    });
  });

  it('a port with nothing to offer passes the envelope UNCHECKED — a hole, named', () => {
    for (const answer of [null, undefined, '']) {
      expect(senderVerdict(null, envelope('anna'), () => answer))
        .toMatchObject({ ok: true, reason: 'no-transport-sender', authenticated: null });
    }
  });
});

describe('createSenderBinding — absence has to be loud', () => {
  it('announces an unauthenticated transport once, not once per frame', () => {
    const onUnauthenticated = vi.fn();
    const check = createSenderBinding({
      transportName: 'FakeTransport', authenticatedSender: () => null, onUnauthenticated,
    });

    check({}, envelope('anna'));
    check({}, envelope('bram'));
    check({}, envelope('carla'));

    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    expect(onUnauthenticated.mock.calls[0][0]).toContain('FakeTransport');
    expect(onUnauthenticated.mock.calls[0][0]).toContain('UNCHECKED');
  });

  it('says nothing when the transport DOES authenticate', () => {
    const onUnauthenticated = vi.fn();
    const check = createSenderBinding({
      transportName: 'FakeTransport', authenticatedSender: () => 'anna', onUnauthenticated,
    });

    expect(check({}, envelope('anna'))).toMatchObject({ ok: true, reason: 'bound' });
    expect(check({}, envelope('bram'))).toMatchObject({ ok: false, reason: 'sender-mismatch' });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('works without an `onUnauthenticated` callback at all', () => {
    const check = createSenderBinding({ transportName: 'FakeTransport', authenticatedSender: () => null });
    expect(check({}, envelope('anna'))).toMatchObject({ ok: true, reason: 'no-transport-sender' });
  });
});
