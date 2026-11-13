/**
 * ONE GOVERNANCE BINDING PER SHELL, so every screen decides with the same options.
 *
 * Each screen used to assemble its own `bindCircleGovernance({ … })`, and the copies drifted: the phone's launcher
 * binding lacked the spine gate (fixed with door 2); the phone's Decisions screen bound one WITHOUT `setPolicy`, so an
 * admin approving a settings proposal there had it enacted as "no-setPolicy" and closed REJECTED; the phone's
 * launcher wrote an approved settings change to its own store only and never stated it on the lane, so the other
 * members never got it (web did). Now: one binding per shell (web `shellGovernance`, the phone launcher's
 * `govPolicy`, handed to the screens that need it), and the shared binding states an enacted settings change on
 * the lane itself (`statePolicy`).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { policyEnactor } from '../../src/v2/governanceAppWiring.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SHELLS = {
  web: ['../../web/v2/circleApp.js'],
  phone: [
    '../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js',
    '../../../basis-mobile/src/screens/v2/CircleGovernanceScreen.js',
    '../../../basis-mobile/src/screens/v2/CircleSettingsScreen.js',
    '../../../basis-mobile/src/screens/v2/CircleAdminPanelScreen.js',
  ],
};

/** Each `bindCircleGovernance({ … })` call's argument text (to its closing `})`), imports excluded. */
function bindings(src) {
  const out = [];
  let i = src.indexOf('bindCircleGovernance({');
  while (i >= 0) {
    out.push(src.slice(i, src.indexOf('})', i) + 2));
    i = src.indexOf('bindCircleGovernance({', i + 1);
  }
  return out;
}

describe('one governance binding per shell', () => {
  for (const [shell, files] of Object.entries(SHELLS)) {
    const calls = files.flatMap((f) => bindings(read(f)));
    it(`${shell}: exactly one binding`, () => {
      expect(calls.length).toBe(1);
    });
    it(`${shell}: the binding carries what deciding needs`, () => {
      for (const opt of ['agent', 'spineGate', 'circleIdentityFor', 'setPolicy', 'statePolicy']) {
        expect(calls[0] ?? '', `${shell} binding lacks ${opt}`).toMatch(new RegExp(`\\b${opt}\\s*[:,]`));
      }
    });
  }
});

describe('an enacted settings change is written AND stated on the lane', () => {
  it('the binding\'s settings enactor writes the store, then states the policy on the lane', async () => {
    const order = [];
    const enact = policyEnactor({
      setPolicy: async (cid, patch) => { order.push(['set', cid, patch]); return { ok: true }; },
      statePolicy: async (cid) => { order.push(['state', cid]); },
    });
    const r = await enact('c1', { chat: 'off' });
    expect(r.ok).toBe(true);
    expect(order).toEqual([['set', 'c1', { chat: 'off' }], ['state', 'c1']]);
  });

  it('a write that failed is not stated', async () => {
    const statePolicy = vi.fn();
    const r = await policyEnactor({ setPolicy: async () => { throw new Error('disk'); }, statePolicy })('c1', {});
    expect(r.ok).toBe(false);
    expect(statePolicy).not.toHaveBeenCalled();
  });

  it('without a store there is no enactor (governance then refuses the enact, it never fakes one)', () => {
    expect(policyEnactor({ setPolicy: null, statePolicy: null })).toBeNull();
  });
});
