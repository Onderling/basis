/**
 * The fast path's "does this skill stream?" test must survive a bundle that compiles async generators to plain
 * functions (Hermes + Babel on the phone). There `Object.getPrototypeOf(async function*(){}).constructor` is plain
 * `Function`, so an `instanceof` test called EVERY handler a generator, every skill counted as streaming, and every
 * in-process call took the sealed wire path (measured 2026-10-23: ~450 ms per call on a Fairphone 4).
 */
import { describe, it, expect } from 'vitest';
import { _isStreamingSkill } from '../src/protocol/taskExchange.js';

const AGF = Object.getPrototypeOf(async function* () {}).constructor;
const plain = { handler: async () => [] };
const declared = { streaming: true, handler: async () => [] };
const generator = { handler: async function* () { yield 1; } };

describe('the fast path\'s stream test', () => {
  it('where the constructor collapses to Function, a plain handler is NOT streaming', () => {
    expect(_isStreamingSkill(plain, Function)).toBe(false);
  });
  it('where it collapses, a declared streaming skill still stays on the wire path', () => {
    expect(_isStreamingSkill(declared, Function)).toBe(true);
  });
  it('with real async generators: a generator handler streams, a plain one does not', () => {
    expect(_isStreamingSkill(generator, AGF)).toBe(true);
    expect(_isStreamingSkill(plain, AGF)).toBe(false);
    expect(_isStreamingSkill(declared, AGF)).toBe(true);
  });
  it('no skill is not streaming', () => {
    expect(_isStreamingSkill(undefined, Function)).toBe(false);
  });
});
