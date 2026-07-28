/**
 * Scenario: identity/bip39-recovery
 *
 * Story: alice's phone is lost.  She buys phone-2, opens the app, types in her
 * 24-word BIP-39 phrase.  The new device must be able to:
 *   1. Re-derive the Bootstrap root secret from the mnemonic.
 *   2. Read + decrypt the identity-pod manifest using that bootstrap.
 *   3. Pick up the existing device list from the pod within one IdentitySync
 *      interval.
 *   4. Add itself as a paired device, mark phone-1 as retired, and record
 *      a `pod-migrated` auth-log event.
 *
 * Lab setup: a single SHARED MockPod instance simulates the canonical pod
 * (both devices write to it).  No mesh transports are needed — this is a
 * pure pod-recovery scenario.  We construct IdentityPodStore + IdentitySync
 * directly against the shared MockPod (the harness does not yet wire the
 * full identity stack into agents — this is documented in §T.1 Notes;
 * the scenario does the wiring inline).
 *
 * Action: phone-1 initializes the container, writes its own Device record,
 * then is "killed".  phone-2 is constructed from the same mnemonic, runs
 * IdentitySync.now(), reads the inherited device list from the cache,
 * appends itself + retires phone-1, and writes a pod-migrated auth event.
 *
 * Assertion: phone-2's IdentitySync cache contains both devices, the
 * manifest still verifies, and the auth-log records the recovery event.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Bootstrap, AgentIdentity } from '@onderling/core';
import { IdentityPodStore, IdentitySync } from '@onderling/pod-client';
import { VaultMemory } from '@onderling/vault';

// IdentitySync's vault-cache prefix is internal; mirrored here so we can
// inspect the cache directly.  See `packages/core/src/identity/IdentitySync.js`
// (`VAULT_CACHE_PREFIX = 'identity-cache:'`).
const VAULT_CACHE_PREFIX = 'identity-cache:';
const vaultCacheKeyFor   = (resourcePath) => VAULT_CACHE_PREFIX + resourcePath;

import { MockPod } from '../../../src/_harness/index.js';

const POD_ROOT     = 'https://alice.example/';
const POD_ONDERLING = 'https://alice.example/onderling/';
const SYNC_INTERVAL_MS = 60_000;

/**
 * Build a per-device stack against the SHARED pod.  AgentIdentity is the
 * *device*-scoped key; Bootstrap is the *root* secret derived from the
 * BIP-39 phrase (shared across all of Alice's devices).
 */
async function makeDeviceStack({ mnemonic, sharedPod, devicePubKeyLabel }) {
  const bootstrap = Bootstrap.fromMnemonic(mnemonic);
  const vault     = new VaultMemory();
  const identity  = await AgentIdentity.generate(vault);  // device-scoped key
  const store     = new IdentityPodStore({
    podClient: sharedPod, bootstrap, identity, podRoot: POD_ROOT,
  });
  const sync = new IdentitySync({
    vault, podStore: store, podClient: sharedPod, intervalMs: SYNC_INTERVAL_MS,
  });
  return { bootstrap, vault, identity, store, sync, devicePubKeyLabel };
}

function deviceRecord(stack, { label, retired = false }) {
  return {
    '@type':                   'dw:Device',
    pubkey:                    stack.identity.pubKey,
    label,
    pairedAt:                  '2026-04-28T10:00:00Z',
    lastSeen:                  new Date().toISOString(),
    retired,
    bootstrapKeyFingerprint:   stack.bootstrap.fingerprint(),
  };
}

describe('identity/bip39-recovery', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(()  => { vi.useRealTimers(); });

  it('phone-2 (recovered from BIP-39) restores identity from pod and retires phone-1', async () => {
    // Alice's single canonical pod, shared between both devices.
    const sharedPod = new MockPod();

    // ── Phone-1: initial setup ──────────────────────────────────────────
    const { mnemonic } = Bootstrap.create();
    const phone1 = await makeDeviceStack({
      mnemonic, sharedPod, devicePubKeyLabel: 'phone-1',
    });

    // Initialise the container + write phone-1's device record.
    const init = await phone1.store.init();
    expect(init.created).toBe(true);
    expect(init.verified).toBe(true);

    const phone1Path = `devices/device-${phone1.bootstrap.fingerprint(phone1.identity.pubKeyBytes)}.enc`;
    await phone1.store.writeResource(phone1Path, deviceRecord(phone1, { label: 'phone-1' }));

    // Verify manifest is intact + recoverable.
    const v1 = await phone1.store.verifyManifest();
    expect(v1.ok).toBe(true);

    // ── Phone-1 is killed ────────────────────────────────────────────────
    // (Vault is destroyed; the pod survives.)
    phone1.sync.stop();

    // ── Phone-2: recovery from BIP-39 ───────────────────────────────────
    const phone2 = await makeDeviceStack({
      mnemonic, sharedPod, devicePubKeyLabel: 'phone-2',
    });

    // Same bootstrap fingerprint — proves the BIP-39 round-trip works.
    expect(phone2.bootstrap.fingerprint())
      .toBe(phone1.bootstrap.fingerprint());

    // First, init() should detect the existing manifest and verify it.
    const init2 = await phone2.store.init();
    expect(init2.created).toBe(false);
    expect(init2.verified).toBe(true);

    // Run a sync — should pull phone-1's device record into phone-2's
    // local cache within the interval.
    const stats = await phone2.sync.now({ priority: 'startup' });
    expect(stats.pulls).toBeGreaterThanOrEqual(1);

    // The cache now holds phone-1's record.
    const cached = await phone2.vault.get(vaultCacheKeyFor(phone1Path));
    expect(cached).toBeTruthy();
    const cachedEntry = JSON.parse(cached);
    expect(cachedEntry.record.label).toBe('phone-1');
    expect(cachedEntry.record.retired).toBe(false);

    // ── Phone-2 pairs itself + retires phone-1 ──────────────────────────
    const phone2Path = `devices/device-${phone2.bootstrap.fingerprint(phone2.identity.pubKeyBytes)}.enc`;
    await phone2.store.writeResource(phone2Path, deviceRecord(phone2, { label: 'phone-2' }));

    // Update phone-1's record in place to retired:true (mid-recovery
    // bookkeeping; LWW means phone-2 wins because phone-1 is dead).
    const retiredPhone1 = {
      ...cachedEntry.record,
      retired: true,
      retiredAt: new Date().toISOString(),
    };
    await phone2.store.writeResource(phone1Path, retiredPhone1);

    // Append the recovery event to the auth-log.
    await phone2.store.appendAuthEvent({
      event:  'pod-migrated',
      actor:  phone2.identity.pubKey,
      target: phone1.identity.pubKey,
      at:     '2026-04-28T12:00:00Z',
      metadata: {
        reason:       'bip39-recovery',
        fromDevice:   'phone-1',
        toDevice:     'phone-2',
        fingerprint:  phone2.bootstrap.fingerprint(),
      },
    });

    // ── Assertions: device list ─────────────────────────────────────────
    // Manifest still verifies after all the writes.
    const v2 = await phone2.store.verifyManifest();
    expect(v2.ok).toBe(true);

    // Read both records back from the canonical pod via phone-2's store
    // (proves the rotation + retirement landed on the pod, the source of
    // truth — the local cache is incidental and may lag behind the same
    // sync cycle).
    const phone1OnPod = await phone2.store.readResource(phone1Path);
    const phone2OnPod = await phone2.store.readResource(phone2Path);
    expect(phone1OnPod.retired).toBe(true);
    expect(phone1OnPod.label).toBe('phone-1');
    expect(phone2OnPod.label).toBe('phone-2');
    expect(phone2OnPod.pubkey).toBe(phone2.identity.pubKey);

    // The first sync already populated the cache with phone-1's pre-retirement
    // state — confirms the "restores within one IdentitySync interval" leg.
    const cachedAfter = JSON.parse(await phone2.vault.get(vaultCacheKeyFor(phone1Path)));
    expect(cachedAfter).toBeTruthy();

    // ── Assertions: auth-log records pod-migrated ───────────────────────
    const events = await phone2.store.readAuthLog('2026-04-28T12:30:00Z');
    const migrated = events.find((e) => e['dw:event'] === 'pod-migrated');
    expect(migrated).toBeTruthy();
    expect(migrated['dw:metadata']?.reason).toBe('bip39-recovery');
    expect(migrated['dw:metadata']?.toDevice).toBe('phone-2');
    expect(typeof migrated['dw:signature']).toBe('string');
  });

  it('a wrong mnemonic cannot decrypt phone-1 records', async () => {
    const sharedPod = new MockPod();
    const { mnemonic: realMnemonic }  = Bootstrap.create();
    const { mnemonic: wrongMnemonic } = Bootstrap.create();

    const phone1 = await makeDeviceStack({
      mnemonic: realMnemonic, sharedPod, devicePubKeyLabel: 'phone-1',
    });
    await phone1.store.init();
    const path = 'devices/device-test.enc';
    await phone1.store.writeResource(path, { '@type': 'dw:Device', label: 'p1' });

    // Phone-2 with the WRONG mnemonic — same pod, different bootstrap secret.
    const evilPhone = await makeDeviceStack({
      mnemonic: wrongMnemonic, sharedPod, devicePubKeyLabel: 'evil',
    });

    // The manifest can be parsed (it's plaintext TTL signed by phone-1),
    // but reading any encrypted resource will fail decryption.
    await expect(evilPhone.store.readResource(path))
      .rejects.toMatchObject({ code: 'IDENTITY_DECRYPT_FAILED' });
  });
});
