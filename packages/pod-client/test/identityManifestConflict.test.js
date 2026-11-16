/**
 * THE IDENTITY MANIFEST AFTER ANOTHER DEVICE WROTE IT. The manifest is a signed hash over the identity container's
 * resources, rewritten after every resource write, with a retry on a ConflictError. A real PodClient refuses a default
 * write of a resource another writer changed since this client wrote it (a ConflictError, as a 412). The retry must
 * therefore READ the manifest before it writes again; a retry that does not read meets the same refusal every time
 * and the write fails once the retry budget is spent, although the manifest is fully derived and safe to rebuild.
 * Two devices, two PodClients, one pod that answers a PUT like CSS (no ETag).
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { Bootstrap, AgentIdentity } from '@onderling/core';
import { PodClient } from '../src/index.js';
import { IdentityPodStore } from '../src/identity/IdentityPodStore.js';

const enc = (s) => new TextEncoder().encode(s);

/** Many resources; a PUT answers with no ETag; If-Match is checked; `list` gives direct children. */
function fakePod() {
  const files = new Map(); // uri -> { bytes, version, contentType }
  let seq = 0;
  const etagOf = (f) => `"v${f.version}"`;
  const source = {
    async read(uri) {
      const f = files.get(uri);
      if (!f) throw Object.assign(new Error('nf'), { code: 'NOT_FOUND' });
      return { uri, content: f.bytes, contentType: f.contentType, etag: etagOf(f), lastModified: null, size: f.bytes.length };
    },
    async write(uri, payload, opts = {}) {
      const cur = files.get(uri);
      if (opts.ifMatch && (!cur || opts.ifMatch !== etagOf(cur))) throw Object.assign(new Error('412'), { code: 'CONFLICT', status: 412 });
      files.set(uri, { bytes: typeof payload === 'string' ? enc(payload) : payload, version: ++seq, contentType: opts.contentType || 'text/plain' });
      return { uri, contentType: opts.contentType, etag: null, lastModified: null, size: null };
    },
    async delete(uri) { files.delete(uri); },
    async list(container) {
      const base = container.endsWith('/') ? container : `${container}/`;
      const seen = new Set();
      const entries = [];
      for (const uri of files.keys()) {
        if (!uri.startsWith(base) || uri === base) continue;
        const rest = uri.slice(base.length);
        const slash = rest.indexOf('/');
        const child = slash === -1 ? uri : base + rest.slice(0, slash + 1);
        if (seen.has(child)) continue;
        seen.add(child);
        entries.push({ uri: child, type: slash === -1 ? 'resource' : 'container' });
      }
      return { container: base, entries };
    },
    async exists(uri) { return files.has(uri); },
  };
  return { source, files };
}

const POD = 'https://alice.example/';
const auth = { getAuthenticatedFetch: () => globalThis.fetch, identity: () => 'test', close: () => {} };
const device = (i) => ({
  '@type': 'dw:Device', pubkey: `ed25519:base58:fake-device-${i}`, label: `Device ${i}`,
  pairedAt: '2026-11-15T10:00:00Z', lastSeen: '2026-11-15T11:00:00Z', retired: false,
  platformHint: 'linux', capabilities: ['push'], bootstrapKeyFingerprint: '9f3a2c1b4e5d6f00',
});

describe('identity manifest: another device wrote it since this device did', () => {
  it('this device\'s next resource write still goes through, and the manifest it leaves verifies', async () => {
    const pod = fakePod();
    const { bootstrap } = Bootstrap.create();
    const identity = new AgentIdentity({ vault: null, seed: nacl.randomBytes(32) });
    const storeOn = () => new IdentityPodStore({
      podClient: new PodClient({ podRoot: POD, auth, podSourceFactory: () => pod.source }),
      bootstrap, identity, podRoot: POD,
    });
    const a = storeOn();
    const b = storeOn();

    await a.init();                                   // A writes the manifest
    await b.writeResource('devices/b.enc', device(2)); // B writes a resource and rewrites the manifest
    await a.writeResource('devices/a.enc', device(1)); // A's manifest rewrite meets B's manifest

    expect((await a.verifyManifest()).ok).toBe(true);
    expect((await b.verifyManifest()).ok).toBe(true);
  });
});
