/**
 * The PARAMETER REGISTER (task #36) — the second half of the declaration layer.
 *
 * @guard — a param declares scope (sync) + kind (security); kind:internal is immutable by construction, and set-param gates on kind
 *
 * The load-bearing claims: `param()` returns the code default unchanged (behaviour-preserving); the two axes
 * are orthogonal (scope drives routing, kind drives settability); a kind:internal param has NO settable value
 * behind it (immutable by construction, not merely an op that declines); and the one `set-param` op refuses
 * anything that is not a kind:user param.
 */
import { describe, it, expect } from 'vitest';
import {
  PARAM_SCOPE, PARAM_KIND, PARAM_HOME_FOR,
  param, createParamRegistry, setParam,
} from '../src/params.js';

describe('param() — the declaration-site helper (decision A)', () => {
  it('returns the code default, so a migrated const is byte-identical', () => {
    expect(param({ key: 'x.ttl', scope: 'agent', kind: 'user', default: 1800000 })).toBe(1800000);
    expect(param({ key: 'x.cap', scope: 'agent', kind: 'internal', default: 280 })).toBe(280);
  });

  it('FORCES the shape — a spec missing key/scope/kind/default throws at declaration', () => {
    expect(() => param({ scope: 'agent', kind: 'user', default: 1 })).toThrow(/key/);
    expect(() => param({ key: 'k', kind: 'user', default: 1 })).toThrow(/scope/);
    expect(() => param({ key: 'k', scope: 'agent', default: 1 })).toThrow(/kind/);
    expect(() => param({ key: 'k', scope: 'agent', kind: 'user' })).toThrow(/default/);
    expect(() => param({ key: 'k', scope: 'planet', kind: 'user', default: 1 })).toThrow(/scope/);
    expect(() => param({ key: 'k', scope: 'agent', kind: 'root', default: 1 })).toThrow(/kind/);
  });

  it('registers nothing at runtime — calling it has no global side effect (no import-order hazard)', () => {
    const before = createParamRegistry().keys().length;
    param({ key: 'nowhere', scope: 'device', kind: 'user', default: 5 });
    expect(createParamRegistry().keys().length).toBe(before);   // a fresh register is still empty
  });
});

describe('the register — declared values + accessors (decision B)', () => {
  const reg = createParamRegistry()
    .declare({ key: 'nearby.ask.defaultTtlMs', scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.USER,     default: 1800000 })
    .declare({ key: 'nearby.ask.maxTtlMs',     scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.INTERNAL, default: 14400000 });

  it('valueOf falls to the code default until an override is set', () => {
    expect(reg.valueOf('nearby.ask.defaultTtlMs')).toBe(1800000);
    reg.setValue('nearby.ask.defaultTtlMs', 600000);
    expect(reg.valueOf('nearby.ask.defaultTtlMs')).toBe(600000);   // the synced override
  });

  it('exposes scope + kind, and marks only kind:user settable', () => {
    expect(reg.scopeOf('nearby.ask.defaultTtlMs')).toBe('agent');
    expect(reg.kindOf('nearby.ask.maxTtlMs')).toBe('internal');
    expect(reg.isSettable('nearby.ask.defaultTtlMs')).toBe(true);
    expect(reg.isSettable('nearby.ask.maxTtlMs')).toBe(false);
    expect(reg.isSettable('unknown.key')).toBe(false);
  });

  it('userParams() projects ONLY the settable slice (the settings-form seed)', () => {
    const rows = reg.userParams();
    expect(rows.map((r) => r.key)).toEqual(['nearby.ask.defaultTtlMs']);   // the internal cap is NOT surfaced
    expect(rows[0]).toMatchObject({ scope: 'agent', home: PARAM_HOME_FOR.agent });
  });
});

describe('ONE KEY IS ONE TUNABLE — the reuse guarantee (declare agreement)', () => {
  it('re-declaring a key with the SAME default is idempotent (a mirror)', () => {
    const reg = createParamRegistry()
      .declare({ key: 'attachment.maxImageDim', scope: 'device', kind: 'internal', default: 1280 })
      .declare({ key: 'attachment.maxImageDim', scope: 'device', kind: 'internal', default: 1280 });   // mirror — OK
    expect(reg.valueOf('attachment.maxImageDim')).toBe(1280);
  });

  it('re-declaring a key with a CONFLICTING default throws (drift caught at composition)', () => {
    const reg = createParamRegistry().declare({ key: 'attachment.maxImageDim', scope: 'device', kind: 'internal', default: 1280 });
    expect(() => reg.declare({ key: 'attachment.maxImageDim', scope: 'device', kind: 'internal', default: 8 }))
      .toThrow(/CONFLICTING default|one key is one tunable/i);
    expect(reg.valueOf('attachment.maxImageDim')).toBe(1280);   // unchanged
  });
});

describe('kind:internal is IMMUTABLE BY CONSTRUCTION (decision E)', () => {
  const reg = createParamRegistry()
    .declare({ key: 'nearby.ask.maxText', scope: PARAM_SCOPE.AGENT, kind: PARAM_KIND.INTERNAL, default: 280 });

  it('has NO settable value slot — valueOf is always the code default', () => {
    expect(reg.valueOf('nearby.ask.maxText')).toBe(280);
  });

  it('setValue on it throws — there is nothing to poke, not merely a declining op', () => {
    expect(() => reg.setValue('nearby.ask.maxText', 9999)).toThrow(/immutable by construction/);
    expect(reg.valueOf('nearby.ask.maxText')).toBe(280);   // unchanged
  });
});

describe('the set-param op — the one kind-enforcing chokepoint (decision D)', () => {
  const build = () => createParamRegistry()
    .declare({ key: 'nearby.ask.defaultTtlMs', scope: PARAM_SCOPE.AGENT,  kind: PARAM_KIND.USER,     default: 1800000 })
    .declare({ key: 'poll.intervalMs',         scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER,     default: 5000 })
    .declare({ key: 'circle.match.minShared',  scope: PARAM_SCOPE.CIRCLE, kind: PARAM_KIND.USER,     default: 1 })
    .declare({ key: 'nearby.ask.maxText',      scope: PARAM_SCOPE.AGENT,  kind: PARAM_KIND.INTERNAL, default: 280 });

  it('sets a kind:user param and reports the scope + home', async () => {
    const reg = build();
    const r = await setParam(reg, { key: 'nearby.ask.defaultTtlMs', value: 600000 });
    expect(r).toMatchObject({ ok: true, scope: 'agent', home: PARAM_HOME_FOR.agent });
    expect(reg.valueOf('nearby.ask.defaultTtlMs')).toBe(600000);
  });

  it('REFUSES a kind:internal param — the belt-and-suspenders gate (never writes)', async () => {
    const reg = build();
    expect(await setParam(reg, { key: 'nearby.ask.maxText', value: 9999 })).toMatchObject({ ok: false, error: 'param-internal' });
    expect(reg.valueOf('nearby.ask.maxText')).toBe(280);
  });

  it('refuses an unknown key', async () => {
    expect(await setParam(build(), { key: 'not.a.param', value: 1 })).toMatchObject({ ok: false, error: 'param-unknown' });
  });

  it('routes the value to the EXISTING home for its scope (decision C — no new plumbing)', async () => {
    const reg = build();
    const routed = [];
    const homes = {
      device: (p) => routed.push(['device', p.key, p.value]),
      agent:  (p) => routed.push(['agent', p.key, p.value]),
      circle: (p) => routed.push(['circle', p.key, p.value]),
    };
    await setParam(reg, { key: 'poll.intervalMs', value: 3000 }, { homes });
    await setParam(reg, { key: 'nearby.ask.defaultTtlMs', value: 600000 }, { homes });
    await setParam(reg, { key: 'circle.match.minShared', value: 2 }, { homes });
    await setParam(reg, { key: 'nearby.ask.maxText', value: 9999 }, { homes });   // internal — refused, MUST NOT route
    expect(routed).toEqual([
      ['device', 'poll.intervalMs', 3000],
      ['agent', 'nearby.ask.defaultTtlMs', 600000],
      ['circle', 'circle.match.minShared', 2],
    ]);
  });
});
