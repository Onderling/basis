/**
 * THE SIGN-IN OP, WHERE IT COMPLETES IN PLACE (the phone): the web's startSignIn navigates away, so the op fires it and
 * says "opening"; the phone's resolves after the person is back, and a provider that could not start says so. That
 * refusal reached nobody: the op fired and forgot, so a mistyped provider on My data showed nothing. Where the podAuth
 * says it completes in place, the op waits, and a provider that is not ready is one line in the person's words.
 */
import { describe, it, expect } from 'vitest';
import { createLocalBuiltins } from '../../src/core/localBuiltins.js';

const t = (key, vars = {}) => `${key}${vars.issuer ? `:${vars.issuer}` : ''}`;
const builtinsWith = (podAuth) => createLocalBuiltins({ catalogue: { ops: [] }, t, podAuth });

describe('signin, completing in place', () => {
  it('a provider that is not ready is refused in the person\'s words, naming the address', async () => {
    const podAuth = {
      completesInPlace: true,
      resolveIssuer: (i) => ({ id: 'custom', url: i, name: i }),
      startSignIn: async ({ issuer }) => { throw Object.assign(new Error('raw: the provider did not answer'), { code: 'ISSUER_NOT_READY', issuer }); },
    };
    const r = await builtinsWith(podAuth).signin({ issuer: 'https://pod.typo.example' });
    expect(r).toMatchObject({ ok: false, error: 'signin.issuer_not_ready:https://pod.typo.example' });
  });

  it('a sign-in that completes says so only after it did', async () => {
    let done = false;
    const podAuth = {
      completesInPlace: true,
      resolveIssuer: (i) => ({ id: 'custom', url: i, name: i }),
      startSignIn: async () => { await new Promise((r) => setTimeout(r, 20)); done = true; return { accessToken: 'A' }; },
    };
    const r = await builtinsWith(podAuth).signin({ issuer: 'https://pod.example' });
    expect(done, 'the op waited for the sign-in').toBe(true);
    expect(r.ok).toBe(true);
  });

  it('the web (navigates away) still fires and says "opening"', async () => {
    let started = false;
    const podAuth = { resolveIssuer: (i) => ({ id: 'x', url: i, name: 'X' }), startSignIn: () => { started = true; return new Promise(() => {}); } };
    const r = await builtinsWith(podAuth).signin({ issuer: 'https://pod.example' });
    expect(started).toBe(true);
    expect(r).toMatchObject({ ok: true, message: 'signin.opening:X' });
  });
});
