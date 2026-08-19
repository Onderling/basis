/**
 * Sender binding on the NKN transports — an envelope may not claim a sender the transport did not
 * authenticate.
 *
 * Boundary authentication, decision 2 (2026-07-31). This file covers two things:
 *
 *   1. **nkn's `authenticatedSender` port** — the sub-client normalisation and the encrypted-only
 *      guarantee. These live here (not in the kernel) because they are nkn trivia; the RULE they feed
 *      is `senderVerdict` in `@onderling/core`, tested on its own in `core/test/transport/`.
 *   2. **the web/Node adapter's inbound path** (`src/NknTransport.js`) — which until 2026-07-31 parsed
 *      `msg.payload` and handed the envelope straight to `_receive`, discarding `msg.src`, the one
 *      sender fact nkn actually authenticates. The react-native adapter had already been bound; this
 *      one had not, and web ≡ mobile is an invariant, not a nice-to-have.
 *
 * The two facts that stop this being vacuous, and that these tests pin:
 *   • a single-`Client` receiver is handed a `__N__.`-PREFIXED `src` (a MultiClient receiver is not),
 *     and this adapter falls back to single Client automatically on a MultiClient connect timeout —
 *     so un-normalised comparison would reject legitimate traffic;
 *   • nkn only authenticates `src` on ENCRYPTED frames, so an unencrypted frame is dropped rather than
 *     "checked" — otherwise an attacker sets `src` to match `_from` and the check agrees with itself.
 *
 * The nkn lib is fully mocked; no network traffic is generated.
 */
import { describe, it, expect } from 'vitest';

import { NknTransport, nknSenderVerdict, nknAuthenticatedSender, stripSubClientPrefix } from '../src/index.js';

const identity = { pubKeyBytes: new Uint8Array([1, 2, 3, 4]) };
const SELF = 'self-addr.abc123';

function envelopeFrom(from, to = SELF) {
  return {
    _v: 1, _p: 'OW', _id: `env-${Math.random().toString(36).slice(2)}`,
    _from: from, _to: to, _ts: Date.now(), _sig: null, payload: { kind: 'ping' },
  };
}

/**
 * Fake nkn lib. `withMultiClient: false` leaves the module exposing only `Client`, which is the shape
 * that hands a receiver an un-normalised, prefixed `src`.
 */
function fakeNknLib({ withMultiClient = true } = {}) {
  const handle = { current: null };
  class FakeClient {
    constructor(opts) {
      this.opts = opts;
      this.addr = SELF;
      this._h   = {};
      handle.current = this;
    }
    on(evt, cb) { this._h[evt] = cb; if (evt === 'connect') setTimeout(() => cb(), 0); }
    emit(evt, payload) { this._h[evt]?.(payload); }
    async send() {}
    close() {}
  }
  const lib = withMultiClient ? { Client: FakeClient, MultiClient: FakeClient } : { Client: FakeClient };
  return { lib, handle };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Connect the web/Node adapter over the fake lib and collect what actually reaches the app layer. */
async function connected(libOpts) {
  const { lib, handle } = fakeNknLib(libOpts);
  const t = new NknTransport({ identity, nknLib: lib });
  const received = [];
  const warnings = [];
  t.on('warn', (w) => warnings.push(String(w)));
  await t.connect();
  t.setReceiveHandler((env) => received.push(env));
  return { t, handle, received, warnings };
}

// ── nkn's port ───────────────────────────────────────────────────────────────────────────────────

describe('nknAuthenticatedSender', () => {
  it('answers with the address nkn authenticated', () => {
    expect(nknAuthenticatedSender({ src: 'peer-A', isEncrypted: true })).toBe('peer-A');
  });

  it('strips the multiclient `__N__.` sub-client prefix — a single `Client` receiver is handed it raw', () => {
    expect(nknAuthenticatedSender({ src: '__3__.alice.abc123', isEncrypted: true })).toBe('alice.abc123');
    expect(stripSubClientPrefix('__0__.a.b')).toBe('a.b');
  });

  it('does not strip something that merely LOOKS like a prefix', () => {
    // Same regex nkn uses (`multiclient/consts.js`: /^__\d+__$/). Loosening it would let an attacker
    // pick a prefix that normalises their address into someone else's.
    expect(nknAuthenticatedSender({ src: '__x__.alice', isEncrypted: true })).toBe('__x__.alice');
  });

  it('REFUSES an unencrypted frame — nkn does not authenticate `src` on those', () => {
    expect(nknAuthenticatedSender({ src: 'peer-A', isEncrypted: false }))
      .toEqual({ refuse: 'unencrypted-sender-unauthenticated' });
  });

  it('treats a MISSING `isEncrypted` as "a client that does not report it", not as unencrypted', () => {
    // nkn always sets the flag; `undefined` means a mock or an unknown lib. The attacker-reachable
    // value is `false`, and only that one refuses.
    expect(nknAuthenticatedSender({ src: 'peer-A' })).toBe('peer-A');
  });

  it('answers `null` when there is no `src` at all — a hole, announced by the shared rule, not a pass', () => {
    expect(nknAuthenticatedSender({ isEncrypted: true })).toBe(null);
  });
});

describe('nknSenderVerdict — the shared rule with nkn’s port', () => {
  it('binds when the claim matches the address nkn authenticated', () => {
    expect(nknSenderVerdict({ src: 'peer-A', isEncrypted: true }, envelopeFrom('peer-A')))
      .toMatchObject({ ok: true, reason: 'bound' });
  });

  it('refuses when the claim and the authenticated sender disagree', () => {
    expect(nknSenderVerdict({ src: 'peer-A', isEncrypted: true }, envelopeFrom('peer-B')))
      .toMatchObject({ ok: false, reason: 'sender-mismatch', claimed: 'peer-B', authenticated: 'peer-A' });
  });

  it('a prefixed sub-client address still binds against the base address it claims', () => {
    expect(nknSenderVerdict({ src: '__2__.peer-A', isEncrypted: true }, envelopeFrom('peer-A')))
      .toMatchObject({ ok: true, reason: 'bound', authenticated: 'peer-A' });
  });

  it('refuses an unencrypted frame even when its claim agrees with `src`', () => {
    expect(nknSenderVerdict({ src: 'peer-A', isEncrypted: false }, envelopeFrom('peer-A')))
      .toMatchObject({ ok: false, reason: 'unencrypted-sender-unauthenticated' });
  });

  it('passes an envelope with no `_from` — there is no claim to disagree with', () => {
    expect(nknSenderVerdict({ src: 'peer-A', isEncrypted: true }, { subtype: 'circle-chat-message' }))
      .toMatchObject({ ok: true, reason: 'no-claimed-sender' });
  });
});

// ── the web/Node adapter's inbound path ──────────────────────────────────────────────────────────

describe('NknTransport (web/Node) inbound sender binding', () => {
  it('delivers an envelope whose claim matches the transport-authenticated sender', async () => {
    const { handle, received } = await connected();
    handle.current.emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]._from).toBe('peer-A');
  });

  it('does NOT deliver an envelope claiming a sender nkn did not authenticate', async () => {
    const { handle, received, warnings } = await connected();
    handle.current.emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-B')),
    });
    await flush();
    expect(received).toHaveLength(0);
    expect(warnings.join(' ')).toContain('sender-mismatch');
  });

  it('does not deliver an unencrypted frame even when its claim agrees with `src`', async () => {
    const { handle, received, warnings } = await connected();
    handle.current.emit('message', {
      src: 'peer-A', isEncrypted: false, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(0);
    expect(warnings.join(' ')).toContain('unencrypted');
  });

  it('keeps working after a dropped envelope — one bad frame is not a poisoned transport', async () => {
    const { handle, received } = await connected();
    handle.current.emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-B')),
    });
    handle.current.emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]._from).toBe('peer-A');
  });

  it('a legitimate sub-client address still lands on the single-`Client` path', async () => {
    // The fallback path this adapter takes automatically when MultiClient times out. Its receiver is
    // handed the `__N__.` prefix raw, so this is the case the normalisation exists for.
    const { handle, received } = await connected({ withMultiClient: false });
    handle.current.emit('message', {
      src: '__2__.peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(1);
  });

  it('announces ONCE when nkn hands us no authenticated sender at all', async () => {
    // Loud absence: a receive path that cannot check must say so, or it reads exactly like one that does.
    const { handle, received, warnings } = await connected();
    handle.current.emit('message', { isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')) });
    handle.current.emit('message', { isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-B')) });
    await flush();
    expect(received).toHaveLength(2);                                   // delivered, unchecked
    const announcements = warnings.filter((w) => w.includes('UNCHECKED'));
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toContain('NknTransport');
  });
});
