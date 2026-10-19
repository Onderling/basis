import { describe, it, expect } from 'vitest';
import { handFans } from './lint-one-sibling-carry.mjs';

describe('lint-one-sibling-carry', () => {
  it('flags a loop over siblings that sends to each; a single reply is not a fan', () => {
    const fan = "  try { addrs = (await siblings()) ?? []; } catch { return; }\n  await Promise.all(addrs.map(async (to) => { await sendToPeer(to, x); }));";
    expect(handFans(fan)).toEqual([2]);
    const reply = "  const theirs = (await siblings(c)) ?? [];\n  if (!theirs.includes(from)) return;\n  await sendToPeer(from, x);";
    expect(handFans(reply)).toEqual([]);
    const loop = "  addrs = (await siblings()) ?? [];\n  for (const to of addrs) {\n    await sendToPeer(to, ask);";
    expect(handFans(loop)).toEqual([2]);
  });
});
