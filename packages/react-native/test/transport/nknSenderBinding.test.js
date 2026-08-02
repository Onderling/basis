/**
 * Sender binding on the NKN transport — an envelope may not claim a sender the transport did not
 * authenticate.
 *
 * Boundary authentication, decision 2 (2026-07-31). The inbound handler used to parse `msg.payload` and
 * hand the envelope straight to `_receive`, discarding `msg.src` — the one sender fact nkn actually
 * authenticates. `_from` is free text; a signature proves someone holds A key, never that the key belongs
 * at the address the envelope names.
 *
 * The comparison here is a REAL one, not a type error dressed as a check: over nkn, `_from` is stamped by
 * the base `Transport` from `this.address`, which `#tryConnect` sets to `client.addr` — an nkn native
 * address, the same namespace `src` is in. (The divergence recorded in `createSecureAgent` is a different
 * pair — nkn address vs. canonical chat pubKey — and nothing here compares those.)
 *
 * The rule itself now lives once, outside this package: the transport-agnostic verdict in
 * `@onderling/core` (`transport/senderBinding.js`) and nkn's `authenticatedSender` port — the sub-client
 * normalisation, the encrypted-only guarantee — in `@onderling/transports` (`nknSenderBinding.js`), which
 * the web/Node NKN adapter uses too. So what this file tests is this ADAPTER's inbound path; the rule's
 * own cases are tested in those two packages, and the first test below guards that they are the same
 * code rather than two copies that can drift apart.
 *
 * The nkn lib is fully mocked, as in `NknTransport.test.js`; no network traffic is generated.
 */
import { describe, it, expect, vi } from 'vitest';

import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { NknTransport, nknSenderVerdict } from '../../src/transport/NknTransport.js';

// ── Mock factory (same shape as NknTransport.test.js) ────────────────────────────────────────────

function makeFakeNkn({ addr = 'nkn-self-addr' } = {}) {
  const handle = { current: null };

  class FakeClient {
    constructor(opts) {
      this.opts      = opts;
      this.addr      = addr;
      this._handlers = new Map();
      this.sentMessages = [];
      this.sendImpl  = vi.fn(async () => undefined);
      this.closed    = false;
      handle.current = this;
      queueMicrotask(() => this._emit('connect'));
    }
    on(event, fn) {
      if (!this._handlers.has(event)) this._handlers.set(event, new Set());
      this._handlers.get(event).add(fn);
      return this;
    }
    _emit(event, payload) {
      for (const fn of [...(this._handlers.get(event) ?? [])]) fn(payload);
    }
    async send(to, payload, opts) {
      this.sentMessages.push({ to, payload, opts });
      return this.sendImpl(to, payload, opts);
    }
    close() { this.closed = true; }
  }

  return { lib: { Client: FakeClient, MultiClient: FakeClient }, handle };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function envelopeFrom(from, to = 'nkn-self-addr') {
  return {
    _v: 1, _p: 'OW', _id: `env-${Math.random().toString(36).slice(2)}`, _re: null,
    _from: from, _to: to, _topic: null, _ts: Date.now(), _sig: null,
    payload: { kind: 'ping' },
  };
}

/** Connect a transport over the fake lib and collect what actually reaches the app layer. */
async function connected() {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const { lib, handle } = makeFakeNkn();
  const t = new NknTransport({ identity, nknLib: lib });
  const received = [];
  const warnings = [];
  t.on('warn', (w) => warnings.push(String(w)));
  await t.connect();
  t.setReceiveHandler((env) => received.push(env));
  return { t, handle, received, warnings };
}

// ── The rule is the SAME object the web adapter uses ─────────────────────────────────────────────

describe('nknSenderVerdict — one rule, both adapters', () => {
  it('is literally the function `@onderling/transports` exports, not a mobile copy of it', async () => {
    // web ≡ mobile by construction (invariants 2 + 3). The rule's own cases — sub-client prefix,
    // unencrypted refusal, missing `src`, missing `_from` — are tested where the code lives
    // (`packages/transports/test/nknSenderBinding.test.js`), and the shared verdict underneath it in
    // `packages/core/test/transport/senderBinding.test.js`. Duplicating them here would be exactly the
    // drift this asserts against. What is tested BELOW is this adapter's own inbound path.
    const shared = await import('@onderling/transports');
    expect(nknSenderVerdict).toBe(shared.nknSenderVerdict);
  });
});

// ── The transport's inbound path ─────────────────────────────────────────────────────────────────

describe('NknTransport inbound sender binding', () => {
  it('delivers an envelope whose claim matches the transport-authenticated sender', async () => {
    const { handle, received } = await connected();
    handle.current._emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]._from).toBe('peer-A');
  });

  it('does NOT deliver an envelope claiming a sender nkn did not authenticate', async () => {
    const { handle, received, warnings } = await connected();
    handle.current._emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-B')),
    });
    await flush();
    expect(received).toHaveLength(0);
    expect(warnings.join(' ')).toContain('sender-mismatch');
  });

  it('keeps working after a dropped envelope — one bad frame is not a poisoned transport', async () => {
    const { handle, received } = await connected();
    handle.current._emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-B')),
    });
    handle.current._emit('message', {
      src: 'peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]._from).toBe('peer-A');
  });

  it('does not deliver an unencrypted frame even when its claim agrees with `src`', async () => {
    const { handle, received, warnings } = await connected();
    handle.current._emit('message', {
      src: 'peer-A', isEncrypted: false, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(0);
    expect(warnings.join(' ')).toContain('unencrypted');
  });

  it('a legitimate multiclient sub-client address still lands', async () => {
    const { handle, received } = await connected();
    handle.current._emit('message', {
      src: '__2__.peer-A', isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')),
    });
    await flush();
    expect(received).toHaveLength(1);
  });
});

describe('NknTransport announces an unauthenticated transport', () => {
  it('warns ONCE when nkn hands us no `src` at all — the hole is named, not hidden', async () => {
    // Structural absence has to be loud: an unchecked receive path otherwise reads exactly like a
    // checked one. The envelopes still flow (dropping them would break every mock and any lib that does
    // not report a sender) — but the log says they were not checked.
    const { handle, received, warnings } = await connected();
    handle.current._emit('message', { isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-A')) });
    handle.current._emit('message', { isEncrypted: true, payload: JSON.stringify(envelopeFrom('peer-B')) });
    await flush();

    expect(received).toHaveLength(2);
    const announcements = warnings.filter((w) => w.includes('UNCHECKED'));
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toContain('NknTransport');
  });
});
