/**
 * PodExporter / PodImporter — Track C / C3 unit tests.
 *
 * Covers:
 *   - round-trip unencrypted (export → import → contents match)
 *   - round-trip encrypted (with Bootstrap)
 *   - wrong bootstrap → import throws
 *   - tampered archive → import throws
 *   - dataOnly: true skips /onderling/ identity container
 *   - deterministic output (same pod → same archive bytes)
 *   - empty pod exports cleanly
 */
import { describe, it, expect, vi } from 'vitest';
import nacl from 'tweetnacl';

import { PodExporter } from '../src/PodExporter.js';
import { PodImporter } from '../src/PodImporter.js';
import { Bootstrap }   from '@onderling/core';

// ── Helpers ─────────────────────────────────────────────────────────────────

const POD_ROOT = 'https://test.example/';

function makeMockPod({ podRoot = POD_ROOT, initial = {} } = {}) {
  // Store keyed by absolute URI.  Each value: { content (Uint8Array), contentType }.
  const store = new Map();
  for (const [uri, entry] of Object.entries(initial)) {
    store.set(uri, normalize(entry));
  }

  function normalize(entry) {
    const content =
      entry.content instanceof Uint8Array
        ? entry.content
        : typeof entry.content === 'string'
        ? new TextEncoder().encode(entry.content)
        : new Uint8Array(entry.content);
    return { content, contentType: entry.contentType || 'application/octet-stream' };
  }

  // Compute children of a container — only IMMEDIATE children (Solid LDP).
  function listChildren(containerUri) {
    const out = [];
    const seen = new Set();
    for (const uri of store.keys()) {
      if (!uri.startsWith(containerUri) || uri === containerUri) continue;
      const tail = uri.slice(containerUri.length);
      const slash = tail.indexOf('/');
      if (slash === -1) {
        // direct resource child
        out.push({ uri, type: 'resource', contentType: store.get(uri).contentType });
      } else {
        const childContainer = containerUri + tail.slice(0, slash + 1);
        if (!seen.has(childContainer)) {
          seen.add(childContainer);
          out.push({ uri: childContainer, type: 'container' });
        }
      }
    }
    return out;
  }

  const pod = {
    podRoot,
    _store: store,
    read: vi.fn(async (uri) => {
      const e = store.get(uri);
      if (!e) {
        const err = new Error(`not found: ${uri}`);
        err.code = 'NOT_FOUND';
        throw err;
      }
      return {
        content:      e.content,
        contentType:  e.contentType,
        lastModified: 'now',
        etag:         '"e"',
        size:         e.content.byteLength,
      };
    }),
    list: vi.fn(async (containerUri) => {
      return { container: containerUri, entries: listChildren(containerUri) };
    }),
    write: vi.fn(async (uri, content, opts = {}) => {
      const bytes =
        content instanceof Uint8Array
          ? content
          : typeof content === 'string'
          ? new TextEncoder().encode(content)
          : new Uint8Array(content);
      store.set(uri, { content: bytes, contentType: opts.contentType || 'application/octet-stream' });
      return { uri, contentType: opts.contentType, size: bytes.byteLength, lastModified: 'now', etag: '"e"' };
    }),
  };
  return pod;
}

function arrayEq(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

const FIXED_DATE = '2026-04-28T00:00:00.000Z';

function fixturePod() {
  return makeMockPod({
    initial: {
      [POD_ROOT + 'profile/card']: { content: '<#me> a foaf:Person.',  contentType: 'text/turtle' },
      [POD_ROOT + 'notes/hello.txt']: { content: 'hello world',         contentType: 'text/plain' },
      [POD_ROOT + 'notes/bye.txt']:   { content: 'goodbye',             contentType: 'text/plain' },
      [POD_ROOT + 'data/blob.bin']:   { content: new Uint8Array([1, 2, 3, 4, 0xff]), contentType: 'application/octet-stream' },
      [POD_ROOT + 'onderling/identity.json']: { content: '{"v":1}', contentType: 'application/json' },
      [POD_ROOT + 'onderling/devices/dev1.enc']: { content: new Uint8Array([0xab, 0xcd]), contentType: 'application/octet-stream' },
    },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PodExporter (unencrypted)', () => {
  it('round-trips a fixture pod through PodImporter to a fresh pod', async () => {
    const src = fixturePod();
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT });
    const archive = await exporter.export({ encrypt: false, exportedAt: FIXED_DATE });

    expect(archive).toBeInstanceOf(Uint8Array);
    expect(archive.byteLength).toBeGreaterThan(0);

    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT });
    const result = await importer.import(archive);

    expect(result.errors).toEqual([]);
    expect(result.entriesWritten).toBe(6);
    expect(result.header.encrypted).toBe(false);

    // Compare every URI in the source.
    for (const [uri, entry] of src._store.entries()) {
      const got = dst._store.get(uri);
      expect(got, `missing ${uri}`).toBeTruthy();
      expect(arrayEq(got.content, entry.content)).toBe(true);
      expect(got.contentType).toBe(entry.contentType);
    }
  });

  it('produces deterministic output for the same input pod', async () => {
    const src = fixturePod();
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT });
    const a = await exporter.export({ encrypt: false, exportedAt: FIXED_DATE });
    const b = await exporter.export({ encrypt: false, exportedAt: FIXED_DATE });
    expect(arrayEq(a, b)).toBe(true);
  });

  it('exports an empty pod cleanly (header + zero entries)', async () => {
    const src = makeMockPod();
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT });
    const archive = await exporter.export({ encrypt: false, exportedAt: FIXED_DATE });

    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT });
    const result = await importer.import(archive);
    expect(result.entriesWritten).toBe(0);
    expect(result.header.entryCount).toBe(0);
    expect(dst._store.size).toBe(0);
  });

  it('dataOnly: true skips entries under /onderling/', async () => {
    const src = fixturePod();
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT });
    const archive = await exporter.export({ encrypt: false, dataOnly: true, exportedAt: FIXED_DATE });

    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT });
    const result = await importer.import(archive);

    expect(result.errors).toEqual([]);
    expect(result.entriesWritten).toBe(4);  // 6 minus 2 identity entries
    expect(result.header.dataOnly).toBe(true);

    // Identity entries must NOT be present in the dst pod.
    expect(dst._store.has(POD_ROOT + 'onderling/identity.json')).toBe(false);
    expect(dst._store.has(POD_ROOT + 'onderling/devices/dev1.enc')).toBe(false);
    // Non-identity entries must be present.
    expect(dst._store.has(POD_ROOT + 'profile/card')).toBe(true);
    expect(dst._store.has(POD_ROOT + 'notes/hello.txt')).toBe(true);
  });

  it('imports into a different podRoot (rebases relative paths)', async () => {
    const src = fixturePod();
    const archive = await new PodExporter({ podClient: src, podRoot: POD_ROOT })
      .export({ encrypt: false, exportedAt: FIXED_DATE });

    const NEW_ROOT = 'https://other.example/';
    const dst = makeMockPod({ podRoot: NEW_ROOT });
    const importer = new PodImporter({ podClient: dst, podRoot: NEW_ROOT });
    const result = await importer.import(archive);

    expect(result.entriesWritten).toBe(6);
    expect(dst._store.has(NEW_ROOT + 'profile/card')).toBe(true);
    expect(dst._store.has(NEW_ROOT + 'notes/hello.txt')).toBe(true);
    expect(dst._store.has(POD_ROOT + 'profile/card')).toBe(false);
  });
});

describe('PodExporter (encrypted)', () => {
  it('round-trips with the same Bootstrap', async () => {
    const { bootstrap } = Bootstrap.create();
    const src = fixturePod();
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT, bootstrap });
    const archive = await exporter.export({ encrypt: true, exportedAt: FIXED_DATE });

    // Header is plaintext; check it's marked encrypted.
    const headerLen = new DataView(archive.buffer, archive.byteOffset).getUint32(8, true);
    const headerJson = JSON.parse(new TextDecoder().decode(archive.subarray(12, 12 + headerLen)));
    expect(headerJson.encrypted).toBe(true);
    expect(headerJson.encryption.alg).toBe('xsalsa20poly1305');
    expect(typeof headerJson.encryption.salt).toBe('string');
    expect(typeof headerJson.encryption.nonce).toBe('string');

    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT, bootstrap });
    const result = await importer.import(archive);

    expect(result.errors).toEqual([]);
    expect(result.entriesWritten).toBe(6);

    for (const [uri, entry] of src._store.entries()) {
      const got = dst._store.get(uri);
      expect(got).toBeTruthy();
      expect(arrayEq(got.content, entry.content)).toBe(true);
    }
  });

  it('throws when import is given a wrong Bootstrap', async () => {
    const { bootstrap: a } = Bootstrap.create();
    const { bootstrap: b } = Bootstrap.create();
    const src = fixturePod();
    const archive = await new PodExporter({ podClient: src, podRoot: POD_ROOT, bootstrap: a })
      .export({ encrypt: true });

    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT, bootstrap: b });
    await expect(importer.import(archive)).rejects.toThrow(/decryption failed/i);
  });

  it('throws when import is given no Bootstrap on an encrypted archive', async () => {
    const { bootstrap } = Bootstrap.create();
    const src = fixturePod();
    const archive = await new PodExporter({ podClient: src, podRoot: POD_ROOT, bootstrap })
      .export({ encrypt: true });

    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT });
    await expect(importer.import(archive)).rejects.toThrow(/no bootstrap/i);
  });

  it('throws when the ciphertext body has been tampered', async () => {
    const { bootstrap } = Bootstrap.create();
    const src = fixturePod();
    const archive = await new PodExporter({ podClient: src, podRoot: POD_ROOT, bootstrap })
      .export({ encrypt: true });

    // Flip a byte well past the header.
    const tampered = new Uint8Array(archive);
    tampered[tampered.length - 5] ^= 0xff;

    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT, bootstrap });
    await expect(importer.import(tampered)).rejects.toThrow(/decryption failed/i);
  });

  it('export() with encrypt: true requires a Bootstrap', async () => {
    const src = fixturePod();
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT });
    await expect(exporter.export({ encrypt: true })).rejects.toThrow(/requires a Bootstrap/i);
  });

  it('produces byte-for-byte equal archives when salt+nonce are pinned (test-only)', async () => {
    const { bootstrap } = Bootstrap.create();
    const src = fixturePod();
    const salt  = nacl.randomBytes(16);
    const nonce = nacl.randomBytes(24);
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT, bootstrap });
    const a = await exporter.export({ encrypt: true, exportedAt: FIXED_DATE, salt, nonce });
    const b = await exporter.export({ encrypt: true, exportedAt: FIXED_DATE, salt, nonce });
    expect(arrayEq(a, b)).toBe(true);
  });
});

describe('PodExporter.digest', () => {
  it('returns a stable hex digest for unencrypted exports', async () => {
    const src = fixturePod();
    const exporter = new PodExporter({ podClient: src, podRoot: POD_ROOT });
    const d1 = await exporter.digest({ encrypt: false, exportedAt: FIXED_DATE });
    const d2 = await exporter.digest({ encrypt: false, exportedAt: FIXED_DATE });
    expect(d1).toMatch(/^[0-9a-f]{64}$/);
    expect(d1).toBe(d2);
  });
});

describe('PodExporter input validation', () => {
  it('rejects construction without a podClient', () => {
    expect(() => new PodExporter({ podRoot: POD_ROOT })).toThrow(/podClient/);
  });

  it('rejects construction without a podRoot', () => {
    const src = fixturePod();
    expect(() => new PodExporter({ podClient: src })).toThrow(/podRoot/);
  });

  it('PodImporter rejects archives with bad magic', async () => {
    const dst = makeMockPod();
    const importer = new PodImporter({ podClient: dst, podRoot: POD_ROOT });
    // 8 bytes of wrong magic + 4 bytes header-len + a single header byte —
    // long enough to pass the length check but the magic must mismatch.
    const bad = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0]);
    await expect(importer.import(bad)).rejects.toThrow(/bad magic/i);
  });
});
