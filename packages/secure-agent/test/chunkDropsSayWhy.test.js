/**
 * A chunked payload the receiver gives up on says why. The reassembler swallowed a transfer silently when a chunk was
 * missing, when it was over budget or too large, or when the joined text did not parse — a frame that reached the
 * socket and never reached the router, with no line. Each branch now reports through `onDrop(reason, env)`.
 */
import { describe, it, expect } from 'vitest';
import { makeChunkReassembler } from '../src/peerChunking.js';

const chunk = (transferId, seq, data, final = false) => ({ _from: 'peer-a', payload: { type: 'bulk-chunk', transferId, seq, data, final, ...(final ? { meta: { encoding: 'json' } } : {}) } });

describe('the chunk reassembler says why it drops', () => {
  it('a missing chunk: onDrop("chunk-gap")', () => {
    const drops = [];
    const r = makeChunkReassembler({ onPayload: () => {}, onDrop: (reason) => drops.push(reason) });
    r(chunk('t1', 0, '{"a":'));
    r(chunk('t1', 2, '1}', true));   // seq 1 never came
    expect(drops).toEqual(['chunk-gap']);
  });
  it('joined text that does not parse: onDrop("chunk-unparseable")', () => {
    const drops = [];
    const r = makeChunkReassembler({ onPayload: () => {}, onDrop: (reason) => drops.push(reason) });
    r(chunk('t2', 0, '{"a":'));
    r(chunk('t2', 1, 'oops', true));
    expect(drops).toEqual(['chunk-unparseable']);
  });
  it('over the transfer size cap: onDrop("chunk-too-large"); over the transfer count: onDrop("chunk-over-budget")', () => {
    const drops = [];
    const big = makeChunkReassembler({ onPayload: () => {}, onDrop: (reason) => drops.push(reason), maxTransferChars: 4 });
    big(chunk('t3', 0, 'xxxxxxxx'));
    const full = makeChunkReassembler({ onPayload: () => {}, onDrop: (reason) => drops.push(reason), maxTransfers: 1 });
    full(chunk('t4', 0, 'a'));
    full(chunk('t5', 0, 'b'));
    expect(drops).toEqual(['chunk-too-large', 'chunk-over-budget']);
  });
  it('a whole transfer is delivered and nothing is dropped', () => {
    const drops = []; const got = [];
    const r = makeChunkReassembler({ onPayload: (p) => got.push(p), onDrop: (reason) => drops.push(reason) });
    r(chunk('t6', 0, '{"a":'));
    r(chunk('t6', 1, '1}', true));
    expect(got).toEqual([{ a: 1 }]);
    expect(drops).toEqual([]);
  });
});
