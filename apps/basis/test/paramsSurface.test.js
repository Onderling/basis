/**
 * The parameter register's read/write surface, REACHED THROUGH THE WAIST (#36).
 *
 * This is the crossing test that proves the settable runtime is no longer test-only: it goes through the REAL
 * composition — `createRealHouseholdAgent` → `callSkill('params', …)` → the `params` app-origin branch →
 * `paramsService` → the register + its homes. `set-param` is the one kind-gated write; `get-param` reads the
 * live value; `list-user-params` is the settings-form seed.
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

describe('params surface through the waist (realAgent callSkill)', () => {
  it('list-user-params returns the settable slice; set → get round-trips through the register', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false });

    const list = await a.callSkill('params', 'list-user-params', {});
    expect(list.ok).toBe(true);
    expect(list.params.map((p) => p.key)).toContain('nearby.ask.defaultTtlMs');

    const set = await a.callSkill('params', 'set-param', { key: 'nearby.ask.defaultTtlMs', value: 10 * 60_000 });
    expect(set).toMatchObject({ ok: true, scope: 'agent' });

    const got = await a.callSkill('params', 'get-param', { key: 'nearby.ask.defaultTtlMs' });
    expect(got).toMatchObject({ ok: true, value: 10 * 60_000 });   // the register reflects the set
  });

  it('set-param REFUSES a non-user key — the kind gate binds at the waist', async () => {
    const a = await createRealHouseholdAgent({ seedHousehold: false });
    // An internal cap (`nearby.ask.maxText`) is not in the settable register, and an unknown key is unknown —
    // both refused; the security outcome is the same (nothing settable that a person shouldn't touch).
    expect(await a.callSkill('params', 'set-param', { key: 'nearby.ask.maxText', value: 9999 }))
      .toMatchObject({ ok: false });
    expect(await a.callSkill('params', 'set-param', { key: 'not.a.param', value: 1 }))
      .toMatchObject({ ok: false, error: 'param-unknown' });
  });
});
