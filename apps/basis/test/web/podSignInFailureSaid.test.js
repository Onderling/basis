/**
 * A pod sign-in that fails on the way back says so. The auth library reports a failed redirect as an `error` EVENT on
 * its session, not as a thrown error — so a boot that only catches throws reads "not signed in" and the person sees the
 * same screen as before they tried, with no reason. The redirect handler keeps that error; `whoami` (the one read the
 * screens use) hands it on beside `signedIn: false`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as podAuth from '../../src/web/podAuth.js';
import { createLocalBuiltins } from '../../src/core/localBuiltins.js';

function fakeAuth({ fail = null } = {}) {
  const listeners = {};
  const session = {
    info: { isLoggedIn: false, sessionId: 's1' },
    events: { on: (name, fn) => { (listeners[name] ??= []).push(fn); } },
    fetch: async () => ({}),
  };
  return {
    getDefaultSession: () => session,
    handleIncomingRedirect: async () => { if (fail) for (const fn of listeners.error ?? []) fn('redirect', new Error(fail)); },
  };
}

describe('a pod sign-in that fails on the way back', () => {
  beforeEach(() => podAuth._injectAuth(fakeAuth()));

  it('the redirect handler keeps the error the library reported as an event', async () => {
    podAuth._injectAuth(fakeAuth({ fail: 'Client registration failed.' }));
    expect(await podAuth.handleRedirect()).toBe(null);
    expect(podAuth.lastSignInError()).toBe('Client registration failed.');   // the library hands an Error: its message, not "Error: …"
  });

  it('whoami says not signed in AND why', async () => {
    podAuth._injectAuth(fakeAuth({ fail: 'Client registration failed.' }));
    await podAuth.handleRedirect();
    const b = createLocalBuiltins({ podAuth, t: (k) => k });
    const r = await b.whoami({});
    expect(r.signedIn).toBe(false);
    expect(r.signInError).toContain('Client registration failed.');
  });

  it('a redirect that did not fail leaves no error behind', async () => {
    podAuth._injectAuth(fakeAuth());
    await podAuth.handleRedirect();
    expect(podAuth.lastSignInError()).toBe(null);
  });
});
