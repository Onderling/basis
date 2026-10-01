/**
 * One code admits one person, even when the same message arrives three times at once.
 *
 * Found over the real relay (2026-09-29): a contact's message came in three times (the pair route and the profile
 * address, retried) and all three redeemed the SAME one-person code — each read the state before any wrote it. A
 * redemption is now one step at a time.
 */
import { describe, it, expect } from 'vitest';
import { createBotAdmission } from '../src/v2/botAdmission.js';

function slowStore() {
  const m = new Map();
  const tick = () => new Promise((r) => setTimeout(r, 5));
  return { get: async (id) => { await tick(); return m.get(id) ?? null; }, put: async (row) => { await tick(); m.set(row.id, row); return row; } };
}
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }

describe('a code redeemed at the same moment', () => {
  it('three at once: one admits, the others are told the code is used', async () => {
    const a = createBotAdmission({ secretVault: memVault(), store: slowStore() });
    await a.openCohort({ ceiling: 5, days: 1 });
    const code = await a.code();
    const results = await Promise.all([a.redeem(code), a.redeem(code), a.redeem(code)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.reason === 'code-used')).toHaveLength(2);
  });

  it('a one-person cohort admits one person, however many different codes arrive at once', async () => {
    const a = createBotAdmission({ secretVault: memVault(), store: slowStore() });
    await a.openCohort({ ceiling: 1, days: 1 });
    const codes = [await a.code(), await a.code(), await a.code()];
    const results = await Promise.all(codes.map((c) => a.redeem(c)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
