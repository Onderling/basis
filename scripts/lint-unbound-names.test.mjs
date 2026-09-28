import { describe, it, expect } from 'vitest';
import { unboundNames, entryPoints } from './lint-unbound-names.mjs';

describe('lint-unbound-names', () => {
  it('names what a module uses and nothing binds', () => {
    const src = `
      import { a } from './a.js';
      const b = 1;
      function c(d) { return d + e; }
      a(b, c, shareSomething({ x: 1 }));
      process.exit(0);
      console.log(new URL('x:y'), setTimeout);
    `;
    expect(unboundNames(src)).toEqual(['e', 'shareSomething']);
  });

  it('takes bindings from every form: destructuring, catch, class, top-level await', () => {
    const src = `
      const { p, q: [r] } = await load();
      class K {}
      try { p(r, new K()); } catch (err) { console.error(err); }
      for (const [k, v] of Object.entries({})) k(v);
      async function load() { return {}; }
    `;
    expect(unboundNames(src)).toEqual([]);
  });

  it('finds the Node entry points, the box shell among them', () => {
    expect(entryPoints()).toContain('apps/basis/bin/device-runner.mjs');
  });
});
