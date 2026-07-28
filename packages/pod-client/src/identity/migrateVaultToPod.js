/**
 * migrateVaultToPod — Track B / B5.
 *
 * One-shot migration utility that pushes existing local-only Vault contents
 * to a fresh pod via {@link IdentityPodStore}.  Intended to be run ONCE per
 * device when a user migrates from the pre-Track-B local-only identity model
 * to the Track B vault+pod sync model.  After successful migration the pod
 * becomes the canonical identity store; the vault remains the live cache
 * (per B3 / `IdentitySync`).
 *
 * --- v1 scope ----------------------------------------------------------------
 *
 * **Device identity only.**  The v1 migrator writes ONE record to the pod —
 * a `dw:Device` record for the device's own AgentIdentity, derived from the
 * vault's `'agent-privkey'` blob.  All other vault namespaces (group-proof,
 * peer:*, app-permission:*, oauth:*, solid-oidc:*, identity-cache:*, …) are
 * **skipped with an explicit reason** logged into the report.  Follow-up
 * tracks can extend `mapVaultKeyToSchema` to handle additional types.
 *
 * Rationale: the existing local-only vault holds a mix of (a) cryptographic
 * material the pod must not see (private seeds, OAuth refresh tokens), (b)
 * already-pod-derived caches (B3's `identity-cache:*`), and (c) records
 * with a clear schema mapping (just the device record, in v1).  A narrow
 * v1 with a clearly-named `mapVaultKeyToSchema` extension point is safer
 * than a best-effort full migration.
 *
 * --- idempotency + safety ---------------------------------------------------
 *
 * Idempotent: writes a `'identity-migration:migrated-at'` flag to the vault
 * on success; subsequent calls short-circuit unless `force: true`.
 *
 * Safe: vault entries are NOT deleted after migration.  This is by design —
 * if the pod migration is incomplete or buggy, the vault still has the
 * source data.  A future sweep can clear vault namespaces once confidence
 * is established.
 *
 * Partial-failure resume: the flag is written ONLY after every step
 * succeeds.  If a write fails mid-migration the flag stays unset and the
 * caller can re-run without `force` once the issue is fixed.
 *
 * --- Usage ------------------------------------------------------------------
 *
 *   import { migrateVaultToPod, AgentIdentity, Bootstrap } from '@onderling/core';
 *
 *   const identity = await AgentIdentity.restore(vault);
 *   const report   = await migrateVaultToPod({
 *     vault, identity, podClient, podRoot, mnemonic,
 *     dryRun: false,
 *   });
 *   console.log(report);
 *
 * Tracked in `coding-plans/track-B-identity-sync.md` §B5.
 */

import { IdentityPodStore } from './IdentityPodStore.js';
import { Bootstrap }        from '@onderling/core';

/** Vault key the migrator uses to record idempotency. */
export const MIGRATED_FLAG_KEY = 'identity-migration:migrated-at';

/**
 * Synthetic dispatch token.  The migration loop ALWAYS visits this once
 * per call — it represents the running device's own AgentIdentity, which
 * is NOT a regular vault entry (the seed at `agent-privkey` is local-only
 * material and stays in the vault).
 */
export const SELF_DEVICE_PSEUDO_KEY = '__onderling:self-device';   // in-memory dispatch token, never persisted

/**
 * Vault-key namespace prefixes that are explicitly NOT migrated.  Callers
 * who add a new vault namespace should decide whether it belongs here, in
 * `mapVaultKeyToSchema`, or in `EXACT_SKIP_KEYS`.
 *
 * Categories:
 *   - `solid-oidc:`    — Solid OIDC tokens (A2 / SolidVault).  Per-device auth.
 *   - `oauth:`         — F1 / OAuthVault tokens.  Service auth, not identity.
 *   - `inrupt:`        — Inrupt internal storage (handed in by their SDK).
 *   - `identity-cache:` — B3's IdentitySync cache.  Already pod-derived.
 *   - `group-proof:`   — D3 group proofs.  Could map to grants/held in v2;
 *                        skipped in v1 to keep scope tight.
 *   - `group-admin:`   — D3 group-admin records.  Same rationale as above.
 *   - `peer:`          — Peer state (LiveSync etc.).  Not identity-bearing.
 *   - `token:`         — TokenRegistry capability tokens (held side).  Map
 *                        candidate for grants/held; v1 skips.
 *   - `revoked:`       — Revocation marks for the local TokenRegistry; not pod content.
 *   - `trust:`         — TrustRegistry per-peer trust tier; v2 candidate.
 *   - `a2a-token:`     — A2A peer bearer tokens; service auth, skip.
 */
export const SKIPPED_NAMESPACES = Object.freeze([
  'solid-oidc:',
  'oauth:',
  'inrupt:',
  'identity-cache:',
  'group-proof:',
  'group-admin:',
  'peer:',
  'token:',
  'revoked:',
  'trust:',
  'a2a-token:',
]);

/**
 * Exact vault keys we skip (not namespaced).
 *
 *   - `agent-privkey`            — the device's private seed.  MUST NOT go
 *                                   to the pod; it's local-secret material.
 *                                   The migrator instead synthesizes a
 *                                   `dw:Device` record from the public side
 *                                   of the AgentIdentity passed in (via
 *                                   `SELF_DEVICE_PSEUDO_KEY`).
 *   - `solid-pod-token`          — Solid OIDC bearer.  Auth, not identity.
 *   - `MIGRATED_FLAG_KEY`        — the idempotency marker itself.
 */
export const EXACT_SKIP_KEYS = Object.freeze(new Set([
  'agent-privkey',
  'solid-pod-token',
  MIGRATED_FLAG_KEY,
]));

/**
 * Run a one-shot Vault → pod migration.
 *
 * @param {object}        opts
 * @param {object}        opts.vault          Vault-shaped { get, set, list }.
 * @param {object}        opts.identity       AgentIdentity instance (the
 *                                              device's own identity; its
 *                                              public key becomes the pod's
 *                                              first device record).
 * @param {object}        opts.podClient      `@onderling/pod-client` PodClient.
 * @param {string}        opts.podRoot        Pod root URI (or already-rooted
 *                                              `<base>/canopy/`).
 * @param {string}        opts.mnemonic       BIP-39 phrase the user wrote
 *                                              down at first-run; used to
 *                                              derive the bootstrap secret.
 * @param {object}        [opts.deviceMeta]   Optional extras for the Device
 *                                              record:
 *                                                { label, platformHint, capabilities, pairedAt }.
 *                                              Sensible defaults are used
 *                                              when fields are missing.
 * @param {boolean}       [opts.dryRun=false] Skip pod writes; report only.
 *                                              Flag is NOT set in dry-run.
 * @param {boolean}       [opts.force=false]  Re-run even if the migrated-at
 *                                              flag is already present.
 * @returns {Promise<{
 *   migrated:        Array<string>,
 *   skipped:         Array<{ key: string, reason: string }>,
 *   alreadyMigrated: boolean,
 *   migratedAt?:     number,
 *   dryRun:          boolean,
 * }>}
 */
export async function migrateVaultToPod({
  vault,
  identity,
  podClient,
  podRoot,
  mnemonic,
  deviceMeta = {},
  dryRun = false,
  force   = false,
} = {}) {
  if (!vault || typeof vault.get !== 'function' || typeof vault.set !== 'function' || typeof vault.list !== 'function') {
    throw new Error('migrateVaultToPod: vault must be a Vault-shaped { get, set, list } object');
  }
  if (!identity || typeof identity.pubKey !== 'string') {
    throw new Error('migrateVaultToPod: identity must be an AgentIdentity (with .pubKey)');
  }
  if (!podClient || typeof podClient.read !== 'function') {
    throw new Error('migrateVaultToPod: podClient is required');
  }
  if (typeof podRoot !== 'string' || podRoot.length === 0) {
    throw new Error('migrateVaultToPod: podRoot must be a non-empty string');
  }
  if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
    throw new Error('migrateVaultToPod: mnemonic must be a non-empty string');
  }

  // Idempotency check.
  const existingFlagRaw = await vault.get(MIGRATED_FLAG_KEY);
  if (existingFlagRaw && !force) {
    let parsed;
    try { parsed = JSON.parse(existingFlagRaw); } catch { parsed = {}; }
    return {
      migrated:        [],
      skipped:         [],
      alreadyMigrated: true,
      migratedAt:      typeof parsed?.at === 'number' ? parsed.at : null,
      dryRun,
    };
  }

  const bootstrap = Bootstrap.fromMnemonic(mnemonic);
  const podStore  = new IdentityPodStore({ podClient, bootstrap, identity, podRoot });

  // Materialize the container before any writes.  init() is idempotent —
  // an existing manifest (e.g. from a partially-failed previous run) is
  // left alone if it verifies.
  if (!dryRun) {
    await podStore.init();
  }

  // The migration loop ALWAYS visits the synthetic self-device key first
  // (its mapping synthesizes the device record from the AgentIdentity);
  // then walks the actual vault.
  const realKeys = await vault.list();
  const allKeys  = [SELF_DEVICE_PSEUDO_KEY, ...realKeys];

  const migrated = [];
  const skipped  = [];

  for (const key of allKeys) {
    if (EXACT_SKIP_KEYS.has(key)) {
      skipped.push({ key, reason: reasonForExactSkip(key) });
      continue;
    }
    if (SKIPPED_NAMESPACES.some((ns) => key.startsWith(ns))) {
      skipped.push({ key, reason: 'namespace-skipped' });
      continue;
    }

    const mapping = mapVaultKeyToSchema(key, { identity, bootstrap, deviceMeta });
    if (!mapping) {
      skipped.push({ key, reason: 'no-mapping-defined' });
      continue;
    }

    let value = null;
    if (key !== SELF_DEVICE_PSEUDO_KEY) {
      try {
        const raw = await vault.get(key);
        value = raw == null ? null : safeJsonParse(raw);
      } catch (cause) {
        throw Object.assign(
          new Error(`migrateVaultToPod: failed to read vault key '${key}': ${cause?.message ?? cause}`),
          { code: 'IDENTITY_MIGRATION_VAULT_READ', cause },
        );
      }
    }

    const record = mapping.transform(value);

    if (!dryRun) {
      try {
        await podStore.writeResource(mapping.path, record);
      } catch (cause) {
        // Re-throw with context but keep the original code (e.g. CONFLICT)
        // intact so callers can detect retryable errors.  CRITICAL: the
        // flag is NOT set in this branch, so the caller can re-run without
        // `force` once the issue is fixed (partial-failure resume).
        throw Object.assign(
          new Error(`migrateVaultToPod: writeResource('${mapping.path}') failed: ${cause?.message ?? cause}`),
          { code: cause?.code ?? 'IDENTITY_MIGRATION_WRITE', cause },
        );
      }
    }

    migrated.push(`${key} → ${mapping.path}`);
  }

  if (!dryRun) {
    await vault.set(MIGRATED_FLAG_KEY, JSON.stringify({ at: Date.now() }));
  }

  return { migrated, skipped, alreadyMigrated: false, dryRun };
}

// ── Mapping table ───────────────────────────────────────────────────────────

/**
 * Map a vault key + value to a pod schema record.  Returns null if no
 * mapping is defined (caller logs + skips).
 *
 * **v1 supports only:** the device's own AgentIdentity → Device record
 * (dispatched via `SELF_DEVICE_PSEUDO_KEY`).  Extension points for
 * follow-ups are deliberate: new branches for `peer:`, `app-permission:`,
 * `group-proof:` etc. should be added here, paired with removing the
 * matching prefix from `SKIPPED_NAMESPACES`.
 *
 * @param {string} key  vault key.
 * @param {object} ctx  { identity, bootstrap, deviceMeta }.
 * @returns {{ path: string, transform: (value: any) => object } | null}
 */
export function mapVaultKeyToSchema(key, { identity, bootstrap, deviceMeta = {} } = {}) {
  if (key === SELF_DEVICE_PSEUDO_KEY) {
    return buildSelfDeviceMapping({ identity, bootstrap, deviceMeta });
  }
  // Future v2 candidates (each requires removing the matching prefix from
  // SKIPPED_NAMESPACES + writing schema-conformant transforms):
  //
  //   if (key.startsWith('peer:'))            return buildContactMapping(key, ctx);
  //   if (key.startsWith('app-permission:'))  return buildAppPermissionMapping(key, ctx);
  //   if (key.startsWith('group-proof:'))     return buildGrantHeldMapping(key, ctx);
  //   if (key.startsWith('group-admin:'))     return buildGrantIssuedMapping(key, ctx);
  //
  return null;
}

/**
 * Build a `mapVaultKeyToSchema`-shaped mapping for the running device's
 * own identity.  Exported so the migration loop can call it directly; the
 * dispatch via `mapVaultKeyToSchema` is kept for symmetry with future
 * extensions.
 *
 * The Device record's @type / field names mirror `Design-v3/identity-pod-schema.md`:
 *
 *   {
 *     '@type':                       'dw:Device',
 *     'dw:pubkey':                   identity.pubKey,
 *     'dw:label':                    deviceMeta.label ?? 'Migrated device',
 *     'dw:pairedAt':                 deviceMeta.pairedAt ?? <now>,
 *     'dw:lastSeen':                 <now>,
 *     'dw:retired':                  false,
 *     'dw:platformHint':             deviceMeta.platformHint ?? 'unknown',
 *     'dw:capabilities':             deviceMeta.capabilities ?? [],
 *     'dw:bootstrapKeyFingerprint':  bootstrap.fingerprint(),
 *   }
 *
 * The fingerprint is the pubkey-derived 16-hex-char string per schema
 * §Container layout.  Note: the device's own pubkey is the AgentIdentity
 * pubkey (separate from the bootstrap-derived pubkey); we use IT for the
 * file path and the `dw:pubkey` field, while `dw:bootstrapKeyFingerprint`
 * uses the BOOTSTRAP-derived fingerprint to tie the device to the owner.
 */
export function buildSelfDeviceMapping({ identity, bootstrap, deviceMeta = {} } = {}) {
  if (!identity || typeof identity.pubKey !== 'string') {
    throw new Error('buildSelfDeviceMapping: identity must be an AgentIdentity');
  }
  if (!(bootstrap instanceof Bootstrap)) {
    throw new Error('buildSelfDeviceMapping: bootstrap must be a Bootstrap');
  }
  // Device fingerprint is over the device's pubkey bytes — schema §Container.
  // AgentIdentity exposes raw bytes via .pubKeyBytes.
  const deviceFp = bootstrap.fingerprint(identity.pubKeyBytes);
  const path = `devices/device-${deviceFp}.enc`;

  return {
    path,
    transform: () => {
      const nowIso = new Date().toISOString();
      return {
        '@type':                      'dw:Device',
        'dw:pubkey':                  identity.pubKey,
        'dw:label':                   typeof deviceMeta.label === 'string'
                                        ? deviceMeta.label
                                        : 'Migrated device',
        'dw:pairedAt':                normalizeIso(deviceMeta.pairedAt) ?? nowIso,
        'dw:lastSeen':                nowIso,
        'dw:retired':                 false,
        'dw:platformHint':            typeof deviceMeta.platformHint === 'string'
                                        ? deviceMeta.platformHint
                                        : 'unknown',
        'dw:capabilities':            Array.isArray(deviceMeta.capabilities)
                                        ? [...deviceMeta.capabilities]
                                        : [],
        'dw:bootstrapKeyFingerprint': bootstrap.fingerprint(),
      };
    },
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function normalizeIso(input) {
  if (input == null) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.valueOf()) ? null : input.toISOString();
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    return new Date(input).toISOString();
  }
  if (typeof input === 'string') {
    const d = new Date(input);
    return Number.isNaN(d.valueOf()) ? null : d.toISOString();
  }
  return null;
}

function reasonForExactSkip(key) {
  if (key === 'agent-privkey')   return 'private-seed-not-pod-content';
  if (key === 'solid-pod-token') return 'oidc-bearer-not-identity';
  if (key === MIGRATED_FLAG_KEY) return 'migration-marker';
  return 'exact-skip';
}

function safeJsonParse(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); }
  catch { return raw; }
}
