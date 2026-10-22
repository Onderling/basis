/**
 * FUZZ: what arrives from a peer before anything checks who sent it — a chunked payload's pieces and a signed claim.
 * A deterministic, seeded generator (the same cases every run). Properties:
 *   - the reassembler delivers a payload ONLY when it is exactly what the sender chunked — never a reordered, partial,
 *     duplicated-over or other-sender-mixed one — and refuses everything else without throwing;
 *   - a claim with any field changed never verifies.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity } from '@onderling/core';
import { chunkPayloadForRoute, makeChunkReassembler } from '../src/peerChunking.js';
import { signClaim, verifyClaim, parseClaim } from '../src/claim.js';

const CASES = 300;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

describe('fuzz: the chunk reassembler', () => {
  it('delivers only the exact payload the sender chunked, whatever order, loss, duplication or interleaving arrives', () => {
    const r = rng(21);
    const payload = { type: 'photo', text: 'x'.repeat(80_000), nested: { n: [1, 2, 3] } };
    const chunks = chunkPayloadForRoute(payload, 2000, { transferId: 't1' });
    expect(chunks.length).toBeGreaterThan(3);
    for (let n = 0; n < CASES; n++) {
      const got = [];
      const reassemble = makeChunkReassembler({ onPayload: (whole, env) => got.push({ whole, from: env._from }) });
      // a stream: the sender's chunks, some dropped / duplicated / reordered / tampered, and another peer's chunks
      // under the SAME transfer id mixed in
      let stream = chunks.map((c) => ({ _from: 'alice', payload: { ...c } }));
      const op = pick(r, [0, 1, 2, 4, 5]);   // (a chunk's data altered is the sender's own data: integrity is the sealed envelope's job)
      let intact = true;
      if (op === 0) { stream.splice(Math.floor(r() * (stream.length - 1)), 1); intact = false; }   // a lost chunk (not the final)
      if (op === 1) { const i = Math.floor(r() * stream.length); stream.splice(i, 0, { ...stream[i], payload: { ...stream[i].payload } }); }   // a duplicate
      if (op === 2) { const last = stream.pop(); stream = stream.sort(() => r() - 0.5); stream.push(last); }   // reordered before the final
      if (op === 3) { const i = Math.floor(r() * stream.length); stream[i].payload.data = String(stream[i].payload.data).slice(1); intact = false; }   // tampered
      if (op === 4) { const i = Math.floor(r() * stream.length); stream.splice(i, 0, { _from: 'mallory', payload: { ...chunks[0], data: '{"evil":' } }); }   // another sender, same id
      if (op === 5) { const i = Math.floor(r() * stream.length); stream[i].payload.seq = pick(r, [-1, 1.5, '0', null, 1e9, Number.MAX_SAFE_INTEGER]); intact = false; }   // a strange seq
      for (const env of stream) expect(() => reassemble(env)).not.toThrow();
      const alices = got.filter((g) => g.from === 'alice');
      if (alices.length) expect(alices[0].whole, `case ${n} op ${op} delivered something else`).toEqual(payload);
      if (intact && op !== 4) expect(alices.length, `case ${n} op ${op} lost an intact transfer`).toBe(1);
      expect(got.filter((g) => g.from === 'mallory').length).toBe(0);
    }
  });
});

describe('fuzz: a signed claim', () => {
  it('any field changed (or the signature) never verifies', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const now = 1_700_000_000_000;
    const claim = signClaim(id, { webid: 'https://anna.example/profile#me', nknAddr: 'addr.1', now });
    expect(verifyClaim(claim, { now })).toMatchObject({ ok: true });
    const r = rng(22);
    const fields = Object.keys(claim);
    for (let n = 0; n < CASES; n++) {
      const f = fields[n % fields.length];
      const v = claim[f];
      const changed = typeof v === 'number' ? v + pick(r, [1, -1, 1000, -now]) : (String(v).slice(0, -1) + pick(r, ['A', 'b', '0', '_', '-']));
      if (changed === v) continue;
      // base64url's last character has unused bits: a change there can decode to the SAME signature bytes
      if (f === 'sig' && Buffer.from(changed, 'base64url').equals(Buffer.from(v, 'base64url'))) continue;
      const res = verifyClaim({ ...claim, [f]: changed }, { now });
      expect(res.ok, `${f} changed (case ${n}) verified`).toBe(false);
    }
  });
});

describe('a prototype key refuses a peer\'s JSON', () => {
  const PROTO = '{"__proto__":{"isAdmin":true},"v":1}';
  it('the reassembler does not deliver a payload carrying `__proto__`', () => {
    const got = [];
    const reassemble = makeChunkReassembler({ onPayload: (w) => got.push(w) });
    reassemble({ _from: 'alice', payload: { type: 'bulk-chunk', transferId: 't', seq: 0, data: PROTO, final: true, meta: { encoding: 'json' } } });
    expect(got).toEqual([]);
  });
  it('a claim string carrying `__proto__` does not parse', () => {
    expect(() => parseClaim(PROTO)).toThrow();
  });
});
