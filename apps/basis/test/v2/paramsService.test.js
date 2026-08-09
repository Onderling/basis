/**
 * The parameter register (#36), basis side — the worked cluster + the composition seam.
 *
 * Two claims: the `nearbyAsks` migration is BEHAVIOUR-PRESERVING (param() returns the exact defaults the plain
 * consts held), and the register's declared default for a settable param AGREES with the exported const (one
 * source of truth for the value — pinned, not copied). Plus the set-param op's kind gate over the real service.
 */
import { describe, it, expect } from 'vitest';
import { ASK_DEFAULT_TTL_MS, ASK_MAX_TTL_MS, ASK_MAX_TEXT } from '../../src/v2/nearbyAsks.js';
import { createParamsService, basisParamRegistry } from '../../src/v2/paramsService.js';

describe('the nearbyAsks migration is behaviour-preserving', () => {
  it('param() returns the exact numbers the plain consts held', () => {
    expect(ASK_DEFAULT_TTL_MS).toBe(30 * 60_000);
    expect(ASK_MAX_TTL_MS).toBe(4 * 60 * 60_000);
    expect(ASK_MAX_TEXT).toBe(280);
  });
});

describe('the register AGREES with the declaration site (one source of truth, pinned)', () => {
  it('the declared default for the settable ask-ttl equals the exported const', () => {
    const reg = basisParamRegistry();
    expect(reg.defaultOf('nearby.ask.defaultTtlMs')).toBe(ASK_DEFAULT_TTL_MS);
    expect(reg.isSettable('nearby.ask.defaultTtlMs')).toBe(true);   // kind:user
  });

  it('the internal caps are NOT settable through the register (immutable by construction)', () => {
    const reg = basisParamRegistry();
    // The internal params are declaration-only (param() default + guard census) — never in the value register.
    expect(reg.has('nearby.ask.maxTtlMs')).toBe(false);
    expect(reg.has('nearby.ask.maxText')).toBe(false);
  });
});

describe('the set-param op over the paramsService (decision D — the kind gate)', () => {
  it('sets the user param and routes it to the agent home (shared.json)', async () => {
    const routed = [];
    const svc = createParamsService({ homes: { agent: (p) => routed.push(p) } });
    const r = await svc.callSkill('set-param', { key: 'nearby.ask.defaultTtlMs', value: 10 * 60_000 });
    expect(r).toMatchObject({ ok: true, scope: 'agent' });
    expect(routed).toEqual([expect.objectContaining({ key: 'nearby.ask.defaultTtlMs', value: 10 * 60_000 })]);
    const got = await svc.callSkill('get-param', { key: 'nearby.ask.defaultTtlMs' });
    expect(got.value).toBe(10 * 60_000);
  });

  it('refuses an internal cap and an unknown key (never routes them)', async () => {
    const routed = [];
    const svc = createParamsService({ homes: { agent: (p) => routed.push(p) } });
    expect(await svc.callSkill('set-param', { key: 'nearby.ask.maxText', value: 9999 }))
      .toMatchObject({ ok: false, error: 'param-unknown' });   // internal cap is not even in the settable register
    expect(await svc.callSkill('set-param', { key: 'not.a.param', value: 1 }))
      .toMatchObject({ ok: false, error: 'param-unknown' });
    expect(routed).toEqual([]);
  });

  it('list-user-params projects only the settable slice (the settings-form seed)', async () => {
    const svc = createParamsService();
    const { params } = await svc.callSkill('list-user-params');
    expect(params.map((p) => p.key)).toEqual(['nearby.ask.defaultTtlMs']);
  });
});
