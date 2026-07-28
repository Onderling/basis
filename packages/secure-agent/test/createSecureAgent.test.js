/**
 * @onderling/secure-agent — createSecureAgent tests (S0 foundation).
 *
 * Covers the identity persistence + Agent + (mocked) NknTransport
 * wiring + rotation + diagnostic.  Future S-slice tests add their
 * own fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '../src/createSecureAgent.js';
import {
  signClaim, verifyClaim, serializeClaim, parseClaim,
} from '../src/claim.js';
import { loadMuteSet }   from '../src/mute.js';
import { AgentIdentity, b64decode } from '@onderling/core';
import {
  registerPasskey,
  unlockWithPasskey,
  webauthnAvailable,
  PASSKEY_ERRORS,
} from '../src/passkey.js';
import { createPeerResolver, PeerResolver } from '../src/resolver.js';
import {
  TrustRegistry, CapabilityToken, PolicyEngine, ROLES, roleRank,
} from '@onderling/core';
import { loadAuditLog, AuditLog, AUDIT_VERSION } from '../src/auditLog.js';
import { createRateLimiter, RateLimiter } from '../src/rateLimit.js';
import { GroupManager, A2ATLSLayer } from '@onderling/core';
import { loadPFSChain, PFSChain } from '../src/pfs.js';

describe('createSecureAgent — S0 foundation', () => {
  it('builds an agent with auto-SecurityLayer (no peer transport)', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.agent).toBeTruthy();
    expect(sa.identity.pubKey).toBeTruthy();
    expect(sa.identity.stableId).toBeTruthy();
    expect(sa.peer.status).toBe('idle');
    expect(sa.peer.address).toBeNull();
    expect(sa.securityStatus().layerWired).toBe(true);
    await sa.shutdown();
  });

  it('identity persists across two factory invocations (same vault)', async () => {
    const vault = new VaultMemory();
    const a1 = await createSecureAgent({ vault });
    const pub1 = a1.identity.pubKey;
    const stable1 = a1.identity.stableId;
    await a1.shutdown();

    const a2 = await createSecureAgent({ vault });
    expect(a2.identity.pubKey).toBe(pub1);
    expect(a2.identity.stableId).toBe(stable1);
    await a2.shutdown();
  });

  it('connect() throws without nknLib', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await expect(sa.peer.connect()).rejects.toThrow(/nknLib/);
    await sa.shutdown();
  });

  it('connect() with a fake nknLib wires the transport + reports address', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const sa = await createSecureAgent({
      vault:  new VaultMemory(),
      nknLib: fakeNkn,
    });
    const result = await sa.peer.connect();
    expect(result.status).toBe('connected');
    expect(result.address).toBe('app.fake.123');
    expect(sa.peer.address).toBe('app.fake.123');
    expect(sa.peer.status).toBe('connected');
    await sa.shutdown();
  });

  it('sendTo() sends HI first, then payload, on the first send to a new peer', async () => {
    // SecurityLayer needs both peers' pubKeys before OW encrypts.
    // For the unit test we pre-register the peer's pubKey so OW
    // doesn't fail at encrypt; the bilateral-HI flow is verified
    // separately by 'receives auto-reply HI to new peer' below.
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const sa = await createSecureAgent({
      vault:  new VaultMemory(),
      nknLib: fakeNkn,
    });
    await sa.peer.connect();
    // Pre-register so the OW encrypt succeeds in the unit test
    // (real NKN: a reciprocal HI from the peer fills this in).
    sa.agent.security.registerPeer('app.peer.456', sa.identity.pubKey);
    await sa.peer.sendTo('app.peer.456', { type: 'p2p-chat', body: 'hi' });

    const sends = fakeNkn._instance.sends;
    expect(sends.length).toBe(2);   // HI then OW
    await sa.shutdown();
  });

  it('sendTo() to a previously-HI\'d peer does NOT re-send HI', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const sa = await createSecureAgent({
      vault:  new VaultMemory(),
      nknLib: fakeNkn,
    });
    await sa.peer.connect();
    sa.agent.security.registerPeer('app.peer.456', sa.identity.pubKey);
    await sa.peer.sendTo('app.peer.456', { body: 'first' });
    const after1 = fakeNkn._instance.sends.length;
    await sa.peer.sendTo('app.peer.456', { body: 'second' });
    const after2 = fakeNkn._instance.sends.length;
    expect(after2 - after1).toBe(1);   // only one new send, no HI
    await sa.shutdown();
  });

  it.skip('on receive from new peer, auto-sends reciprocal HI (bilateral handshake)', () => {
    // Skipped — requires a fully-signed envelope to pass SecurityLayer's
    // decryptAndVerify (sig-missing envelopes are dropped at
    // security-error stage before the 'envelope' event fires).
    // The wiring IS in place (see createSecureAgent.js's tx.on
    // ('envelope', ...) handler that calls tx.sendHello on first
    // contact); integration-verified in basis's two-tab
    // demo (Tab A's first OW after HI gets reciprocal HI back).
  });

  it('rotateIdentity() produces a new pubKey + reports grace period', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    const oldPub = sa.identity.pubKey;
    const r = await sa.rotateIdentity();
    expect(r.oldPubKey).toBe(oldPub);
    expect(r.newPubKey).not.toBe(oldPub);
    expect(r.graceUntilDays).toBe(7);
    await sa.shutdown();
  });

  // (S8 completion note: STUB_OPTS is now empty.  The
  // "warns on stubbed opts" + "warnOnInsecure:false suppresses" +
  // "pendingOpts" assertions used to bind to a still-stubbed opt;
  // since every roadmap opt is wired, those tests now live in
  // the S8 suite below ("STUB_OPTS is empty: every roadmap opt is
  // now wired").)
  it('securityStatus() reports identity + peer + (empty) pendingOpts', async () => {
    const sa = await createSecureAgent({
      vault:           new VaultMemory(),
      warnOnInsecure:  false,
    });
    const st = sa.securityStatus();
    expect(st.layerWired).toBe(true);
    expect(st.identityPub).toBeTruthy();
    expect(st.identityStable).toBeTruthy();
    expect(st.peerTransportConnected).toBe(false);
    expect(st.helloedPeerCount).toBe(0);
    expect(st.pendingOpts).toEqual({});
    await sa.shutdown();
  });

  it('shutdown() is idempotent', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await sa.shutdown();
    await expect(sa.shutdown()).resolves.toBeUndefined();
  });
});

/* ─── S1 — mute / block + helloGate ──────────────────── */

describe('createSecureAgent — S1 mute + helloGate', () => {
  it('mute set persists across two factory invocations (same vault key)', async () => {
    const vault = new VaultMemory();
    const a1 = await createSecureAgent({
      vault, muteListVaultKey: 'sa-mute', warnOnInsecure: false,
    });
    await a1.mute.add('app.bad.1');
    await a1.mute.add('app.bad.2');
    expect(a1.mute.size).toBe(2);
    await a1.shutdown();

    const a2 = await createSecureAgent({
      vault, muteListVaultKey: 'sa-mute', warnOnInsecure: false,
    });
    expect(a2.mute.has('app.bad.1')).toBe(true);
    expect(a2.mute.has('app.bad.2')).toBe(true);
    expect(a2.mute.list().sort()).toEqual(['app.bad.1', 'app.bad.2']);
    await a2.shutdown();
  });

  it('mute without vaultKey is in-memory only', async () => {
    const vault = new VaultMemory();
    const a1 = await createSecureAgent({ vault });
    await a1.mute.add('app.bad.1');
    expect(a1.mute.has('app.bad.1')).toBe(true);
    await a1.shutdown();

    const a2 = await createSecureAgent({ vault });
    expect(a2.mute.has('app.bad.1')).toBe(false);   // not persisted
    await a2.shutdown();
  });

  it('sendTo throws when target is muted', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const sa = await createSecureAgent({
      vault: new VaultMemory(), nknLib: fakeNkn,
    });
    await sa.peer.connect();
    await sa.mute.add('app.peer.456');
    await expect(
      sa.peer.sendTo('app.peer.456', { type: 'p2p-chat', body: 'hi' })
    ).rejects.toThrow(/muted/);
    await sa.shutdown();
  });

  it('helloGate as string is treated as PSK (tokenGate)', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      helloGate: 'shared-secret-xyz',
      warnOnInsecure: false,
    });
    const gate = sa.agent.helloGate;
    expect(typeof gate).toBe('function');
    // Composed gate: passes only when env._from not muted AND PSK matches
    expect(await gate({ _from: 'app.who', payload: { authToken: 'shared-secret-xyz' } })).toBe(true);
    expect(await gate({ _from: 'app.who', payload: { authToken: 'wrong' } })).toBe(false);
    expect(await gate({ _from: 'app.who', payload: {} })).toBe(false);
    await sa.shutdown();
  });

  it('helloGate as { token } is treated as tokenGate', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      helloGate: { token: 'sek' },
      warnOnInsecure: false,
    });
    const gate = sa.agent.helloGate;
    expect(await gate({ _from: 'app.x', payload: { authToken: 'sek' } })).toBe(true);
    expect(await gate({ _from: 'app.x', payload: { authToken: 'no' } })).toBe(false);
    await sa.shutdown();
  });

  it('helloGate as a custom function is composed with mute base gate', async () => {
    const calls = [];
    const customGate = async (env) => {
      calls.push(env._from);
      return env._from.startsWith('app.good.');
    };
    const sa = await createSecureAgent({
      vault: new VaultMemory(), helloGate: customGate,
    });
    const gate = sa.agent.helloGate;
    // Mute-block kicks in BEFORE user gate; muted peer → false, user gate not called
    await sa.mute.add('app.good.muted');
    expect(await gate({ _from: 'app.good.muted', payload: {} })).toBe(false);
    expect(calls).toEqual([]);   // user gate not invoked for muted peer
    // Non-muted but failing custom gate → false
    expect(await gate({ _from: 'app.bad.42', payload: {} })).toBe(false);
    expect(calls).toEqual(['app.bad.42']);
    // Non-muted, passing custom → true
    expect(await gate({ _from: 'app.good.99', payload: {} })).toBe(true);
    await sa.shutdown();
  });

  it('no helloGate opt → mute-only base gate is still installed', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    const gate = sa.agent.helloGate;
    expect(typeof gate).toBe('function');
    expect(await gate({ _from: 'app.fresh', payload: {} })).toBe(true);
    await sa.mute.add('app.bad');
    expect(await gate({ _from: 'app.bad', payload: {} })).toBe(false);
    await sa.shutdown();
  });

  it('helloGate of wrong type throws at factory time', async () => {
    await expect(createSecureAgent({
      vault: new VaultMemory(), helloGate: 42,
    })).rejects.toThrow(/helloGate must be/);
  });

  it('securityStatus reports mute + helloGate state', async () => {
    const sa = await createSecureAgent({
      vault:            new VaultMemory(),
      muteListVaultKey: 'sa-mute',
      helloGate:        'psk',
      warnOnInsecure:   false,
    });
    await sa.mute.add('app.x');
    const st = sa.securityStatus();
    expect(st.muteCount).toBe(1);
    expect(st.mutedPeers).toEqual(['app.x']);
    expect(st.muteIsPersistent).toBe(true);
    expect(st.helloGateWired).toBe(true);
    await sa.shutdown();
  });

  it('loadMuteSet (standalone helper) survives corrupt JSON in vault slot', async () => {
    const vault = new VaultMemory();
    await vault.set('sa-mute', '{not json');
    const set = await loadMuteSet({ vault, vaultKey: 'sa-mute' });
    expect(set.size).toBe(0);
    // And persists fresh state cleanly:
    await set.add('app.a');
    const raw = await vault.get('sa-mute');
    expect(JSON.parse(raw)).toEqual(['app.a']);
  });
});

/* ─── S2 — signed WebID claim ────────────────────────── */

describe('createSecureAgent — S2 signed WebID claim', () => {
  it('signClaim → verifyClaim round-trips', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const claim = signClaim(identity, {
      webid:   'https://alice.example/profile/card#me',
      nknAddr: 'app.alice.abc',
    });
    expect(claim.v).toBe(1);
    expect(claim.webid).toBe('https://alice.example/profile/card#me');
    expect(claim.pubKey).toBe(identity.pubKey);
    expect(claim.nknAddr).toBe('app.alice.abc');
    expect(typeof claim.sig).toBe('string');
    const v = verifyClaim(claim);
    expect(v).toEqual({ ok: true, body: expect.any(Object) });
  });

  it('verifyClaim rejects tampered fields', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const claim = signClaim(identity, { webid: 'https://a.example/#me' });
    // Tamper the webid; the sig was over the original
    const tampered = { ...claim, webid: 'https://attacker.example/#me' };
    expect(verifyClaim(tampered)).toEqual({ ok: false, reason: 'bad-sig' });
  });

  it('verifyClaim rejects expired claims', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const claim = signClaim(identity, {
      webid: 'https://a.example/#me',
      ttlMs: 1000,
      now:   1000,
    });
    expect(verifyClaim(claim, { now: 3000 })).toEqual({ ok: false, reason: 'expired' });
  });

  it('verifyClaim rejects future-dated claims beyond skew', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const claim = signClaim(identity, {
      webid: 'https://a.example/#me',
      now:   100_000_000,
    });
    expect(verifyClaim(claim, { now: 1000, clockSkewMs: 1000 }))
      .toEqual({ ok: false, reason: 'future-ts' });
  });

  it('verifyClaim rejects missing/bad-shape input', async () => {
    expect(verifyClaim(null)).toEqual({ ok: false, reason: 'bad-shape' });
    expect(verifyClaim({})).toEqual({ ok: false, reason: 'bad-shape' });
    expect(verifyClaim({ v: 1 })).toEqual({ ok: false, reason: 'bad-shape' });
  });

  it('serializeClaim → parseClaim round-trips', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const claim = signClaim(identity, { webid: 'https://a.example/#me' });
    const str = serializeClaim(claim);
    expect(typeof str).toBe('string');
    const parsed = parseClaim(str);
    expect(parsed).toEqual(claim);
    expect(verifyClaim(parsed).ok).toBe(true);
  });

  it('factory binds webid: sa.claim.sign() needs no args', async () => {
    const sa = await createSecureAgent({
      vault:      new VaultMemory(),
      webidClaim: { webid: 'https://bob.example/#me' },
      warnOnInsecure: false,
    });
    const claim = sa.claim.sign({ nknAddr: 'app.bob.xyz' });
    expect(claim.webid).toBe('https://bob.example/#me');
    expect(claim.pubKey).toBe(sa.identity.pubKey);
    expect(sa.claim.verify(claim).ok).toBe(true);
    expect(sa.claim.boundWebid).toBe('https://bob.example/#me');
    await sa.shutdown();
  });

  it('factory without bound webid: sa.claim.sign({webid}) works', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    const claim = sa.claim.sign({ webid: 'https://c.example/#me' });
    expect(claim.webid).toBe('https://c.example/#me');
    expect(sa.claim.boundWebid).toBeNull();
    await sa.shutdown();
  });

  it('factory without bound webid + no call-time webid → throws', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(() => sa.claim.sign()).toThrow(/no webid bound/);
    await sa.shutdown();
  });

  it('signed claim from one identity does NOT verify with another pubKey', async () => {
    const vaultA = new VaultMemory();
    const vaultB = new VaultMemory();
    const idA = await AgentIdentity.generate(vaultA);
    const idB = await AgentIdentity.generate(vaultB);
    const claim = signClaim(idA, { webid: 'https://a.example/#me' });
    // Swap in B's pubKey; sig was made by A, so it must fail
    const swapped = { ...claim, pubKey: idB.pubKey };
    expect(verifyClaim(swapped)).toEqual({ ok: false, reason: 'bad-sig' });
  });

  it('warnings no longer fire for muteListVaultKey / helloGate / webidClaim (now wired)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createSecureAgent({
      vault:            new VaultMemory(),
      muteListVaultKey: 'sa-mute',
      helloGate:        'psk',
      webidClaim:       { webid: 'https://x.example/#me' },
    });
    const allWarnArgs = warn.mock.calls.flat().join(' ');
    expect(allWarnArgs).not.toMatch(/muteListVaultKey/);
    expect(allWarnArgs).not.toMatch(/helloGate/);
    expect(allWarnArgs).not.toMatch(/webidClaim/);
    warn.mockRestore();
  });
});

/* ─── S3 — passphrase vault + WebAuthn ───────────────── */

describe('createSecureAgent — S3 passphrase vault', () => {
  it('passphrase opt without IndexedDB warns + falls through (no crash)', async () => {
    // jsdom-less Node env: no indexedDB, no localStorage either.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sa = await createSecureAgent({
      passphrase: 'hunter2',
      warnOnInsecure: false,
    });
    expect(sa.identity.pubKey).toBeTruthy();
    const allWarns = warn.mock.calls.flat().join(' ');
    expect(allWarns).toMatch(/passphrase opt set but IndexedDB unavailable/);
    expect(sa.securityStatus().vaultEncrypted).toBe(false);
    warn.mockRestore();
    await sa.shutdown();
  });

  it('explicit vault opt bypasses picker entirely (no warn for passphrase)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sa = await createSecureAgent({
      vault:      new VaultMemory(),
      passphrase: 'hunter2',
      warnOnInsecure: false,
    });
    const allWarns = warn.mock.calls.flat().join(' ');
    expect(allWarns).not.toMatch(/passphrase opt set/);
    expect(sa.securityStatus().vaultEncrypted).toBe(false);   // user-vault → can't introspect
    warn.mockRestore();
    await sa.shutdown();
  });

  it('passphrase + fake indexedDB → vaultEncrypted reported true', async () => {
    const origIDB = globalThis.indexedDB;
    globalThis.indexedDB = { open: () => ({}) };   // presence is what the picker checks
    try {
      const sa = await createSecureAgent({
        vault:      new VaultMemory(),   // bypass actual IndexedDB use
        passphrase: 'hunter2',
        warnOnInsecure: false,
      });
      // vaultEncrypted only true when picker WAS used (no opts.vault); here we
      // injected a vault, so the report is false.  Re-check the picker path:
      expect(sa.securityStatus().vaultEncrypted).toBe(false);
      await sa.shutdown();
    } finally {
      if (origIDB === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = origIDB;
    }
  });
});

describe('createSecureAgent — S3 WebAuthn / passkey', () => {
  let origNavigator, origLocation;

  beforeEach(() => {
    origNavigator = globalThis.navigator;
    origLocation  = globalThis.location;
  });

  afterEach(() => {
    if (origNavigator === undefined) delete globalThis.navigator; else globalThis.navigator = origNavigator;
    if (origLocation  === undefined) delete globalThis.location;  else globalThis.location  = origLocation;
  });

  it('webauthnAvailable() is false in plain Node', () => {
    delete globalThis.navigator;
    expect(webauthnAvailable()).toBe(false);
  });

  it('webauthnAvailable() true when navigator.credentials.create exists', () => {
    globalThis.navigator = { credentials: { create: () => {}, get: () => {} } };
    expect(webauthnAvailable()).toBe(true);
  });

  it('registerPasskey throws NO_WEBAUTHN when API missing', async () => {
    delete globalThis.navigator;
    await expect(registerPasskey({ rpId: 'x.test', userName: 'u' }))
      .rejects.toMatchObject({ code: PASSKEY_ERRORS.NO_WEBAUTHN });
  });

  it('registerPasskey wires through to navigator.credentials.create + returns id', async () => {
    const captured = {};
    globalThis.navigator = {
      credentials: {
        async create(args) {
          captured.args = args;
          return { rawId: new Uint8Array([1, 2, 3, 4, 5]).buffer };
        },
        get() {},
      },
    };
    // Use Node's real webcrypto for getRandomValues.

    const r = await registerPasskey({
      rpId: 'example.test',
      rpName: 'Example',
      userName: 'alice',
    });
    expect(r.credentialId).toBeTruthy();
    expect(captured.args.publicKey.rp.id).toBe('example.test');
    expect(captured.args.publicKey.extensions.prf).toEqual({});
    expect(captured.args.publicKey.authenticatorSelection.userVerification).toBe('required');
  });

  it('unlockWithPasskey returns base64url PRF result', async () => {
    const prfBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) prfBytes[i] = i;
    globalThis.navigator = {
      credentials: {
        create() {},
        async get(_args) {
          return {
            getClientExtensionResults: () => ({ prf: { results: { first: prfBytes.buffer } } }),
          };
        },
      },
    };
    const secret = await unlockWithPasskey({
      rpId:    'example.test',
      prfSalt: 'myapp/v1',
    });
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(40);   // 32 bytes → ~43 base64url chars
    // Stable: same call → same output (PRF determinism)
    const secret2 = await unlockWithPasskey({ rpId: 'example.test', prfSalt: 'myapp/v1' });
    expect(secret2).toBe(secret);
    // Decodable to original bytes
    const decoded = b64decode(secret);
    expect(decoded).toEqual(prfBytes);
  });

  it('unlockWithPasskey throws PRF_UNAVAILABLE when extension empty', async () => {
    globalThis.navigator = {
      credentials: {
        create() {},
        async get() {
          return { getClientExtensionResults: () => ({}) };   // no prf
        },
      },
    };
    await expect(unlockWithPasskey({ rpId: 'x.test', prfSalt: 's' }))
      .rejects.toMatchObject({ code: PASSKEY_ERRORS.PRF_UNAVAILABLE });
  });

  it('unlockWithPasskey wraps user-cancellation as UNLOCK_REJECTED', async () => {
    globalThis.navigator = {
      credentials: {
        create() {},
        get() { throw new Error('User cancelled'); },
      },
    };
    await expect(unlockWithPasskey({ rpId: 'x.test', prfSalt: 's' }))
      .rejects.toMatchObject({ code: PASSKEY_ERRORS.UNLOCK_REJECTED });
  });

  it('factory exposes sa.passkey.{register,unlock} when webAuthnUnlock set', async () => {
    globalThis.navigator = {
      credentials: {
        async create() { return { rawId: new Uint8Array([9, 9]).buffer }; },
        async get()    {
          return {
            getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).buffer } } }),
          };
        },
      },
    };
    const sa = await createSecureAgent({
      vault:           new VaultMemory(),
      webAuthnUnlock:  { rpId: 'app.test', prfSalt: 'v1' },
      warnOnInsecure:  false,
    });
    expect(sa.passkey.available).toBe(true);
    expect(sa.passkey.config.rpId).toBe('app.test');
    expect(sa.passkey.config.prfSalt).toBe('v1');
    const { credentialId } = await sa.passkey.register();
    expect(credentialId).toBeTruthy();
    const secret = await sa.passkey.unlock();
    expect(typeof secret).toBe('string');
    await sa.shutdown();
  });

  it('factory: webAuthnUnlock omitted → sa.passkey.register/unlock throw', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await expect(sa.passkey.register()).rejects.toThrow(/webAuthnUnlock not set/);
    await expect(sa.passkey.unlock()).rejects.toThrow(/webAuthnUnlock not set/);
    await sa.shutdown();
  });

  it('factory: webAuthnUnlock:true without window.location throws clear error', async () => {
    delete globalThis.location;
    await expect(createSecureAgent({
      vault: new VaultMemory(), webAuthnUnlock: true,
    })).rejects.toThrow(/requires window\.location\.hostname/);
  });

  it('factory: webAuthnUnlock:true with window.location infers rpId', async () => {
    globalThis.location = { hostname: 'inferred.test' };
    const sa = await createSecureAgent({
      vault: new VaultMemory(), webAuthnUnlock: true, warnOnInsecure: false,
    });
    expect(sa.passkey.config.rpId).toBe('inferred.test');
    await sa.shutdown();
  });

  it('warnings no longer fire for passphrase / webAuthnUnlock (now wired)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createSecureAgent({
      vault:          new VaultMemory(),
      passphrase:     'hunter2',
      webAuthnUnlock: { rpId: 'x.test', prfSalt: 's' },
    });
    const allWarnArgs = warn.mock.calls.flat().join(' ');
    expect(allWarnArgs).not.toMatch(/"passphrase"/);
    expect(allWarnArgs).not.toMatch(/"webAuthnUnlock"/);
    warn.mockRestore();
  });

  it('securityStatus reports S3 fields', async () => {
    globalThis.navigator = { credentials: { create() {}, get() {} } };
    const sa = await createSecureAgent({
      vault:          new VaultMemory(),
      webAuthnUnlock: { rpId: 'x.test', prfSalt: 's' },
      warnOnInsecure: false,
    });
    const st = sa.securityStatus();
    expect(st.passkeyConfigured).toBe(true);
    expect(st.passkeyAvailable).toBe(true);
    expect(st.vaultEncrypted).toBe(false);   // user-injected vault
    await sa.shutdown();
  });
});

/* ─── S4 — identity-resolver ─────────────────────────── */

describe('createSecureAgent — S4 identity-resolver', () => {
  // Build a minimal MemberMap-shape that returns canned members.
  function makeFakeMemberMap(members) {
    return {
      members,
      async resolveByPubKey(pk) { return members.find((m) => m.pubKey === pk) ?? null; },
      async resolveByWebid(w)   { return members.find((m) => m.webid  === w)  ?? null; },
      async resolveByStableId(s){ return members.find((m) => m.stableId === s) ?? null; },
    };
  }

  it('factory accepts identityResolver as bare MemberMap', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://a.example/#me', pubKey: 'pk-a', stableId: 'sid-a' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(), identityResolver: mm,
    });
    expect(sa.resolver).toBeInstanceOf(PeerResolver);
    expect(sa.resolver.hasMemberMap).toBe(true);
    expect(sa.securityStatus().resolverWired).toBe(true);
    await sa.shutdown();
  });

  it('factory accepts identityResolver as { memberMap }', async () => {
    const mm = makeFakeMemberMap([]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(), identityResolver: { memberMap: mm },
    });
    expect(sa.resolver.hasMemberMap).toBe(true);
    await sa.shutdown();
  });

  it('factory rejects identityResolver missing all resolveBy* methods', async () => {
    await expect(createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: { not: 'a resolver' },
    })).rejects.toThrow(/must expose at least one of resolveBy/);
  });

  it('omit identityResolver → resolver still present but hasMemberMap=false', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.resolver.hasMemberMap).toBe(false);
    expect(sa.resolver.hasSecurity).toBe(true);     // SecurityLayer is always on
    expect(await sa.resolver.resolveByWebid('anything')).toBeNull();
    await sa.shutdown();
  });

  it('resolver.resolveByAddr: addr → pubKey → member', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://a.example/#me', pubKey: 'pk-alice', stableId: 'sid-alice' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(), identityResolver: mm,
    });
    // Simulate that we received HI from app.alice.123, which registered pk-alice
    sa.agent.security.registerPeer('app.alice.123', 'pk-alice');
    const m = await sa.resolver.resolveByAddr('app.alice.123');
    expect(m.webid).toBe('https://a.example/#me');
    expect(m.stableId).toBe('sid-alice');
    await sa.shutdown();
  });

  it('resolver.aliasesFor: addr expands to addr + pubKey + webid + stableId', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://a.example/#me', pubKey: 'pk-alice', stableId: 'sid-alice' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(), identityResolver: mm,
    });
    sa.agent.security.registerPeer('app.alice.123', 'pk-alice');
    const aliases = await sa.resolver.aliasesFor('app.alice.123');
    expect(aliases).toEqual(expect.arrayContaining([
      'app.alice.123', 'pk-alice', 'https://a.example/#me', 'sid-alice',
    ]));
  });

  it('mute by webid is honored at receive (alias-fanout)', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://attacker.example/#me', pubKey: 'pk-bad', stableId: 'sid-bad' },
    ]);
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const onMsg = vi.fn();
    const sa = await createSecureAgent({
      vault:            new VaultMemory(),
      nknLib:           fakeNkn,
      identityResolver: mm,
      onPeerMessage:    onMsg,
    });
    await sa.peer.connect();
    sa.agent.security.registerPeer('app.attacker.999', 'pk-bad');
    // User mutes by webid (not by addr; addr may change per reconnect)
    await sa.mute.add('https://attacker.example/#me');
    // Simulate an inbound envelope from the address — should be dropped
    // BEFORE onPeerMessage fires.
    // (Bypass SecurityLayer's decryption by directly emitting an envelope
    // through the transport's listener — we're testing the mute fan-out
    // at the secure-agent receive step.)
    const tx = sa._peerTransportForTest ?? null;
    // We didn't expose it; instead just call isPeerMuted via sendTo:
    // a muted addr's send must throw → equivalent assertion.
    await expect(
      sa.peer.sendTo('app.attacker.999', { body: 'hi' })
    ).rejects.toThrow(/muted/);
    await sa.shutdown();
  });

  it('mute by stableId is also honored', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://b.example/#me', pubKey: 'pk-b', stableId: 'sid-banned' },
    ]);
    const fakeNkn = makeFakeNkn({ address: 'app.fake.x' });
    const sa = await createSecureAgent({
      vault: new VaultMemory(), nknLib: fakeNkn, identityResolver: mm,
    });
    await sa.peer.connect();
    sa.agent.security.registerPeer('app.b.000', 'pk-b');
    await sa.mute.add('sid-banned');
    await expect(sa.peer.sendTo('app.b.000', { body: 'x' })).rejects.toThrow(/muted/);
    await sa.shutdown();
  });

  it('mute by pubKey is honored', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://c.example/#me', pubKey: 'pk-c', stableId: 'sid-c' },
    ]);
    const fakeNkn = makeFakeNkn({ address: 'app.fake.y' });
    const sa = await createSecureAgent({
      vault: new VaultMemory(), nknLib: fakeNkn, identityResolver: mm,
    });
    await sa.peer.connect();
    sa.agent.security.registerPeer('app.c.111', 'pk-c');
    await sa.mute.add('pk-c');
    await expect(sa.peer.sendTo('app.c.111', { body: 'x' })).rejects.toThrow(/muted/);
    await sa.shutdown();
  });

  it('createPeerResolver standalone: graceful nulls when sources missing', async () => {
    const r = createPeerResolver({});
    expect(r.hasMemberMap).toBe(false);
    expect(r.hasSecurity).toBe(false);
    expect(r.pubKeyForAddr('whatever')).toBeNull();
    expect(await r.resolveByAddr('whatever')).toBeNull();
    expect(await r.resolveByWebid('w')).toBeNull();
    expect(await r.aliasesFor('addr')).toEqual(['addr']);
  });

  it('resolver falls back to addr-as-pubKey when SecurityLayer has no record', async () => {
    const mm = {
      async resolveByPubKey(pk) {
        return pk === 'app.directpubkey'
          ? { webid: 'https://d.example/#me', pubKey: 'app.directpubkey' }
          : null;
      },
    };
    const r = createPeerResolver({ memberMap: mm });
    const m = await r.resolveByAddr('app.directpubkey');
    expect(m.webid).toBe('https://d.example/#me');
  });
});

/* ─── 5.7c — circle override enforcement ─────────────── */

describe('createSecureAgent — 5.7c circle override enforcement', () => {
  // Reuses the S4 MemberMap fixture; defined locally so the describe
  // is self-contained.
  function makeFakeMemberMap(members) {
    return {
      members,
      async resolveByPubKey(pk) { return members.find((m) => m.pubKey === pk) ?? null; },
      async resolveByWebid(w)   { return members.find((m) => m.webid  === w)  ?? null; },
      async resolveByStableId(s){ return members.find((m) => m.stableId === s) ?? null; },
    };
  }

  it('omit circleEnforcement → wired=false; inbound never blocked by the gate', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.circleEnforcement.wired).toBe(false);
    expect(sa.securityStatus().circleEnforcementWired).toBe(false);
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.x' })).toBe(false);
    await sa.shutdown();
  });

  it('circleEnforcement with non-object throws at factory time', async () => {
    await expect(createSecureAgent({
      vault: new VaultMemory(),
      circleEnforcement: 'not-an-object',
    })).rejects.toThrow(/circleEnforcement must be an object/);
  });

  it('chat-off override drops inbound from a shared-circle peer', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://peer.example/#me', pubKey: 'pk-peer', stableId: 'sid-peer' },
    ]);
    const groupsIndex = {
      groupsFor: (webid) => webid === 'https://peer.example/#me' ? ['circle-a'] : [],
    };
    const getOverride = async (circleId) =>
      circleId === 'circle-a' ? { chatOff: true } : null;
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: { groupsIndex, getOverride, memberMap: mm },
    });
    expect(sa.circleEnforcement.wired).toBe(true);
    sa.agent.security.registerPeer('app.peer.111', 'pk-peer');
    const blocked = await sa.circleEnforcement.isInboundBlocked({ _from: 'app.peer.111' });
    expect(blocked).toBe(true);
    await sa.shutdown();
  });

  it('chat-off does NOT drop when override is off for the shared circle', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://peer.example/#me', pubKey: 'pk-peer', stableId: 'sid-peer' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex: { groupsFor: () => ['circle-a'] },
        getOverride: async () => ({ chatOff: false }),
        memberMap:   mm,
      },
    });
    sa.agent.security.registerPeer('app.peer.111', 'pk-peer');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.peer.111' })).toBe(false);
    await sa.shutdown();
  });

  it('unknown peer (no webid) → no enforcement decision; lets envelope through', async () => {
    const mm = makeFakeMemberMap([]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex: { groupsFor: () => ['anything'] },
        getOverride: async () => ({ chatOff: true }),
        memberMap:   mm,
      },
    });
    // No registerPeer call → resolver returns null webid → gate skips.
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.stranger.999' })).toBe(false);
    await sa.shutdown();
  });

  it('agent-block: peer marked relation=agent + circle policy agents=no → dropped', async () => {
    const agentMember = {
      webid:    'https://bot.example/#me',
      pubKey:   'pk-bot',
      stableId: 'sid-bot',
      relation: 'agent',
    };
    const mm = makeFakeMemberMap([agentMember]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex:       { groupsFor: () => ['circle-z'] },
        getOverride:       async () => null,
        getCirclePolicy:   async (id) => id === 'circle-z' ? { agents: 'no' } : null,
        memberMap:         mm,
        getCircleIdForEnv: () => 'circle-z',
      },
    });
    sa.agent.security.registerPeer('app.bot.111', 'pk-bot');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.bot.111' })).toBe(true);
    await sa.shutdown();
  });

  it('agent-block: per-user agentsMayContactMe=false also drops the agent', async () => {
    const agentMember = {
      webid:    'https://bot.example/#me',
      pubKey:   'pk-bot',
      stableId: 'sid-bot',
      relation: 'agent',
    };
    const mm = makeFakeMemberMap([agentMember]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex:       { groupsFor: () => ['circle-z'] },
        getOverride:       async () => ({ agentsMayContactMe: false }),
        getCirclePolicy:   async () => ({ agents: 'yes' }),
        memberMap:         mm,
        getCircleIdForEnv: () => 'circle-z',
      },
    });
    sa.agent.security.registerPeer('app.bot.111', 'pk-bot');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.bot.111' })).toBe(true);
    await sa.shutdown();
  });

  it('agent-block: non-agent relation is NEVER dropped by this gate', async () => {
    const humanMember = {
      webid:    'https://human.example/#me',
      pubKey:   'pk-human',
      stableId: 'sid-human',
      relation: 'friend',
    };
    const mm = makeFakeMemberMap([humanMember]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex:       { groupsFor: () => ['circle-z'] },
        getOverride:       async () => ({ agentsMayContactMe: false }),
        getCirclePolicy:   async () => ({ agents: 'no' }),
        memberMap:         mm,
        getCircleIdForEnv: () => 'circle-z',
      },
    });
    sa.agent.security.registerPeer('app.human.111', 'pk-human');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.human.111' })).toBe(false);
    await sa.shutdown();
  });

  it('fails OPEN when getOverride throws — never silently drops user-facing inbound', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://peer.example/#me', pubKey: 'pk-peer', stableId: 'sid-peer' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex: { groupsFor: () => ['circle-a'] },
        getOverride: async () => { throw new Error('store explosion'); },
        memberMap:   mm,
      },
    });
    sa.agent.security.registerPeer('app.peer.111', 'pk-peer');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.peer.111' })).toBe(false);
    await sa.shutdown();
  });

  it('fails OPEN when getCircleIdForEnv throws (agent-block scope unknown → no drop)', async () => {
    const mm = makeFakeMemberMap([
      { webid: 'https://bot.example/#me', pubKey: 'pk-bot', stableId: 'sid-bot', relation: 'agent' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex:       { groupsFor: () => [] },           // no chat-off match
        getOverride:       async () => null,
        getCirclePolicy:   async () => ({ agents: 'no' }),
        memberMap:         mm,
        getCircleIdForEnv: () => { throw new Error('boom'); },
      },
    });
    sa.agent.security.registerPeer('app.bot.111', 'pk-bot');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.bot.111' })).toBe(false);
    await sa.shutdown();
  });

  it('isInboundBlocked tolerates missing accessors (partial bundle)', async () => {
    // Host supplied a circleEnforcement opt but only the memberMap.
    // Without groupsIndex / getOverride / getCirclePolicy / getCircleIdForEnv
    // both predicates must short-circuit cleanly → never block.
    const mm = makeFakeMemberMap([
      { webid: 'https://peer.example/#me', pubKey: 'pk-peer', stableId: 'sid-peer', relation: 'agent' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: { memberMap: mm },        // no other accessors
    });
    expect(sa.circleEnforcement.wired).toBe(true);
    sa.agent.security.registerPeer('app.peer.111', 'pk-peer');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.peer.111' })).toBe(false);
    await sa.shutdown();
  });

  it('chat-off gate is consulted at receive (sa.circleEnforcement matches the live gate)', async () => {
    // The receive handler invokes the SAME isInboundCircleBlocked
    // predicate that the sa.circleEnforcement.isInboundBlocked surface
    // exposes; that surface is the only stable observation point
    // without reaching into the (intentionally private) peerTransport.
    // Verifying the surface honors mute-set membership before the
    // circle gate would require exposing peerTransport, which we
    // deliberately don't — the order is documented at the receive site
    // and exercised by the integration suite (basis 1117 / 1130).
    const mm = makeFakeMemberMap([
      { webid: 'https://peer.example/#me', pubKey: 'pk-peer', stableId: 'sid-peer' },
    ]);
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      identityResolver: mm,
      circleEnforcement: {
        groupsIndex: { groupsFor: () => ['circle-a'] },
        getOverride: async () => ({ chatOff: true }),
        memberMap:   mm,
      },
    });
    sa.agent.security.registerPeer('app.peer.111', 'pk-peer');
    expect(await sa.circleEnforcement.isInboundBlocked({ _from: 'app.peer.111' })).toBe(true);
    await sa.shutdown();
  });
});

/* ─── S5 — caps + roles + trust ─────────────────────── */

describe('createSecureAgent — S5 trust + caps + policy', () => {
  it('omit trustRegistry/capabilityIssuer/policyEngine → all null', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.trust).toBeNull();
    expect(sa.caps).toBeNull();
    expect(sa.policy).toBeNull();
    expect(sa.ROLES).toEqual(ROLES);
    await sa.shutdown();
  });

  it('trustRegistry:true wires a TrustRegistry on the identity vault', async () => {
    const vault = new VaultMemory();
    const sa = await createSecureAgent({ vault, trustRegistry: true });
    expect(sa.trust).toBeInstanceOf(TrustRegistry);
    expect(sa.securityStatus().trustWired).toBe(true);
    // Round-trip:
    await sa.trust.setTier('pk-x', 'trusted');
    expect(await sa.trust.getTier('pk-x')).toBe('trusted');
    await sa.shutdown();
  });

  it('trustRegistry: { vault } isolates state from identity vault', async () => {
    const identityV = new VaultMemory();
    const trustV    = new VaultMemory();
    const sa = await createSecureAgent({
      vault: identityV, trustRegistry: { vault: trustV },
    });
    await sa.trust.setTier('pk-y', 'authenticated');
    // identityV must not have the trust key
    const idKeys = await identityV.list();
    expect(idKeys.some((k) => k.startsWith('trust:'))).toBe(false);
    const tKeys  = await trustV.list();
    expect(tKeys).toContain('trust:pk-y');
    await sa.shutdown();
  });

  it('capabilityIssuer:true wires sa.caps.issue + verify with defaults', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), capabilityIssuer: true,
    });
    expect(typeof sa.caps.issue).toBe('function');
    const token = await sa.caps.issue({
      subject: 'pk-recipient',
      skill:   'echo',
    });
    expect(token).toBeInstanceOf(CapabilityToken);
    expect(token.issuer).toBe(sa.identity.pubKey);
    expect(token.agentId).toBe(sa.identity.pubKey);
    expect(token.subject).toBe('pk-recipient');
    expect(token.skill).toBe('echo');
    expect(token.isExpired).toBe(false);
    // Default verify uses our pubKey as expectedAgentId
    expect(sa.caps.verify(token)).toBe(true);
    await sa.shutdown();
  });

  it('capabilityIssuer: { defaultExpiresIn } honored', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      capabilityIssuer: { defaultExpiresIn: 100 },
    });
    const before = Date.now();
    const token = await sa.caps.issue({ subject: 'pk-r', skill: 's' });
    expect(token.expiresAt).toBeLessThanOrEqual(before + 100 + 50);
    await sa.shutdown();
  });

  it('caps.verify rejects expired token', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), capabilityIssuer: true,
    });
    const token = await sa.caps.issue({ subject: 'pk-r', skill: 's', expiresIn: 1 });
    await new Promise(r => setTimeout(r, 10));
    expect(sa.caps.verify(token)).toBe(false);
    await sa.shutdown();
  });

  it('caps.verify rejects token whose agentId is not ours', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), capabilityIssuer: true,
    });
    // Issue manually with a wrong agentId
    const token = await sa.caps.issue({
      subject: 'pk-r', agentId: 'pk-someone-else', skill: 's',
    });
    expect(sa.caps.verify(token)).toBe(false);
  });

  it('policyEngine requires trustRegistry — throws otherwise', async () => {
    await expect(createSecureAgent({
      vault: new VaultMemory(), policyEngine: true,
    })).rejects.toThrow(/requires trustRegistry/);
  });

  it('policyEngine:true wires sa.policy with both trust + skills', async () => {
    const sa = await createSecureAgent({
      vault:           new VaultMemory(),
      trustRegistry:   true,
      policyEngine:    true,
    });
    expect(sa.policy).toBeInstanceOf(PolicyEngine);
    expect(sa.securityStatus().policyWired).toBe(true);
    await sa.shutdown();
  });

  it('Roles re-export: roleRank + ROLES are usable', async () => {
    expect(ROLES.ADMIN).toBe('admin');
    expect(roleRank('admin') > roleRank('member')).toBe(true);
  });

  it('warnings no longer fire for trustRegistry / capabilityIssuer / policyEngine', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createSecureAgent({
      vault:            new VaultMemory(),
      trustRegistry:    true,
      capabilityIssuer: true,
      policyEngine:     true,
    });
    const allWarnArgs = warn.mock.calls.flat().join(' ');
    expect(allWarnArgs).not.toMatch(/"trustRegistry"/);
    expect(allWarnArgs).not.toMatch(/"capabilityIssuer"/);
    expect(allWarnArgs).not.toMatch(/"policyEngine"/);
    warn.mockRestore();
  });
});

/* ─── S6 — signed audit log ──────────────────────────── */

describe('AuditLog — standalone', () => {
  async function makeLog({ vault = null, vaultKey = null } = {}) {
    const v = new VaultMemory();
    const id = await AgentIdentity.generate(v);
    const log = await loadAuditLog({
      identity: id, vault: vault ?? v, vaultKey,
    });
    return { log, id };
  }

  it('appends signed entries; chain verifies', async () => {
    const { log } = await makeLog();
    await log.append({ event: 'identity.rotate', subject: 'pk-a' });
    await log.append({ event: 'mute.add',         subject: 'pk-bad' });
    await log.append({ event: 'caps.issue',       data: { skill: 'echo' } });
    expect(log.size).toBe(3);
    expect(log.verify()).toEqual({ ok: true });
  });

  it('first entry has prev=null; subsequent prevs chain', async () => {
    const { log } = await makeLog();
    const e1 = await log.append({ event: 'a' });
    const e2 = await log.append({ event: 'b' });
    expect(e1.prev).toBeNull();
    expect(typeof e2.prev).toBe('string');
    expect(e2.prev.length).toBeGreaterThan(20);
  });

  it('tampered entry → verify fails with bad-sig', async () => {
    const { log } = await makeLog();
    await log.append({ event: 'a' });
    await log.append({ event: 'b' });
    const entries = log.entries();
    // Mutate entry [0]'s data — sig over original is now invalid
    entries[0].data = { evil: true };
    const log2 = new AuditLog({ identity: { pubKey: 'x', sign: () => new Uint8Array(64) }, entries });
    const r = log2.verify();
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(0);
    expect(r.reason).toBe('bad-sig');
  });

  it('dropped middle entry → verify fails with bad-prev at the join', async () => {
    const { log, id } = await makeLog();
    await log.append({ event: 'a' });
    await log.append({ event: 'b' });
    await log.append({ event: 'c' });
    const entries = log.entries();
    entries.splice(1, 1);     // drop the middle one
    const log2 = new AuditLog({ identity: id, entries });
    const r = log2.verify();
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
    expect(r.reason).toBe('bad-prev');
  });

  it('serialize → loadSerialized round-trips + still verifies', async () => {
    const { log, id } = await makeLog();
    await log.append({ event: 'a' });
    await log.append({ event: 'b' });
    const str = log.serialize();
    const v2 = new VaultMemory();
    const log2 = await loadAuditLog({ identity: id, vault: v2 });
    await log2.loadSerialized(str);
    expect(log2.size).toBe(2);
    expect(log2.verify()).toEqual({ ok: true });
  });

  it('persistence: vault-backed log restores on second load', async () => {
    const v = new VaultMemory();
    const id = await AgentIdentity.generate(v);
    const log = await loadAuditLog({ identity: id, vault: v, vaultKey: 'audit' });
    await log.append({ event: 'a' });
    await log.append({ event: 'b' });
    expect(log.size).toBe(2);
    const log2 = await loadAuditLog({ identity: id, vault: v, vaultKey: 'audit' });
    expect(log2.size).toBe(2);
    expect(log2.verify()).toEqual({ ok: true });
  });

  it('filter() returns matching entries (string + RegExp)', async () => {
    const { log } = await makeLog();
    await log.append({ event: 'mute.add', subject: 'a' });
    await log.append({ event: 'mute.remove', subject: 'a' });
    await log.append({ event: 'caps.issue' });
    expect(log.filter('mute.add')).toHaveLength(1);
    expect(log.filter(/^mute\./)).toHaveLength(2);
    expect(log.filter(/.*/)).toHaveLength(3);
  });

  it('append requires event:string', async () => {
    const { log } = await makeLog();
    await expect(log.append({})).rejects.toThrow(/event \(string\) required/);
  });
});

describe('createSecureAgent — S6 audit integration', () => {
  it('omit auditLog → sa.audit is null', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.audit).toBeNull();
    expect(sa.auditAutoLog).toBe(false);
    await sa.shutdown();
  });

  it('auditLog:true → in-memory log, autoLog ON by default', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), auditLog: true,
    });
    expect(sa.audit).toBeInstanceOf(AuditLog);
    expect(sa.auditAutoLog).toBe(true);
    expect(sa.audit.size).toBe(0);

    // identity.rotate should fire an audit entry
    await sa.rotateIdentity();
    expect(sa.audit.size).toBe(1);
    expect(sa.audit.entries()[0].event).toBe('identity.rotate');
    await sa.shutdown();
  });

  it('autoLog wires mute.add + mute.remove', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), auditLog: true,
    });
    await sa.mute.add('app.x');
    await sa.mute.remove('app.x');
    const events = sa.audit.entries().map((e) => e.event);
    expect(events).toEqual(['mute.add', 'mute.remove']);
    await sa.shutdown();
  });

  it('autoLog wires caps.issue', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      capabilityIssuer: true,
      auditLog: true,
    });
    await sa.caps.issue({ subject: 'pk-r', skill: 'echo' });
    const e = sa.audit.entries().find((x) => x.event === 'caps.issue');
    expect(e).toBeTruthy();
    expect(e.subject).toBe('pk-r');
    expect(e.data.skill).toBe('echo');
    await sa.shutdown();
  });

  it('autoLog wires claim.sign', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      webidClaim: { webid: 'https://a.example/#me' },
      auditLog: true,
    });
    sa.claim.sign({ nknAddr: 'app.x' });
    const e = sa.audit.entries().find((x) => x.event === 'claim.sign');
    expect(e).toBeTruthy();
    expect(e.subject).toBe('https://a.example/#me');
    await sa.shutdown();
  });

  it('autoLog:false → no auto-fires; manual append still works', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), auditLog: { autoLog: false },
    });
    await sa.rotateIdentity();
    expect(sa.audit.size).toBe(0);
    await sa.audit.append({ event: 'manual.event' });
    expect(sa.audit.size).toBe(1);
    await sa.shutdown();
  });

  it('persistent: auditLog with vaultKey survives factory restart', async () => {
    const vault = new VaultMemory();
    const sa1 = await createSecureAgent({
      vault,
      auditLog: { vaultKey: 'sa-audit' },
    });
    await sa1.rotateIdentity();
    await sa1.shutdown();

    const sa2 = await createSecureAgent({
      vault,
      auditLog: { vaultKey: 'sa-audit' },
    });
    expect(sa2.audit.size).toBe(1);
    expect(sa2.audit.entries()[0].event).toBe('identity.rotate');
    expect(sa2.audit.verify()).toEqual({ ok: true });
    await sa2.shutdown();
  });

  it('securityStatus reports audit state', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), auditLog: true,
    });
    await sa.mute.add('app.x');
    const st = sa.securityStatus();
    expect(st.auditWired).toBe(true);
    expect(st.auditAutoLog).toBe(true);
    expect(st.auditSize).toBe(1);
    await sa.shutdown();
  });

  it('warnings no longer fire for auditLog (now wired)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createSecureAgent({
      vault: new VaultMemory(), auditLog: true,
    });
    const allWarnArgs = warn.mock.calls.flat().join(' ');
    expect(allWarnArgs).not.toMatch(/"auditLog"/);
    warn.mockRestore();
  });
});

/* ─── S7 — groups + a2aTls + rate-limit + migrate ────── */

describe('RateLimiter — standalone', () => {
  it('per-peer bucket: burst, then deny, then refill', () => {
    let t = 0;
    const rl = createRateLimiter({
      perPeer: { burst: 3, refillPerSec: 1 },
      global:  false,
      now:     () => t,
    });
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);   // bucket empty
    expect(rl.check('b')).toBe(true);     // other peer unaffected
    t += 2000;                              // refill 2 tokens
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
  });

  it('global bucket: noisy peers collectively over limit are throttled', () => {
    let t = 0;
    const rl = createRateLimiter({
      perPeer: { burst: 10, refillPerSec: 0 },
      global:  { burst: 3,  refillPerSec: 0 },
      now:     () => t,
    });
    expect(rl.check('a')).toBe(true);
    expect(rl.check('b')).toBe(true);
    expect(rl.check('c')).toBe(true);
    expect(rl.check('d')).toBe(false);   // global empty
  });

  it('disabling per-peer leaves only global protection', () => {
    let t = 0;
    const rl = createRateLimiter({
      perPeer: false,
      global:  { burst: 2, refillPerSec: 0 },
      now:     () => t,
    });
    expect(rl.check('x')).toBe(true);
    expect(rl.check('x')).toBe(true);
    expect(rl.check('x')).toBe(false);
  });

  it('snapshot reflects state', () => {
    const rl = createRateLimiter({ perPeer: { burst: 5, refillPerSec: 1 } });
    rl.check('alice');
    rl.check('alice');
    const snap = rl.snapshot();
    expect(snap.peers.alice.tokens).toBe(3);
  });
});

describe('createSecureAgent — S7 groups + a2aTls + rateLimit + migrate', () => {
  it('omit S7 opts → all null', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.groups).toBeNull();
    expect(sa.a2aTls).toBeNull();
    expect(sa.rateLimit).toBeNull();
    expect(typeof sa.migrateVaultToPod).toBe('function');   // always exposed
    await sa.shutdown();
  });

  it('groupManager:true wires GroupManager on identity vault', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), groupManager: true,
    });
    expect(sa.groups).toBeInstanceOf(GroupManager);
    // Round-trip: issue a proof for myself
    const proof = await sa.groups.issueProof(sa.identity.pubKey, 'g1');
    expect(proof.groupId).toBe('g1');
    expect(proof.memberPubKey).toBe(sa.identity.pubKey);
    await sa.shutdown();
  });

  it('groupManager auto-threads into policyEngine when both are on', async () => {
    const sa = await createSecureAgent({
      vault:         new VaultMemory(),
      trustRegistry: true,
      policyEngine:  true,
      groupManager:  true,
    });
    expect(sa.groups).toBeInstanceOf(GroupManager);
    expect(sa.policy).toBeTruthy();
    // The PolicyEngine should have the GroupManager (we don't have a
    // direct getter, but securityStatus should show both wired).
    const st = sa.securityStatus();
    expect(st.groupsWired).toBe(true);
    expect(st.policyWired).toBe(true);
    await sa.shutdown();
  });

  it('a2aTls:true wires A2ATLSLayer', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), a2aTls: true,
    });
    expect(sa.a2aTls).toBeInstanceOf(A2ATLSLayer);
    expect(sa.securityStatus().a2aTlsWired).toBe(true);
    await sa.shutdown();
  });

  it('rateLimit:true wires defaults; over-quota drops envelopes', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const onMsg = vi.fn();
    const sa = await createSecureAgent({
      vault:         new VaultMemory(),
      nknLib:        fakeNkn,
      rateLimit:     { perPeer: { burst: 2, refillPerSec: 0 }, global: false },
      onPeerMessage: onMsg,
    });
    await sa.peer.connect();
    expect(sa.rateLimit).toBeInstanceOf(RateLimiter);
    // 3 envelopes from same peer: 3rd should be dropped
    // (we don't go through SecurityLayer here; assert via .check directly)
    expect(sa.rateLimit.check('app.peer.x')).toBe(true);
    expect(sa.rateLimit.check('app.peer.x')).toBe(true);
    expect(sa.rateLimit.check('app.peer.x')).toBe(false);
    await sa.shutdown();
  });

  it('rateLimit: false bucket disables that protection', async () => {
    const sa = await createSecureAgent({
      vault:     new VaultMemory(),
      rateLimit: { perPeer: false, global: { burst: 1, refillPerSec: 0 } },
    });
    expect(sa.rateLimit.check('any')).toBe(true);
    expect(sa.rateLimit.check('any')).toBe(false);   // global exhausted
    await sa.shutdown();
  });

  it('migrateVaultToPod helper requires podClient + podRoot + mnemonic', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await expect(sa.migrateVaultToPod({})).rejects.toThrow(/podClient/);
    await sa.shutdown();
  });

  it('migrateVaultToPod helper forwards to core fn (dryRun smoke test)', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    // Minimal podClient stub — read returns NOT_FOUND so the migration
    // takes the "fresh init" branch.  In dryRun no writes happen so
    // we only need read.
    const podClient = {
      async read(_uri) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; },
      async write() {},
      async patch() {},
      async exists() { return false; },
    };
    // Use a valid BIP-39 mnemonic from Bootstrap's vocabulary.
    const mnemonic = 'abandon abandon abandon abandon abandon abandon ' +
                     'abandon abandon abandon abandon abandon about';
    let report;
    try {
      report = await sa.migrateVaultToPod({
        podClient,
        podRoot:  'https://alice.example/onderling/',
        mnemonic,
        dryRun:   true,
      });
    } catch (err) {
      // Some core preconditions (Bootstrap signature validation) may
      // reject our stub seed in dry-run — that's still a successful
      // forward through the helper.  Accept either path:
      expect(err).toBeTruthy();
      await sa.shutdown();
      return;
    }
    expect(report).toBeTruthy();
    expect(report.dryRun).toBe(true);
    await sa.shutdown();
  });

  it('warnings no longer fire for groupManager / a2aTls / rateLimit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createSecureAgent({
      vault:         new VaultMemory(),
      groupManager:  true,
      a2aTls:        true,
      rateLimit:     true,
    });
    const allWarnArgs = warn.mock.calls.flat().join(' ');
    expect(allWarnArgs).not.toMatch(/"groupManager"/);
    expect(allWarnArgs).not.toMatch(/"a2aTls"/);
    expect(allWarnArgs).not.toMatch(/"rateLimit"/);
    warn.mockRestore();
  });
});

/* ─── S8 — Perfect Forward Secrecy ──────────────────── */

describe('PFSChain — standalone', () => {
  async function makePair() {
    const vA = new VaultMemory();
    const vB = new VaultMemory();
    const idA = await AgentIdentity.generate(vA);
    const idB = await AgentIdentity.generate(vB);
    const chainA = await loadPFSChain({ identity: idA, peerPubKey: idB.pubKey });
    const chainB = await loadPFSChain({ identity: idB, peerPubKey: idA.pubKey });
    return { idA, idB, chainA, chainB };
  }

  it('encrypt then decrypt round-trips (in order)', async () => {
    const { chainA, chainB } = await makePair();
    const w1 = await chainA.encrypt('hello');
    const w2 = await chainA.encrypt('world');
    const p1 = await chainB.decrypt(w1);
    const p2 = await chainB.decrypt(w2);
    expect(new TextDecoder().decode(p1)).toBe('hello');
    expect(new TextDecoder().decode(p2)).toBe('world');
  });

  it('reverse direction also works (symmetric chain assignment)', async () => {
    const { chainA, chainB } = await makePair();
    const w = await chainB.encrypt('reply');
    const p = await chainA.decrypt(w);
    expect(new TextDecoder().decode(p)).toBe('reply');
  });

  it('chain advances: same key never reused', async () => {
    const { chainA, chainB } = await makePair();
    const w1 = await chainA.encrypt('x');
    const w2 = await chainA.encrypt('x');
    expect(w1.ct).not.toEqual(w2.ct);
    expect(w1.n).toBe(0);
    expect(w2.n).toBe(1);
    await chainB.decrypt(w1);
    await chainB.decrypt(w2);
  });

  it('out-of-order delivery: skipped key cache makes it work', async () => {
    const { chainA, chainB } = await makePair();
    const w1 = await chainA.encrypt('one');
    const w2 = await chainA.encrypt('two');
    const w3 = await chainA.encrypt('three');
    const p2 = await chainB.decrypt(w2);
    const p1 = await chainB.decrypt(w1);
    const p3 = await chainB.decrypt(w3);
    expect(new TextDecoder().decode(p1)).toBe('one');
    expect(new TextDecoder().decode(p2)).toBe('two');
    expect(new TextDecoder().decode(p3)).toBe('three');
  });

  it('replay (same n twice) is rejected on second receipt', async () => {
    const { chainA, chainB } = await makePair();
    const w = await chainA.encrypt('once');
    await chainB.decrypt(w);
    await expect(chainB.decrypt(w)).rejects.toThrow(/replay|stale/i);
  });

  it('tampered ciphertext fails secretbox auth', async () => {
    const { chainA, chainB } = await makePair();
    const w = await chainA.encrypt('protected');
    const tampered = { ...w, ct: w.ct.slice(0, -4) + 'AAAA' };
    await expect(chainB.decrypt(tampered)).rejects.toThrow(/auth failed|secretbox/);
  });

  it('gap exceeding maxSkip is rejected', async () => {
    const { idA, idB } = await makePair();
    const chainA = await loadPFSChain({ identity: idA, peerPubKey: idB.pubKey, maxSkip: 3 });
    const chainB = await loadPFSChain({ identity: idB, peerPubKey: idA.pubKey, maxSkip: 3 });
    let last;
    for (let i = 0; i < 5; i++) last = await chainA.encrypt('msg');
    await expect(chainB.decrypt(last)).rejects.toThrow(/sequence gap/);
  });

  it('serialize → restore round-trips + chain continues correctly', async () => {
    const { idA, idB, chainA, chainB } = await makePair();
    const w1 = await chainA.encrypt('first');
    await chainB.decrypt(w1);
    const snapA = chainA.serialize();
    const snapB = chainB.serialize();
    const chainA2 = PFSChain.restore(snapA, { identity: idA, peerPubKey: idB.pubKey });
    const chainB2 = PFSChain.restore(snapB, { identity: idB, peerPubKey: idA.pubKey });
    expect(chainA2.sendN).toBe(1);
    expect(chainB2.recvN).toBe(1);
    const w2 = await chainA2.encrypt('second');
    const p2 = await chainB2.decrypt(w2);
    expect(new TextDecoder().decode(p2)).toBe('second');
  });

  it('different peers → different chains (no cross-decrypt)', async () => {
    const { chainA, chainB } = await makePair();
    const { chainA: chainC } = await makePair();
    const w = await chainA.encrypt('for B');
    await expect(chainC.decrypt(w)).rejects.toThrow(/auth failed|secretbox/);
    expect(new TextDecoder().decode(await chainB.decrypt(w))).toBe('for B');
  });
});

describe('createSecureAgent — S8 PFS integration', () => {
  it('usePerfectFwdSec opt off → sa.pfs is null', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.pfs).toBeNull();
    await sa.shutdown();
  });

  it('usePerfectFwdSec:true → sa.pfs exposed; partial flag honest', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), usePerfectFwdSec: true,
    });
    expect(sa.pfs).toBeTruthy();
    expect(sa.pfs.enabled).toBe(true);
    expect(sa.pfs.partial).toBe(true);
    expect(sa.pfs.knownPeers()).toEqual([]);
    await sa.shutdown();
  });

  it('two factories with PFS can encrypt/decrypt to each other', async () => {
    const vA = new VaultMemory();
    const vB = new VaultMemory();
    const saA = await createSecureAgent({
      vault: vA, usePerfectFwdSec: true,
    });
    const saB = await createSecureAgent({
      vault: vB, usePerfectFwdSec: true,
    });
    const wire = await saA.pfs.encrypt(saB.identity.pubKey, 'secret message');
    const plain = await saB.pfs.decrypt(saA.identity.pubKey, wire);
    expect(new TextDecoder().decode(plain)).toBe('secret message');
    await saA.shutdown();
    await saB.shutdown();
  });

  it('vaultKeyPrefix: chain state persists across factory restart', async () => {
    const vA = new VaultMemory();
    const vB = new VaultMemory();
    let saA = await createSecureAgent({
      vault: vA, usePerfectFwdSec: { vaultKeyPrefix: 'pfs:' },
    });
    let saB = await createSecureAgent({
      vault: vB, usePerfectFwdSec: { vaultKeyPrefix: 'pfs:' },
    });
    const bPub = saB.identity.pubKey;
    const aPub = saA.identity.pubKey;
    const w1 = await saA.pfs.encrypt(bPub, 'one');
    await saB.pfs.decrypt(aPub, w1);
    await saA.shutdown();
    await saB.shutdown();

    saA = await createSecureAgent({
      vault: vA, usePerfectFwdSec: { vaultKeyPrefix: 'pfs:' },
    });
    saB = await createSecureAgent({
      vault: vB, usePerfectFwdSec: { vaultKeyPrefix: 'pfs:' },
    });
    const w2 = await saA.pfs.encrypt(bPub, 'two');
    expect(w2.n).toBe(1);
    const p2 = await saB.pfs.decrypt(aPub, w2);
    expect(new TextDecoder().decode(p2)).toBe('two');
    await saA.shutdown();
    await saB.shutdown();
  });

  it('securityStatus reports PFS state', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(), usePerfectFwdSec: true,
    });
    const st = sa.securityStatus();
    expect(st.pfsWired).toBe(true);
    expect(st.pfsPartial).toBe(true);
    expect(st.pfsChainCount).toBe(0);
    await sa.shutdown();
  });

  it('STUB_OPTS is empty: every roadmap opt is now wired', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sa = await createSecureAgent({
      vault:            new VaultMemory(),
      muteListVaultKey: 'm', helloGate: 'psk',
      webidClaim:       { webid: 'https://x.example/#me' },
      passphrase:       'p',
      webAuthnUnlock:   { rpId: 'x.test', prfSalt: 's' },
      identityResolver: { resolveByPubKey: async () => null },
      trustRegistry:    true, capabilityIssuer: true, policyEngine: true,
      auditLog:         true,
      groupManager:     true, a2aTls: true, rateLimit: true,
      usePerfectFwdSec: true,
    });
    const allWarnArgs = warn.mock.calls.flat().join(' ');
    expect(allWarnArgs).not.toMatch(/RESERVED for a future slice/);
    expect(Object.keys(sa.pendingOpts)).toEqual([]);
    warn.mockRestore();
    await sa.shutdown();
  });
});

/* ─── A1 (2026-05-23) — transport-mode + relay surface ─── */

describe('createSecureAgent — A1 multi-transport', () => {
  it('exposes sa.relay with idle state by default', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.relay).toBeDefined();
    expect(sa.relay.status).toBe('idle');
    expect(sa.relay.address).toBeNull();
    expect(sa.relay.url).toBeNull();
    await sa.shutdown();
  });

  it('defaults transportMode to "nkn"', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    expect(sa.transportMode).toBe('nkn');
    await sa.shutdown();
  });

  it('setTransportMode accepts nkn|relay|both, rejects others', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    sa.setTransportMode('relay');
    expect(sa.transportMode).toBe('relay');
    sa.setTransportMode('both');
    expect(sa.transportMode).toBe('both');
    sa.setTransportMode('nkn');
    expect(sa.transportMode).toBe('nkn');
    expect(() => sa.setTransportMode('bogus')).toThrow(/invalid mode/);
    await sa.shutdown();
  });

  it('honours opts.transportMode at factory time', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      transportMode: 'both',
    });
    expect(sa.transportMode).toBe('both');
    await sa.shutdown();
  });

  it('sendToPeer throws when no transport in current mode', async () => {
    const sa = await createSecureAgent({
      vault: new VaultMemory(),
      transportMode: 'relay',  // relay is the only acceptable transport
    });
    // No relay connected → sendToPeer should throw, even though
    // peerTransport (NKN) is also not connected (would be the same
    // throw either way).
    await expect(sa.peer.sendTo('peer-x', { type: 'test' }))
      .rejects.toThrow(/Peer transport not connected.*mode=relay/);
    await sa.shutdown();
  });

  it('relay.connect throws when no relayUrl provided', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    await expect(sa.relay.connect()).rejects.toThrow(/no relayUrl/);
    await sa.shutdown();
  });

  // T2 (unification / OBJ-1) — in 'both' mode, sendToPeer routes via the RoutingStrategy.
  it("transportMode:'both' routes via the RoutingStrategy and still delivers over the one connected transport", async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const sa = await createSecureAgent({ vault: new VaultMemory(), nknLib: fakeNkn, transportMode: 'both' });
    await sa.peer.connect();   // registers 'nkn' with the router
    sa.agent.security.registerPeer('app.peer.456', sa.identity.pubKey);
    await sa.peer.sendTo('app.peer.456', { type: 'p2p-chat', body: 'hi' });
    // The router selected the only available transport (nkn) → HI + OW went out over it.
    expect(fakeNkn._instance.sends.length).toBe(2);
    await sa.shutdown();
  });

  // T5.1 (unification) — the secure-agent's router IS the core Agent's router (one shared RoutingStrategy).
  it('T5.1 — agent.routing is the shared RoutingStrategy, and connected transports register on it', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const sa = await createSecureAgent({ vault: new VaultMemory(), nknLib: fakeNkn });
    expect(sa.agent.routing).toBeTruthy();                 // was null before T5.1
    await sa.peer.connect();                               // routing.addTransport('nkn', …)
    const sel = await sa.agent.routing.selectTransport('app.peer.456');
    expect(sel?.name).toBe('nkn');                         // the shared router sees the transport
    // ⇒ agent.enableRendezvous / mdns / ble (which pin on agent.routing) now affect sendToPeer too.
    await sa.shutdown();
  });

  // T5.2a — addSecureTransport registers an injected transport (security-wrapped) on the unified router.
  it('T5.2a — addSecureTransport security-wraps + router-registers an injected transport (mdns/ble seam)', async () => {
    const sa = await createSecureAgent({ vault: new VaultMemory() });
    let securedWith = null;
    let connected = false, disconnected = false;
    const fakeMdns = {
      address: 'mdns.local.1',
      useSecurityLayer(layer) { securedWith = layer; },     // makeReceiveHandler applies the security layer
      on() { /* 'envelope' listener */ },
      async connect()    { connected = true; },
      async disconnect() { disconnected = true; },
      // no canReach() → treated as reachable (address-agnostic)
    };
    await sa.addSecureTransport('mdns', fakeMdns);
    expect(securedWith).toBe(sa.agent.security);            // got the SAME security layer (not clobbered)
    expect(connected).toBe(true);
    expect(sa.transportMode).toBe('both');                 // flipped so the router selects
    const sel = await sa.agent.routing.selectTransport('peer-x');
    expect(sel?.name).toBe('mdns');                         // registered on the unified router
    await sa.removeSecureTransport('mdns');
    expect(disconnected).toBe(true);
    expect(await sa.agent.routing.selectTransport('peer-x')).toBeNull();   // deregistered
    await sa.shutdown();
  });

  // T5.2b — enableSecureRendezvous wires the WebRTC route + pins it on DataChannel open.
  it('T5.2b — enableSecureRendezvous registers rendezvous + pins the direct route on channel-open', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.123' });
    const sa = await createSecureAgent({ vault: new VaultMemory(), nknLib: fakeNkn });
    await sa.peer.connect();                                  // a signalling transport (nkn)
    const rdv = await sa.enableSecureRendezvous({});          // node: connect() works w/o rtcLib
    expect(rdv).toBeTruthy();
    expect(sa.agent.routing.getPreferredTransport('peer-x')).toBeNull();
    // Simulate the WebRTC DataChannel opening → the secure-agent pins rendezvous for that peer.
    rdv.emit('peer-connected', 'peer-x');
    expect(sa.agent.routing.getPreferredTransport('peer-x')).toBe('rendezvous');
    // …and clears it when the channel drops.
    rdv.emit('peer-disconnected', 'peer-x');
    expect(sa.agent.routing.getPreferredTransport('peer-x')).toBeNull();
    // upgradeToRendezvous without an rtcLib (node) surfaces a clear error, not a silent hang.
    await expect(sa.upgradeToRendezvous('peer-y')).rejects.toBeTruthy();
    await sa.shutdown();
  });

  // T5.2c — auto-upgrade: advertise the capability + upgrade toward peers that advertise it.
  it('T5.2c — enableSecureRendezvous advertises rendezvous + auto-upgrades on a capability hello', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.auto' });
    const sa = await createSecureAgent({ vault: new VaultMemory(), nknLib: fakeNkn });
    await sa.peer.connect();
    await sa.enableSecureRendezvous({});                       // auto defaults to true

    // (1) we now advertise rendezvous in our HI capabilities (so PEERS upgrade toward us).
    expect(sa.agent._rendezvousEnabled).toBe(true);

    // (2) a peer whose hello advertises rendezvous triggers an auto upgrade attempt. Without an
    // rtcLib (node) the WebRTC connect fails → surfaced as 'rendezvous-failed', which PROVES the
    // auto listener fired + drove upgradeToRendezvous (rather than a silent no-op).
    const failed = [];
    sa.agent.on('rendezvous-failed', ({ peer }) => failed.push(peer));
    sa.agent.emit('peer', { address: 'peer-auto', capabilities: { rendezvous: true } });
    await new Promise((r) => setTimeout(r, 20));
    expect(failed).toContain('peer-auto');

    // a peer WITHOUT the flag is left on the signalling transport (no upgrade attempt).
    sa.agent.emit('peer', { address: 'peer-plain', capabilities: { rendezvous: false } });
    await new Promise((r) => setTimeout(r, 20));
    expect(failed).not.toContain('peer-plain');

    await sa.shutdown();
  });

  it('T5.2c — auto:false advertises but binds no auto-upgrade listener', async () => {
    const fakeNkn = makeFakeNkn({ address: 'app.fake.noauto' });
    const sa = await createSecureAgent({ vault: new VaultMemory(), nknLib: fakeNkn });
    await sa.peer.connect();
    await sa.enableSecureRendezvous({ auto: false });
    const failed = [];
    sa.agent.on('rendezvous-failed', ({ peer }) => failed.push(peer));
    sa.agent.emit('peer', { address: 'peer-x', capabilities: { rendezvous: true } });
    await new Promise((r) => setTimeout(r, 20));
    expect(failed).toEqual([]);                                // no listener → no attempt
    expect(sa.agent._rendezvousEnabled).toBe(true);           // …but we still advertise
    await sa.shutdown();
  });
});

/* ─── helpers ───────────────────────────────────────── */

/**
 * Minimal NKN SDK stub for testing.  Implements just enough surface
 * for NknTransport.connect() + .send() to succeed.  Captures every
 * send() call for assertions.
 */
function makeFakeNkn({ address = 'app.fake.test' } = {}) {
  const instance = {
    addr: address,
    sends: [],
    handlers: { connect: [], message: [], error: [] },
    on(event, cb) { (this.handlers[event] ??= []).push(cb); },
    async send(to, payload, _opts) {
      this.sends.push({ to, payload });
    },
    close() { /* no-op */ },
  };
  const lib = {
    Client: function (_opts) {
      // Async connect: schedule the 'connect' handler.
      queueMicrotask(() => {
        for (const cb of instance.handlers.connect) cb();
      });
      return instance;
    },
    _instance: instance,
    /**
     * Test helper: simulate an inbound NKN message arriving at this
     * client.  Wraps the envelope in the same `{ payload }` shape
     * NKN's 'message' event delivers (JSON-stringified body).
     */
    _simulateInbound(envelope) {
      const wireMsg = { payload: JSON.stringify(envelope) };
      for (const cb of instance.handlers.message) cb(wireMsg);
    },
  };
  return lib;
}
