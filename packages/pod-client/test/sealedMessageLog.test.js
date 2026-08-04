import { describe, it, expect } from 'vitest';
import { MemoryStorageBackend } from '@onderling/core';
import {
  messageRef, tsFromRef,
  writeSealedMessage, readSealedMessage, readSealedMessagesSince,
  resolveCircleStorage, generateGroupKey, isSealed,
} from '../src/index.js';

const CIRCLE = 'circle-42';

function envOf({ msgId, ts, text, fromActor = 'alice' }) {
  return { subtype: 'kring-chat-message', type: 'p2p-chat', circleId: CIRCLE, msgId, ts, text, fromActor, fromWebid: fromActor };
}

describe('sealedMessageLog — key convention', () => {
  it('messageRef is chronological under lexicographic sort', () => {
    const a = messageRef(CIRCLE, 1000, 'm1');
    const b = messageRef(CIRCLE, 2000, 'm2');
    const c = messageRef(CIRCLE, 900000000000000, 'm3');
    expect([b, a, c].sort()).toEqual([a, b, c]);
    expect(a.startsWith(`${CIRCLE}/`)).toBe(true);
  });
  it('tsFromRef recovers the ts', () => {
    expect(tsFromRef(messageRef(CIRCLE, 1720000000000, 'abc'))).toBe(1720000000000);
    expect(Number.isNaN(tsFromRef('no-slash'))).toBe(true);
  });
});

describe('sealedMessageLog — sealed round-trip (p2 group-key via resolveCircleStorage)', () => {
  it('writes ciphertext the store can never read, then range-reads it back merged+sorted', async () => {
    const groupKey = generateGroupKey();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey });
    const backend = new MemoryStorageBackend();

    // The marker contains characters OUTSIDE the base64url alphabet ('!', space) — `'hi'` was two
    // base64 characters, and ~2% of runs found it INSIDE the random ciphertext (a flake, found when
    // batch 4's scheme tag landed and this file re-ran often). Impossible-by-alphabet beats unlikely.
    const ref1 = await writeSealedMessage(backend, seal, envOf({ msgId: 'm1', ts: 1000, text: 'geheim bericht!' }));
    await writeSealedMessage(backend, seal, envOf({ msgId: 'm2', ts: 3000, text: 'there' }));
    await writeSealedMessage(backend, seal, envOf({ msgId: 'm3', ts: 2000, text: 'middle' }));

    // The store holds SEALED bytes — never plaintext.
    const raw = await backend.get(ref1);
    expect(isSealed(raw)).toBe(true);
    expect(raw.includes('geheim bericht!')).toBe(false);

    // Single-ref read opens back to the canonical message.
    const one = await readSealedMessage(backend, open, ref1);
    expect(one).toMatchObject({ subtype: 'kring-chat-message', circleId: CIRCLE, msgId: 'm1', ts: 1000, text: 'geheim bericht!', fromActor: 'alice' });

    // Range read: since 1500 → m3(2000), m2(3000), oldest→newest, m1 excluded.
    const { items, truncated } = await readSealedMessagesSince(backend, open, { circleId: CIRCLE, sinceTs: 1500 });
    expect(truncated).toBe(false);
    expect(items.map((i) => i.msgId)).toEqual(['m3', 'm2']);
    expect(items.map((i) => i.ts)).toEqual([2000, 3000]);

    // Full range from 0.
    const all = await readSealedMessagesSince(backend, open, { circleId: CIRCLE, sinceTs: 0 });
    expect(all.items.map((i) => i.msgId)).toEqual(['m1', 'm3', 'm2']);
  });

  it('a wrong-key row is skipped, not thrown', async () => {
    const backend = new MemoryStorageBackend();
    const { seal } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    await writeSealedMessage(backend, seal, envOf({ msgId: 'm1', ts: 1000, text: 'sealed-to-key-A' }));
    // Open with a DIFFERENT key → the row can't be opened → skipped.
    const { open: wrongOpen } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    const { items } = await readSealedMessagesSince(backend, wrongOpen, { circleId: CIRCLE, sinceTs: 0 });
    expect(items).toEqual([]);
  });

  it('caps to max, keeping the freshest N', async () => {
    const backend = new MemoryStorageBackend();
    const { seal, open } = resolveCircleStorage({ posture: 'p2', groupKey: generateGroupKey() });
    for (let i = 0; i < 5; i++) await writeSealedMessage(backend, seal, envOf({ msgId: `m${i}`, ts: 1000 + i, text: `t${i}` }));
    const { items, truncated } = await readSealedMessagesSince(backend, open, { circleId: CIRCLE, sinceTs: 0, max: 2 });
    expect(truncated).toBe(true);
    expect(items.map((i) => i.msgId)).toEqual(['m3', 'm4']);
  });
});

describe('sealedMessageLog — plaintext store (p0, no client seal)', () => {
  it('stores + reads plaintext JSON when the strategy is null', async () => {
    const backend = new MemoryStorageBackend();
    const strat = resolveCircleStorage({ posture: 'p0' });
    expect(strat).toBe(null);   // p0 → no client-side seal
    await writeSealedMessage(backend, null, envOf({ msgId: 'm1', ts: 1000, text: 'plain' }));
    const { items } = await readSealedMessagesSince(backend, null, { circleId: CIRCLE, sinceTs: 0 });
    expect(items.map((i) => i.text)).toEqual(['plain']);
  });
});
