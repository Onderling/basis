/**
 * migrateVaultToPod.test.js — Track B / B5 unit tests.
 *
 * Uses an in-memory MockPodClient (mirroring B2's pattern) plus a real
 * VaultMemory.  Covers:
 *   - empty vault: nothing migrated; flag IS set; no errors.
 *   - populated vault (with agent-privkey + skip-able namespaces): exactly
 *     one Device record written; skipped entries reported with correct reasons.
 *   - schema validity: the migrated device record decrypts cleanly via
 *     IdentityPodStore.readResource.
 *   - idempotent re-run: second call returns alreadyMigrated:true; no pod writes.
 *   - force re-run: re-migrates; pod sees a second write to the device path.
 *   - dry-run: report computes; no pod writes; flag NOT set.
 *   - partial-failure resume: an injected mid-migration write failure leaves
 *     the flag unset; subsequent run (no force) succeeds.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import nacl from 'tweetnacl';

import { VaultMemory }      from '@onderling/vault';
import { Bootstrap }        from '@onderling/core';
import { AgentIdentity }    from '@onderling/core';
import { IdentityPodStore } from '../src/identity/IdentityPodStore.js';
import {
  migrateVaultToPod,
  MIGRATED_FLAG_KEY,
  SELF_DEVICE_PSEUDO_KEY,
  SKIPPED_NAMESPACES,
  EXACT_SKIP_KEYS,
  buildSelfDeviceMapping,
  mapVaultKeyToSchema,
} from '../src/identity/migrateVaultToPod.js';

// ── MockPodClient ──────────────────────────────────────────────────────────

class MockPodClient {
  constructor() {
    /** @type {Map<string, { content: string, contentType: string, etag?: string }>} */
    this.store      = new Map();
    this.readCalls  = 0;
    this.writeCalls = 0;
    /** @type {Array<(uri: string, content: string, opts: object) => Error|null>} */
    this.beforeWrite = [];
    /** Tracks per-URI write counts for assertions. */
    this.writeCountByUri = new Map();
  }

  async read(uri) {
    this.readCalls++;
    if (!this.store.has(uri)) {
      throw Object.assign(new Error(`MockPodClient: ${uri} not found`), { code: 'NOT_FOUND' });
    }
    const v = this.store.get(uri);
    return { uri, content: v.content, contentType: v.contentType };
  }

  async write(uri, content, opts = {}) {
    this.writeCalls++;
    for (const hook of this.beforeWrite) {
      const err = hook(uri, content, opts);
      if (err) throw err;
    }
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    const etag = `"${text.length}-${Date.now()}-${this.writeCalls}"`;
    this.store.set(uri, { content: text, contentType: opts.contentType || 'text/plain', etag });
    this.writeCountByUri.set(uri, (this.writeCountByUri.get(uri) ?? 0) + 1);
    return { uri, contentType: opts.contentType, etag };
  }

  async list(containerUri) {
    const base = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
    const seen = new Set();
    const entries = [];
    for (const [uri, v] of this.store.entries()) {
      if (!uri.startsWith(base)) continue;
      const rest = uri.slice(base.length);
      if (rest.length === 0) continue;
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) {
        if (!seen.has(uri)) {
          seen.add(uri);
          entries.push({ uri, type: 'resource', etag: v.etag });
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

// ── helpers ────────────────────────────────────────────────────────────────

const POD_ROOT = 'https://alice.example/';

async function makeRig({ withDeviceMeta = false } = {}) {
  const podClient = new MockPodClient();
  const vault     = new VaultMemory();
  const identity  = await AgentIdentity.generate(vault);

  // Use a fresh bootstrap so we have a known mnemonic to feed the migrator;
  // everything downstream re-derives the bootstrap from this phrase.
  const { bootstrap, mnemonic } = Bootstrap.create();

  const deviceMeta = withDeviceMeta
    ? {
        label:        'the author’s test device',
        platformHint: 'linux',
        capabilities: ['push', 'mdns'],
        pairedAt:     '2026-04-01T08:00:00Z',
      }
    : {};

  return { vault, identity, podClient, bootstrap, mnemonic, deviceMeta };
}

function deviceUriFor(bootstrap, identity) {
  const fp = bootstrap.fingerprint(identity.pubKeyBytes);
  return `${POD_ROOT}onderling/devices/device-${fp}.enc`;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('migrateVaultToPod — input validation', () => {
  it('throws if vault is missing or wrong shape', async () => {
    const { identity, podClient, mnemonic } = await makeRig();
    await expect(
      migrateVaultToPod({ identity, podClient, podRoot: POD_ROOT, mnemonic })
    ).rejects.toThrow(/vault/);
  });

  it('throws if identity is missing', async () => {
    const { vault, podClient, mnemonic } = await makeRig();
    await expect(
      migrateVaultToPod({ vault, podClient, podRoot: POD_ROOT, mnemonic })
    ).rejects.toThrow(/identity/);
  });

  it('throws if podClient is missing', async () => {
    const { vault, identity, mnemonic } = await makeRig();
    await expect(
      migrateVaultToPod({ vault, identity, podRoot: POD_ROOT, mnemonic })
    ).rejects.toThrow(/podClient/);
  });

  it('throws if podRoot is missing', async () => {
    const { vault, identity, podClient, mnemonic } = await makeRig();
    await expect(
      migrateVaultToPod({ vault, identity, podClient, mnemonic })
    ).rejects.toThrow(/podRoot/);
  });

  it('throws if mnemonic is missing', async () => {
    const { vault, identity, podClient } = await makeRig();
    await expect(
      migrateVaultToPod({ vault, identity, podClient, podRoot: POD_ROOT })
    ).rejects.toThrow(/mnemonic/);
  });
});

describe('migrateVaultToPod — empty-ish vault', () => {
  it('migrates only the synthetic self-device; sets the flag', async () => {
    // Vault has only `agent-privkey` (created by AgentIdentity.generate).
    const { vault, identity, podClient, mnemonic } = await makeRig();

    const report = await migrateVaultToPod({
      vault, identity, podClient, podRoot: POD_ROOT, mnemonic,
    });

    expect(report.alreadyMigrated).toBe(false);
    expect(report.dryRun).toBe(false);
    expect(report.migrated).toHaveLength(1);
    expect(report.migrated[0]).toMatch(/^__onderling:self-device → devices\/device-[0-9a-f]{16}\.enc$/);

    // agent-privkey is in EXACT_SKIP_KEYS, should be reported as skipped.
    const skippedKeys = report.skipped.map((s) => s.key);
    expect(skippedKeys).toContain('agent-privkey');
    const agentSkip = report.skipped.find((s) => s.key === 'agent-privkey');
    expect(agentSkip.reason).toBe('private-seed-not-pod-content');

    // Flag is set on the vault.
    const flagRaw = await vault.get(MIGRATED_FLAG_KEY);
    expect(flagRaw).toBeTruthy();
    const flag = JSON.parse(flagRaw);
    expect(typeof flag.at).toBe('number');
  });
});

describe('migrateVaultToPod — populated vault', () => {
  it('writes exactly one Device record; skips namespaces with reasons', async () => {
    const { vault, identity, podClient, mnemonic, deviceMeta } = await makeRig({ withDeviceMeta: true });

    // Sprinkle skip-able namespaces.
    await vault.set('solid-oidc:https://alice.example/profile/card#me:access_token', 'xyz');
    await vault.set('oauth:dropbox:alice', JSON.stringify({ access_token: 'a' }));
    await vault.set('inrupt:internal-thing', '1');
    await vault.set('identity-cache:devices/device-abc.enc', JSON.stringify({ record: {} }));
    await vault.set('group-proof:my-block', JSON.stringify({ proof: 1 }));
    await vault.set('group-admin:my-block', JSON.stringify([]));
    await vault.set('peer:somepeer', '{}');
    await vault.set('token:abc:archive.read', '{}');
    await vault.set('revoked:abc', '1');
    await vault.set('trust:somepubkey', '2');
    await vault.set('a2a-token:https://bob.example/', 'tk');

    // An entry with no mapping should be reported `no-mapping-defined`.
    await vault.set('weird-unknown-key', 'value');

    const report = await migrateVaultToPod({
      vault, identity, podClient, podRoot: POD_ROOT, mnemonic, deviceMeta,
    });

    expect(report.alreadyMigrated).toBe(false);
    expect(report.migrated).toHaveLength(1);

    // Skipped reasons.
    const skippedByKey = Object.fromEntries(report.skipped.map((s) => [s.key, s.reason]));
    expect(skippedByKey['solid-oidc:https://alice.example/profile/card#me:access_token']).toBe('namespace-skipped');
    expect(skippedByKey['oauth:dropbox:alice']).toBe('namespace-skipped');
    expect(skippedByKey['inrupt:internal-thing']).toBe('namespace-skipped');
    expect(skippedByKey['identity-cache:devices/device-abc.enc']).toBe('namespace-skipped');
    expect(skippedByKey['group-proof:my-block']).toBe('namespace-skipped');
    expect(skippedByKey['peer:somepeer']).toBe('namespace-skipped');
    expect(skippedByKey['weird-unknown-key']).toBe('no-mapping-defined');
    expect(skippedByKey['agent-privkey']).toBe('private-seed-not-pod-content');

    // Pod has a manifest + the device record.
    const deviceUri = deviceUriFor(Bootstrap.fromMnemonic(mnemonic), identity);
    expect(podClient.store.has(deviceUri)).toBe(true);
    expect(podClient.store.has(`${POD_ROOT}onderling/manifest.ttl`)).toBe(true);
  });

  it('the migrated device record reads back through IdentityPodStore', async () => {
    const { vault, identity, podClient, mnemonic, deviceMeta } = await makeRig({ withDeviceMeta: true });

    await migrateVaultToPod({
      vault, identity, podClient, podRoot: POD_ROOT, mnemonic, deviceMeta,
    });

    // Read the record back via a fresh IdentityPodStore.
    const bootstrap = Bootstrap.fromMnemonic(mnemonic);
    const store = new IdentityPodStore({ podClient, bootstrap, identity, podRoot: POD_ROOT });
    const fp = bootstrap.fingerprint(identity.pubKeyBytes);
    const record = await store.readResource(`devices/device-${fp}.enc`);

    expect(record['@type']).toBe('dw:Device');
    expect(record['dw:pubkey']).toBe(identity.pubKey);
    expect(record['dw:label']).toBe('the author’s test device');
    expect(record['dw:platformHint']).toBe('linux');
    expect(record['dw:capabilities']).toEqual(['push', 'mdns']);
    expect(record['dw:retired']).toBe(false);
    expect(record['dw:bootstrapKeyFingerprint']).toBe(bootstrap.fingerprint());
    expect(record['dw:pairedAt']).toBe('2026-04-01T08:00:00.000Z');
    expect(typeof record['dw:lastSeen']).toBe('string');

    // Manifest verifies.
    const v = await store.verifyManifest();
    expect(v.ok).toBe(true);
  });

  it('uses safe defaults when deviceMeta is omitted', async () => {
    const { vault, identity, podClient, mnemonic } = await makeRig();
    await migrateVaultToPod({ vault, identity, podClient, podRoot: POD_ROOT, mnemonic });

    const bootstrap = Bootstrap.fromMnemonic(mnemonic);
    const store = new IdentityPodStore({ podClient, bootstrap, identity, podRoot: POD_ROOT });
    const fp = bootstrap.fingerprint(identity.pubKeyBytes);
    const record = await store.readResource(`devices/device-${fp}.enc`);

    expect(record['dw:label']).toBe('Migrated device');
    expect(record['dw:platformHint']).toBe('unknown');
    expect(record['dw:capabilities']).toEqual([]);
    expect(record['dw:retired']).toBe(false);
  });
});

describe('migrateVaultToPod — idempotency', () => {
  it('second call returns alreadyMigrated:true and writes nothing', async () => {
    const { vault, identity, podClient, mnemonic } = await makeRig();

    await migrateVaultToPod({ vault, identity, podClient, podRoot: POD_ROOT, mnemonic });
    const writesAfterFirst = podClient.writeCalls;

    const report = await migrateVaultToPod({
      vault, identity, podClient, podRoot: POD_ROOT, mnemonic,
    });

    expect(report.alreadyMigrated).toBe(true);
    expect(report.migrated).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(typeof report.migratedAt).toBe('number');
    // No additional pod writes.
    expect(podClient.writeCalls).toBe(writesAfterFirst);
  });

  it('force:true re-runs and writes the device record again', async () => {
    const { vault, identity, podClient, mnemonic } = await makeRig();

    await migrateVaultToPod({ vault, identity, podClient, podRoot: POD_ROOT, mnemonic });

    const bootstrap = Bootstrap.fromMnemonic(mnemonic);
    const deviceUri = deviceUriFor(bootstrap, identity);
    const writesAfterFirst = podClient.writeCountByUri.get(deviceUri) ?? 0;
    expect(writesAfterFirst).toBe(1);

    const report = await migrateVaultToPod({
      vault, identity, podClient, podRoot: POD_ROOT, mnemonic, force: true,
    });

    expect(report.alreadyMigrated).toBe(false);
    expect(report.migrated).toHaveLength(1);
    expect(podClient.writeCountByUri.get(deviceUri)).toBe(2);
  });
});

describe('migrateVaultToPod — dry run', () => {
  it('reports what would be migrated but writes nothing; flag NOT set', async () => {
    const { vault, identity, podClient, mnemonic } = await makeRig();
    await vault.set('weird-unknown-key', 'x');

    const writesBefore = podClient.writeCalls;
    const report = await migrateVaultToPod({
      vault, identity, podClient, podRoot: POD_ROOT, mnemonic, dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.alreadyMigrated).toBe(false);
    expect(report.migrated).toHaveLength(1);
    expect(report.skipped.find((s) => s.key === 'weird-unknown-key').reason).toBe('no-mapping-defined');

    expect(podClient.writeCalls).toBe(writesBefore);

    // Flag NOT set.
    const flag = await vault.get(MIGRATED_FLAG_KEY);
    expect(flag).toBeNull();
  });
});

describe('migrateVaultToPod — partial-failure resume', () => {
  it('a mid-migration write failure leaves the flag unset; retry succeeds', async () => {
    const { vault, identity, podClient, mnemonic } = await makeRig();

    // Inject ONE failure on the very next device write, then clear.
    let failures = 0;
    const hook = (uri) => {
      if (uri.endsWith('.enc') && uri.includes('/devices/') && failures === 0) {
        failures++;
        return Object.assign(new Error('simulated transient pod failure'), { code: 'NETWORK' });
      }
      return null;
    };
    podClient.beforeWrite.push(hook);

    await expect(
      migrateVaultToPod({ vault, identity, podClient, podRoot: POD_ROOT, mnemonic })
    ).rejects.toThrow(/writeResource/);

    // Flag must NOT have been set.
    expect(await vault.get(MIGRATED_FLAG_KEY)).toBeNull();
    expect(failures).toBe(1);

    // Re-run without force — must succeed (no longer alreadyMigrated, hook
    // only fails once).
    const report = await migrateVaultToPod({
      vault, identity, podClient, podRoot: POD_ROOT, mnemonic,
    });
    expect(report.alreadyMigrated).toBe(false);
    expect(report.migrated).toHaveLength(1);

    // Flag now set.
    expect(await vault.get(MIGRATED_FLAG_KEY)).toBeTruthy();
  });
});

// ── unit tests for the mapping helpers ────────────────────────────────────

describe('buildSelfDeviceMapping', () => {
  it('produces a schema-shaped Device record with sensible defaults', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const { bootstrap } = Bootstrap.create();

    const { path, transform } = buildSelfDeviceMapping({ identity, bootstrap });
    expect(path).toMatch(/^devices\/device-[0-9a-f]{16}\.enc$/);

    const rec = transform(null);
    expect(rec).toMatchObject({
      '@type':          'dw:Device',
      'dw:pubkey':      identity.pubKey,
      'dw:label':       'Migrated device',
      'dw:retired':     false,
      'dw:platformHint': 'unknown',
      'dw:capabilities': [],
    });
    expect(rec['dw:bootstrapKeyFingerprint']).toBe(bootstrap.fingerprint());
    expect(typeof rec['dw:pairedAt']).toBe('string');
    expect(typeof rec['dw:lastSeen']).toBe('string');
  });

  it('threads deviceMeta through the transform', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const { bootstrap } = Bootstrap.create();

    const { transform } = buildSelfDeviceMapping({
      identity, bootstrap,
      deviceMeta: {
        label: 'Pixel 8',
        platformHint: 'android',
        capabilities: ['push', 'ble'],
        pairedAt: 1_700_000_000_000,
      },
    });
    const rec = transform();
    expect(rec['dw:label']).toBe('Pixel 8');
    expect(rec['dw:platformHint']).toBe('android');
    expect(rec['dw:capabilities']).toEqual(['push', 'ble']);
    expect(rec['dw:pairedAt']).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('rejects invalid identity / bootstrap', () => {
    expect(() => buildSelfDeviceMapping({})).toThrow();
    expect(() => buildSelfDeviceMapping({ identity: { pubKey: 'x' } })).toThrow(/bootstrap/);
  });
});

describe('mapVaultKeyToSchema', () => {
  it('returns null for unknown keys', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const { bootstrap } = Bootstrap.create();
    expect(mapVaultKeyToSchema('completely-unknown', { identity, bootstrap })).toBeNull();
    expect(mapVaultKeyToSchema('peer:abc', { identity, bootstrap })).toBeNull();
  });

  it('returns a self-device mapping for the pseudo key', async () => {
    const vault = new VaultMemory();
    const identity = await AgentIdentity.generate(vault);
    const { bootstrap } = Bootstrap.create();
    const m = mapVaultKeyToSchema(SELF_DEVICE_PSEUDO_KEY, { identity, bootstrap });
    expect(m).not.toBeNull();
    expect(m.path).toMatch(/^devices\/device-/);
  });
});

describe('exported constants', () => {
  it('SKIPPED_NAMESPACES covers the documented set', () => {
    for (const ns of [
      'solid-oidc:', 'oauth:', 'inrupt:', 'identity-cache:',
      'group-proof:', 'group-admin:', 'peer:', 'token:',
      'revoked:', 'trust:', 'a2a-token:',
    ]) {
      expect(SKIPPED_NAMESPACES).toContain(ns);
    }
  });

  it('EXACT_SKIP_KEYS includes private seed + bearer + flag', () => {
    expect(EXACT_SKIP_KEYS.has('agent-privkey')).toBe(true);
    expect(EXACT_SKIP_KEYS.has('solid-pod-token')).toBe(true);
    expect(EXACT_SKIP_KEYS.has(MIGRATED_FLAG_KEY)).toBe(true);
  });
});
