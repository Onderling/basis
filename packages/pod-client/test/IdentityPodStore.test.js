/**
 * IdentityPodStore.test.js — Track B / B2 unit tests.
 *
 * Uses an in-memory MockPodClient (NOT a real CSS pod) — B2's DoD
 * accepts mock-backed unit tests, with real-pod coverage deferred to
 * B4 / integration runs.
 *
 * Covers:
 *   - init creates `/onderling/manifest.ttl` and signs it.
 *   - readResource / writeResource round-trip for each resource type
 *     (Device, Contact, AppPermission, RecoveryHint, CapabilityGrant{Issued,Held}).
 *   - tamper detection — flipping a byte in an `.enc` file fails verifyManifest.
 *   - contentHash determinism — same set of resources, different write
 *     order → same hash.
 *   - auth-log append accumulates events; second store instance reads them.
 *   - manifest LWW retry survives a single transient ConflictError.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import nacl   from 'tweetnacl';

import { Bootstrap }        from '@onderling/core';
import { AgentIdentity }    from '@onderling/core';
import { IdentityPodStore } from '../src/identity/IdentityPodStore.js';
import { parseManifest }    from '../src/identity/identitySerializers/turtle.js';

// ── MockPodClient ──────────────────────────────────────────────────────────

/**
 * Minimal in-memory PodClient impl that mirrors the surface
 * IdentityPodStore uses: read / write / list (recursive walk),
 * with NOT_FOUND on missing reads and a programmable conflict hook.
 */
class MockPodClient {
  constructor() {
    /** @type {Map<string, { content: string, contentType: string }>} */
    this.store = new Map();
    /** @type {Array<(uri: string) => Error|null>} */
    this.beforeWrite = [];
  }

  async read(uri /*, opts */) {
    if (!this.store.has(uri)) {
      throw Object.assign(new Error(`MockPodClient: ${uri} not found`), { code: 'NOT_FOUND' });
    }
    const v = this.store.get(uri);
    return { uri, content: v.content, contentType: v.contentType };
  }

  async write(uri, content, opts = {}) {
    // Allow tests to inject conflicts before the write commits.
    for (const hook of this.beforeWrite) {
      const err = hook(uri, content, opts);
      if (err) throw err;
    }
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    this.store.set(uri, {
      content: text,
      contentType: opts.contentType || 'text/plain',
    });
    return { uri, contentType: opts.contentType, etag: `"${text.length}-${Date.now()}"` };
  }

  /**
   * Lists DIRECT children of `containerUri`.  Containers are detected
   * by any stored URI that starts with `containerUri` and contains a
   * further `/` after the prefix → emit the intermediate container.
   */
  async list(containerUri /*, opts */) {
    const base = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
    const seen = new Set();
    const entries = [];
    for (const uri of this.store.keys()) {
      if (!uri.startsWith(base)) continue;
      const rest = uri.slice(base.length);
      if (rest.length === 0) continue;
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) {
        // direct resource
        if (!seen.has(uri)) {
          seen.add(uri);
          entries.push({ uri, type: 'resource' });
        }
      } else {
        const childContainer = base + rest.slice(0, slashIdx + 1);
        if (!seen.has(childContainer)) {
          seen.add(childContainer);
          entries.push({ uri: childContainer, type: 'container' });
        }
      }
    }
    return { container: base, entries };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStore({ podRoot = 'https://alice.example/' } = {}) {
  const podClient = new MockPodClient();
  const { bootstrap } = Bootstrap.create();
  const identity = new AgentIdentity({ vault: null, seed: nacl.randomBytes(32) });
  const store = new IdentityPodStore({ podClient, bootstrap, identity, podRoot });
  return { store, podClient, bootstrap, identity };
}

const sampleDevice = (i = 0) => ({
  '@type': 'dw:Device',
  pubkey:  `ed25519:base58:fake-device-${i}`,
  label:   `Test Device ${i}`,
  pairedAt: '2026-04-28T10:00:00Z',
  lastSeen: '2026-04-28T11:30:00Z',
  retired: false,
  platformHint: 'linux',
  capabilities: ['push', 'mdns'],
  bootstrapKeyFingerprint: '9f3a2c1b4e5d6f00',
});

const sampleContact = (i = 0) => ({
  '@type': 'dw:Contact',
  pubkey:  `ed25519:base58:fake-contact-${i}`,
  label:   `Friend ${i}`,
  webid:   `https://friend${i}.example/profile/card#me`,
  trustTier: 2,
  groups: ['group:my-block'],
  firstSeen: '2026-03-01T12:00:00Z',
});

const sampleAppPermission = (i = 0) => ({
  '@type': 'dw:AppPermission',
  appId:   `obsidian-pod-sync-${i}`,
  appName: 'Obsidian (with pod-sync plugin)',
  scopes:  ['pod.read:/notes/', 'pod.write:/notes/'],
  grantedAt: '2026-04-28T11:00:00Z',
  expiresAt: '2027-04-28T11:00:00Z',
  tokenId: `tok-app-${i}`,
});

const sampleRecoveryHint = () => ({
  '@type': 'dw:RecoveryHint',
  method:  'bip39-seed-paper',
  hint:    'In the lockbox at home, top-left envelope',
  setupAt: '2026-04-28T10:30:00Z',
  lastVerifiedAt: '2026-04-28T10:30:00Z',
});

const sampleGrant = (kind, i = 0) => ({
  '@type': kind === 'issued' ? 'dw:CapabilityGrantIssued' : 'dw:CapabilityGrantHeld',
  tokenId: `tok-${kind}-${i}`,
  issuedBy: 'https://alice.example/profile/card#me',
  issuedTo: 'https://bob.example/profile/card#me',
  scope: ['archive.read'],
  issuedAt: '2026-04-28T10:15:00Z',
  expiresAt: '2026-05-28T00:00:00Z',
  reason: 'test grant',
  tokenJson: '{"fake":"token"}',
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('IdentityPodStore.init', () => {
  it('creates manifest.ttl on a fresh container and verifies', async () => {
    const { store, podClient } = makeStore();
    const result = await store.init();
    expect(result.created).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.manifest.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const manifestUri = 'https://alice.example/onderling/manifest.ttl';
    expect(podClient.store.has(manifestUri)).toBe(true);
    const ttl = podClient.store.get(manifestUri).content;
    const parsed = parseManifest(ttl);
    expect(parsed.schemaVersion).toBe('0.1.0');
    expect(parsed.signature).toBeTruthy();
    expect(parsed.contentHash).toBe(result.manifest.contentHash);
  });

  it('is idempotent on second init', async () => {
    const { store } = makeStore();
    await store.init();
    const second = await store.init();
    expect(second.created).toBe(false);
    expect(second.verified).toBe(true);
  });
});

describe('IdentityPodStore.writeResource / readResource', () => {
  it('round-trips a Device record', async () => {
    const { store } = makeStore();
    await store.init();
    const dev = sampleDevice(1);
    await store.writeResource('devices/device-9f3a2c1b4e5d6f00.enc', dev);
    const back = await store.readResource('devices/device-9f3a2c1b4e5d6f00.enc');
    expect(back).toEqual(dev);
  });

  it('round-trips a Contact record', async () => {
    const { store } = makeStore();
    await store.init();
    const c = sampleContact(2);
    await store.writeResource('contacts/contact-deadbeef00.enc', c);
    expect(await store.readResource('contacts/contact-deadbeef00.enc')).toEqual(c);
  });

  it('round-trips an AppPermission record', async () => {
    const { store } = makeStore();
    await store.init();
    const p = sampleAppPermission(3);
    await store.writeResource('app-permissions/app-obsidian-pod-sync-3.enc', p);
    expect(await store.readResource('app-permissions/app-obsidian-pod-sync-3.enc')).toEqual(p);
  });

  it('round-trips a RecoveryHint record', async () => {
    const { store } = makeStore();
    await store.init();
    const h = sampleRecoveryHint();
    await store.writeResource('recovery-hints.enc', h);
    expect(await store.readResource('recovery-hints.enc')).toEqual(h);
  });

  it('round-trips CapabilityGrantIssued and CapabilityGrantHeld', async () => {
    const { store } = makeStore();
    await store.init();
    const i = sampleGrant('issued', 1);
    const h = sampleGrant('held', 2);
    await store.writeResource('grants/issued/grant-tok-issued-1.enc', i);
    await store.writeResource('grants/held/grant-tok-held-2.enc', h);
    expect(await store.readResource('grants/issued/grant-tok-issued-1.enc')).toEqual(i);
    expect(await store.readResource('grants/held/grant-tok-held-2.enc')).toEqual(h);
  });

  it('rejects writeResource for the manifest path', async () => {
    const { store } = makeStore();
    await store.init();
    await expect(store.writeResource('manifest.ttl', {})).rejects.toThrow();
  });

  it('rejects writeResource without .enc suffix', async () => {
    const { store } = makeStore();
    await store.init();
    await expect(store.writeResource('contacts/contact-x', {})).rejects.toThrow();
  });

  it('updates the manifest contentHash on each write', async () => {
    const { store, podClient } = makeStore();
    await store.init();
    const manifestUri = 'https://alice.example/onderling/manifest.ttl';
    const h0 = parseManifest(podClient.store.get(manifestUri).content).contentHash;
    await store.writeResource('devices/device-x.enc', sampleDevice(1));
    const h1 = parseManifest(podClient.store.get(manifestUri).content).contentHash;
    await store.writeResource('contacts/contact-y.enc', sampleContact(1));
    const h2 = parseManifest(podClient.store.get(manifestUri).content).contentHash;
    expect(h0).not.toBe(h1);
    expect(h1).not.toBe(h2);
  });
});

describe('IdentityPodStore.verifyManifest', () => {
  it('returns ok for a freshly written manifest', async () => {
    const { store } = makeStore();
    await store.init();
    await store.writeResource('devices/device-x.enc', sampleDevice());
    const v = await store.verifyManifest();
    expect(v.ok).toBe(true);
  });

  it('detects a single flipped byte in an .enc resource', async () => {
    const { store, podClient } = makeStore();
    await store.init();
    await store.writeResource('devices/device-x.enc', sampleDevice());
    const uri = 'https://alice.example/onderling/devices/device-x.enc';
    const tampered = podClient.store.get(uri).content;
    // Flip the FIRST character of the ciphertext field (still valid base64
    // but produces a different envelope byte stream).
    const swapped = tampered.replace(/"ct":"./, (m) => {
      // Replace last char of the prefix with a different valid b64 char.
      const lastChar = m[m.length - 1];
      const replacement = lastChar === 'A' ? 'B' : 'A';
      return m.slice(0, -1) + replacement;
    });
    podClient.store.set(uri, { ...podClient.store.get(uri), content: swapped });

    const v = await store.verifyManifest();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('content-hash-mismatch');
    expect(v.expected).toMatch(/^sha256:/);
    expect(v.actual).toMatch(/^sha256:/);
    expect(v.expected).not.toBe(v.actual);
  });

  it('detects a tampered signature', async () => {
    const { store, podClient } = makeStore();
    await store.init();
    const manifestUri = 'https://alice.example/onderling/manifest.ttl';
    const ttl = podClient.store.get(manifestUri).content;
    // Corrupt the signature literal.
    const corrupted = ttl.replace(/dw:signature\s+"[^"]+"/, 'dw:signature         "AAAAAAAA"');
    podClient.store.set(manifestUri, { ...podClient.store.get(manifestUri), content: corrupted });
    const v = await store.verifyManifest();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('signature-invalid');
  });

  it('reports manifest-missing on a fresh container', async () => {
    const { store } = makeStore();
    const v = await store.verifyManifest();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('manifest-missing');
  });
});

describe('IdentityPodStore contentHash determinism', () => {
  it('produces the same hash for the same set written in different orders', async () => {
    const a = makeStore();
    const b = makeStore();
    // Same Bootstrap ⇒ same encryption, but envelopes use random salt+nonce
    // so the BYTES will differ.  contentHash is over bytes — so two
    // independent writes will NOT match.  However, we can compare:
    //   - manifest A's contentHash, then write the same logical records
    //     in different order to A again, recomputed → MUST differ from
    //     A's earlier hash (each rewrite generates new envelope bytes).
    // The deterministic property the spec guarantees is: GIVEN the same
    // on-pod bytes, hash is identical.  We test that property directly:
    await a.store.init();
    await a.store.writeResource('devices/device-1.enc', sampleDevice(1));
    await a.store.writeResource('contacts/contact-1.enc', sampleContact(1));

    // Recompute hash directly via the manifest module → must match the
    // stored manifest's contentHash.
    const { computeContentHash } = await import('../src/identity/identitySerializers/manifest.js');
    const recomputed = await computeContentHash(a.podClient, 'https://alice.example/onderling/');
    const manifestUri = 'https://alice.example/onderling/manifest.ttl';
    const stored = parseManifest(a.podClient.store.get(manifestUri).content).contentHash;
    expect(recomputed).toBe(stored);

    // And: hash is independent of insertion order — copy the EXACT bytes
    // into b's store under different write order, then hash — must match.
    const aRoot = 'https://alice.example/onderling/';
    const bRoot = 'https://alice.example/onderling/';
    const keys = ['devices/device-1.enc', 'contacts/contact-1.enc'];
    // copy in reverse order
    for (const k of [...keys].reverse()) {
      const uri = aRoot + k;
      const v = a.podClient.store.get(uri);
      b.podClient.store.set(bRoot + k, { ...v });
    }
    const bHash = await computeContentHash(b.podClient, bRoot);
    expect(bHash).toBe(recomputed);
  });
});

describe('IdentityPodStore.appendAuthEvent', () => {
  it('appends events and reads them back', async () => {
    const { store } = makeStore();
    await store.init();
    await store.appendAuthEvent({
      event: 'device-paired',
      target: 'ed25519:base58:7uG9...',
      at: '2026-04-28T10:00:00Z',
    });
    await store.appendAuthEvent({
      event: 'grant-issued',
      target: 'tok-3f8a9c',
      at: '2026-04-28T10:15:00Z',
      metadata: { issuedTo: 'https://bob.example/profile/card#me', scope: ['archive.read'] },
    });
    const events = await store.readAuthLog('2026-04-28T12:00:00Z');
    expect(events.length).toBe(2);
    expect(events[0]['dw:event']).toBe('device-paired');
    expect(events[1]['dw:event']).toBe('grant-issued');
    expect(events[1]['dw:metadata']).toEqual({
      issuedTo: 'https://bob.example/profile/card#me',
      scope: ['archive.read'],
    });
    // Each event carries a signature.
    expect(typeof events[0]['dw:signature']).toBe('string');
    expect(typeof events[1]['dw:signature']).toBe('string');
  });

  it('a second store instance (same bootstrap+identity) sees the same events', async () => {
    const { store, podClient, bootstrap, identity } = makeStore();
    await store.init();
    await store.appendAuthEvent({ event: 'device-paired', at: '2026-04-28T10:00:00Z' });
    await store.appendAuthEvent({ event: 'app-authorized', at: '2026-04-28T10:01:00Z' });

    const second = new IdentityPodStore({
      podClient,
      bootstrap,
      identity,
      podRoot: 'https://alice.example/',
    });
    const events = await second.readAuthLog('2026-04-28T12:00:00Z');
    expect(events.map((e) => e['dw:event'])).toEqual(['device-paired', 'app-authorized']);
  });
});

describe('IdentityPodStore manifest LWW retry (Q-B.3)', () => {
  it('retries the manifest write on a single transient ConflictError', async () => {
    const { store, podClient } = makeStore();
    await store.init();

    let injected = false;
    podClient.beforeWrite.push((uri) => {
      if (!injected && uri.endsWith('/manifest.ttl')) {
        injected = true;
        return Object.assign(new Error('simulated conflict'), { code: 'CONFLICT' });
      }
      return null;
    });

    // writeResource will hit one CONFLICT on the manifest write and
    // succeed on retry — no error surfaces to the caller.
    await store.writeResource('devices/device-x.enc', sampleDevice(1));
    expect(injected).toBe(true);

    // Sanity: container is intact.
    const v = await store.verifyManifest();
    expect(v.ok).toBe(true);
  });

  it('surfaces ConflictError to the caller after retry budget exhausted', async () => {
    const { store, podClient } = makeStore();
    await store.init();

    podClient.beforeWrite.push((uri) => {
      if (uri.endsWith('/manifest.ttl')) {
        return Object.assign(new Error('persistent conflict'), { code: 'CONFLICT' });
      }
      return null;
    });

    await expect(store.writeResource('devices/device-x.enc', sampleDevice(1)))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('IdentityPodStore envelope layout', () => {
  it('uses a fresh per-resource salt + nonce on every write', async () => {
    const { store, podClient } = makeStore();
    await store.init();
    await store.writeResource('devices/d1.enc', sampleDevice(1));
    const uri = 'https://alice.example/onderling/devices/d1.enc';
    const env1 = JSON.parse(podClient.store.get(uri).content);
    await store.writeResource('devices/d1.enc', sampleDevice(1));
    const env2 = JSON.parse(podClient.store.get(uri).content);
    expect(env1.salt).not.toBe(env2.salt);
    expect(env1.nonce).not.toBe(env2.nonce);
    expect(env1.alg).toBe('xsalsa20poly1305');
    expect(env1.v).toBe(1);
  });
});

/* ── Naming migration 2026-07-28 — the identity container ───────────────────────────────────────── */

describe('IdentityPodStore — container namespace', () => {
  it('a fresh pod root normalizes into /onderling/', () => {
    const { store } = makeStore({ podRoot: 'https://alice.example/' });
    expect(store.root).toBe('https://alice.example/onderling/');
  });

  it('an EXISTING pre-rename /canopy/ root is honoured as-is (no data move required)', () => {
    const { store } = makeStore({ podRoot: 'https://alice.example/canopy/' });
    expect(store.root).toBe('https://alice.example/canopy/');   // NOT .../canopy/onderling/
  });

  it('an explicit /onderling/ root is not doubled either', () => {
    const { store } = makeStore({ podRoot: 'https://alice.example/onderling/' });
    expect(store.root).toBe('https://alice.example/onderling/');
  });
});
