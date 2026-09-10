/**
 * THE DEVICE LOG THROUGH THE SEAL — the one local store that writes BINARY.
 *
 * Every other local store hands the backend a string. The device-log snapshot does not: `backendSnapshotIo`
 * writes `TextEncoder.encode(JSON.stringify(events))`, a `Uint8Array`, and reads it back expecting either a
 * string or something a `TextDecoder` can take. The sealing wrapper therefore has a binary path — a tagged
 * base64 encoding — and it is the only place in the app that path is used.
 *
 * That is exactly the shape this repo keeps paying for: a seam that is built, correct, adopted in the web
 * shell, and exercised by no test that runs in CI. The browser suite would catch it on a reload; the
 * browser suite is the one that does not currently run. So this asserts it where it can be asserted.
 *
 * Why it matters more than it sounds: the device log is the record every lane rides. The last test here
 * is the one that earned the file — a snapshot written by the UNSEALED shell threw on load, and
 * `wireEventLogPersistence` catches exactly that and degrades to an empty log rather than a broken boot.
 * So an existing install's first boot after the sealing update came back with no history at all, behind
 * one console warning: not a crash, which someone would have noticed, but a device that reads as a fresh
 * install. Proven by removing the fix and watching this go red, then restoring it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { createMemoryBackend, createSealingBackend } from '@onderling/pseudo-pod';
import { backendSnapshotIo } from '../../src/v2/eventLogPersistence.js';

const KEY = 'A'.repeat(43);   // 32 bytes of b64url — fixed, so a failure reproduces
const strategy = groupKeyStrategy({ groupKey: KEY });

/** Events shaped like the real ones, with a word a raw scan can look for. */
const EVENTS = [
  { id: 'e1', kind: 'chat', ts: 1, payload: { text: 'de sleutels liggen onder de mat' } },
  { id: 'e2', kind: 'membership', ts: 2, payload: { who: 'bram', role: 'admin' } },
];

describe('the device-log snapshot survives the seal', () => {
  let raw; let io;
  beforeEach(() => {
    raw = createMemoryBackend();
    io = backendSnapshotIo(createSealingBackend({ backend: raw, getStrategy: () => strategy }));
  });

  it('a snapshot written through the seal loads back identical', async () => {
    await io.save(EVENTS);
    // Not "it loaded something" — the SAME log. A device that comes back with a truncated history is
    // the failure this guards, and it would not throw.
    expect(await io.load()).toEqual(EVENTS);
  });

  it('…and the words in it are not on the disk', async () => {
    await io.save(EVENTS);
    const keys = await raw.list('');
    expect(keys.length, 'nothing was stored — this test would be vacuous').toBeGreaterThan(0);
    const dump = [];
    for (const k of keys) dump.push(JSON.stringify(await raw.get(k)));
    expect(dump.join('\n'), 'the device log holds a message body in the clear').not.toContain('onder de mat');
  });

  it('an empty log round-trips too — the boot case, and the one an off-by-one breaks', async () => {
    await io.save([]);
    expect(await io.load()).toEqual([]);
  });

  it('a snapshot written BEFORE sealing still loads — the no-migration decision, on the spine', async () => {
    // What an existing install has: the snapshot put there by the unsealed shell, as raw bytes.
    await raw.put('device-log/events.json', new TextEncoder().encode(JSON.stringify(EVENTS)));
    const sealedIo = backendSnapshotIo(createSealingBackend({ backend: raw, getStrategy: () => strategy }));
    // Without the wrapper's binary branch this throws, the caller swallows it, and a person's whole
    // history is gone on the first boot after the update.
    expect(await sealedIo.load(), 'a pre-seal snapshot must still load').toEqual(EVENTS);
  });
});

/**
 * The tag is an implementation detail of the ENVELOPE, and must never touch a value that never had one.
 *
 * The wrapper puts a one-character type tag inside the sealed text (`s` a string, `j` JSON, `b` bytes) so
 * a value comes back as the type it went in as. A pre-seal value has no envelope and no tag — and if it
 * happens to begin with one of those letters, stripping "the tag" eats a real character.
 *
 * Nothing stored through these backends starts that way today; they are all JSON bodies. That is exactly
 * why it is worth pinning: the case is unreachable until the day something reaches it, and then it is a
 * silent one-character corruption in a store nobody is watching.
 */
describe('a value that predates sealing is never mistaken for a tagged one', () => {
  const strategy2 = groupKeyStrategy({ groupKey: KEY });

  for (const value of ['some plain text', 'json is not this', 'best guess', '{"ok":true}']) {
    it(`leaves ${JSON.stringify(value.slice(0, 12))} exactly as it found it`, async () => {
      const raw2 = createMemoryBackend();
      await raw2.put('pre/seal.json', value);   // written by the unsealed shell
      const sealed = createSealingBackend({ backend: raw2, getStrategy: () => strategy2 });
      expect((await sealed.get('pre/seal.json'))?.bytes).toBe(value);
    });
  }
});
