import { describe, it, expect } from 'vitest';
import { canFail } from './lint-browser-specs-assert.mjs';

describe('a browser spec can fail', () => {
  it('an expect, an assert or a thrown Error can fail it', () => {
    expect(canFail("test('x', async () => { expect(a).toBe(1); })")).toBe(true);
    expect(canFail("test('x', async () => { await expect.poll(f).toBe(1); })")).toBe(true);
    expect(canFail("if (!ok) throw new Error('not visible')")).toBe(true);
  });
  it('a walk that only logs its findings cannot', () => {
    expect(canFail("test('walk', async () => { log('step', 'FINDING', 'x'); })")).toBe(false);
  });
});
