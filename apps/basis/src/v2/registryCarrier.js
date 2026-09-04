/**
 * registryCarrier — the owner's agent registry SURVIVES THE DEVICE.
 *
 * The registry is the one durable list of what a person belongs to: their profiles, their enrolled
 * devices, and per circle the handle and address they use plus the pointer to their wrapped circle key.
 * The recovery phrase rebuilds every KEY; it cannot rebuild this LIST. Until now the registry lived on
 * an in-memory pseudo-pod, so it did not even survive a reload. This module gives it two things:
 *
 *   1. a LOCAL backend of the shell's choosing (IndexedDB / AsyncStorage / memory in tests), so the
 *      list survives a restart on the same device;
 *   2. when the person is signed in, a POD MIRROR in the pseudo-pod's cache mode: every write lands
 *      locally at once and write-throughs to the pod SEALED TO THE OWNER, and a local miss falls
 *      through to the pod — which is how a wiped device gets its list back.
 *
 * SEALING is the settings mirror's seal-to-self: the strategy the caller hands in is derived from
 * the owner's identity, identical on every one of that person's devices and re-derived by the phrase
 * ceremony. The pod holds ciphertext under an OPAQUE name (`registryPodName`): a name derived from the
 * identity's private key, so the host cannot tell what the resource is, only that one exists.
 *
 * THE GATE (the settings restore gate, applied to this resource): before the first write-through the
 * carrier PROBES the pod copy read-only and classifies the outcome —
 *   openable      this device holds the key → pull if the pod copy is newer, then mirror;
 *   missing       nothing on the pod yet    → mirror, pushing the local copy up if there is one;
 *   undecryptable the pod copy is sealed under a DIFFERENT key (a fresh install signed into someone's
 *                 pod without the phrase) → HOLD: stay local, overwrite nothing, tell the shell;
 *   transport     the pod could not be reached → HOLD this session, accuse nothing, retry next boot.
 * A boot registers THIS device into the registry before anything else runs, so without the probe that
 * first write would overwrite the owner's pod copy with a one-device list. Gate the write on being able
 * to open — never a silent write.
 */
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createSealedPodDataSource } from '@onderling/pod-client';
import { hashHex } from '@onderling/core';
import { registryResourceUri } from '@onderling/agent-registry';
import { probeSettingsMediumDetailed } from './settingsRestoreGate.js';

const NAME_DOMAIN = 'onderling-registry-name-v1';

/**
 * The registry's OPAQUE pod name for an identity: a hash over a deterministic signature by the identity's
 * private key, so only a holder of that key can compute it and the host learns nothing from the path.
 * Ed25519 signatures are deterministic, so every device of the person derives the same name.
 * @param {{sign: (d: string) => Uint8Array}} identity  the owner's profile-derived AgentIdentity
 * @returns {string} a pod-relative path, e.g. `o/3fa9…c2`
 */
export function registryPodName(identity) {
  if (!identity || typeof identity.sign !== 'function') throw new Error('registryPodName: an identity with sign() is required');
  return `o/${hashHex(identity.sign(NAME_DOMAIN)).slice(0, 40)}`;
}

/**
 * The pod medium for the registry — the settings mirror's sibling: a sealed DataSource over the owner's
 * pod under the caller-supplied seal-to-self strategy. Not signed in / no strategy → null.
 */
export async function createRegistryPodMedium({ fetch, podRoot, strategy, podSource } = {}) {
  if ((typeof fetch !== 'function' && !podSource) || (!podRoot && !podSource)) return null;
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') return null;
  return createSealedPodDataSource({ podSource, fetch, podUrl: podRoot ?? 'mem://', strategy });
}

const updatedAtOf = (body) => {
  const t = Date.parse(body?.updatedAt ?? '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * Build the registry's carrier: a pseudo-pod the agent registry is composed over, plus `attach()`.
 *
 * @param {object} a
 * @param {object}   [a.backend]      the LOCAL StorageBackend (persistent in a shell; memory by default)
 * @param {string}    a.deviceId      the pseudo-pod URI authority (the chat identity's pubKey)
 * @param {object|null} [a.medium]    the sealed pod medium from `createRegistryPodMedium`, or null
 * @param {string}   [a.name]         the opaque pod name (`registryPodName`); required when medium is set
 * @param {() => void} [a.onKeyMismatch]  called once when the pod copy is sealed under a different key
 * @param {(msg: string) => void} [a.warn]
 * @returns {{ pseudoPod: object, resourceUri: string, attach: () => Promise<object>, status: () => object }}
 */
export function createRegistryCarrier({ backend, deviceId, medium = null, name = null, onKeyMismatch = null, warn = null } = {}) {
  if (typeof deviceId !== 'string' || !deviceId) throw new Error('createRegistryCarrier: deviceId is required');
  if (medium && !name) throw new Error('createRegistryCarrier: a pod name is required with a medium');
  const local = backend ?? createMemoryBackend();
  const resourceUri = registryResourceUri({ deviceId });
  const state = { mode: 'local', probe: null, pulled: false, pushed: false };

  const pseudoPod = createPseudoPod({
    backend: local,
    mode: 'standalone',
    deviceId,
    // Cache-mode deps, used only once attach() flips this URI to cache mode. The uploader and fetcher
    // ignore the pseudo-pod URI: the pod path is the opaque name, one resource, sealed by the medium.
    podUploader: async (_uri, bytes) => { await medium.write(name, JSON.stringify(bytes)); return {}; },
    podFetcher: async () => {
      const s = await medium.read(name);
      return s == null ? null : { bytes: JSON.parse(s) };
    },
    isPodReachable: () => state.mode === 'cache',
  });

  async function attach() {
    if (!medium) return { ...state };
    const { status, value } = await probeSettingsMediumDetailed(medium, name);
    state.probe = status;
    if (status === 'undecryptable') {
      warn?.('[registry-carrier] the pod registry is sealed under a different key — staying local; nothing overwritten. Recover with your phrase to sync.');
      try { onKeyMismatch?.(); } catch { /* a shell hook must not break boot */ }
      return { ...state };
    }
    if (status === 'transport') {
      warn?.('[registry-carrier] could not reach the pod to verify the registry — staying local this session.');
      return { ...state };
    }
    const localRec = await pseudoPod.read(resourceUri);
    if (status === 'openable') {
      let podBody = null;
      try { podBody = typeof value === 'string' ? JSON.parse(value) : value; } catch { podBody = null; }
      // Resource-level last-write-wins: the pod copy is newer (another device wrote it, or this device
      // was wiped) → it becomes the local copy. Otherwise the local copy is pushed up below.
      if (podBody && (!localRec || updatedAtOf(podBody) >= updatedAtOf(localRec.bytes))) {
        await pseudoPod.write(resourceUri, podBody);
        state.pulled = true;
      }
    }
    pseudoPod.setMode(resourceUri, 'cache');
    state.mode = 'cache';
    if (!state.pulled && localRec) {
      await pseudoPod.flush(resourceUri);
      state.pushed = true;
    }
    try { await pseudoPod.drainWriteThroughQueue(); } catch { /* parked writes drain on a later boot */ }
    return { ...state };
  }

  return { pseudoPod, resourceUri, attach, status: () => ({ ...state }) };
}

// ── THE RECOVERY FILE — the pod-less carrier of the same fact ───────────────────────────────────────
// The registry sealed exactly as it is sealed on the pod (seal-to-self, the owner's profile-derived key),
// written to a file the person keeps. One secret: the recovery phrase re-derives the key that opens it,
// so the file is useless to whoever finds it and nobody has a second password to remember. Import is the
// pod pull by hand: open, then upsert every entry into this device's registry.

export const RECOVERY_FILE_KIND = 'onderling-recovery-v1';

/** Seal a registry body into the recovery-file text. */
export function sealRecoveryFile({ strategy, body, now = () => new Date().toISOString() } = {}) {
  if (!strategy || typeof strategy.seal !== 'function') throw new Error('sealRecoveryFile: a seal strategy is required');
  if (!body || typeof body !== 'object') throw new Error('sealRecoveryFile: a registry body is required');
  return JSON.stringify({ v: 1, kind: RECOVERY_FILE_KIND, writtenAt: now(), sealed: strategy.seal(JSON.stringify(body)) });
}

/**
 * Open a recovery file with this identity's strategy → the registry body.
 * Throws `Error{code:'unreadable-file'}` for anything that is not a recovery file, and
 * `Error{code:'not-your-file'}` when the seal does not open under this key (the message keeps the
 * sealing layer's own `sealing:` prefix underneath, so a transport/sealing classifier still works).
 */
export function openRecoveryFile({ strategy, file } = {}) {
  if (!strategy || typeof strategy.open !== 'function') throw new Error('openRecoveryFile: an open strategy is required');
  let env = null;
  try { env = JSON.parse(String(file ?? '')); } catch { env = null; }
  if (!env || env.kind !== RECOVERY_FILE_KIND || typeof env.sealed !== 'string') {
    throw Object.assign(new Error('unreadable-file: not an onderling recovery file'), { code: 'unreadable-file' });
  }
  let plain;
  try { plain = strategy.open(env.sealed); }
  catch (err) { throw Object.assign(new Error(`not-your-file: ${err?.message ?? err}`), { code: 'not-your-file', cause: err }); }
  try { return JSON.parse(plain); }
  catch { throw Object.assign(new Error('unreadable-file: sealed body is not a registry'), { code: 'unreadable-file' }); }
}
