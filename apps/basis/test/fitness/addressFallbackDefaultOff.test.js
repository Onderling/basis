/**
 * THE ADDRESS FALLBACK IS OFF UNLESS THE PERSON CHOSE IT — in every composition. The fallback reaches a member at their
 * one global key when no per-circle address is known, which lets a relay link that member's circles. It is the person's
 * choice (Delivery settings), so the production default is OFF: web and mobile hand the agent the person's setting, the
 * box hands nothing — and until 2026-11-03 "nothing" meant ON (realAgent's default), so the always-on box linked a
 * member's global key to its circle address at the relay whenever its roster lagged. One default, read here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { bootRealAgentNode, teardown } from '../support/pairRealAgents.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

describe('the address fallback is off unless the person chose it', () => {
  it('an agent composed without the setting — as the box composes it — has the fallback OFF', async () => {
    const node = await bootRealAgentNode('no-setting', { agentOpts: { allowAddressFallback: undefined } });
    try {
      expect(node.agent.addressFallbackOn(), 'no setting handed means OFF, not ON').toBe(false);
    } finally { await teardown(node); }
  });
  it('…and the person\'s choice still turns it on', async () => {
    const node = await bootRealAgentNode('chose-it', { agentOpts: { allowAddressFallback: () => true } });
    try { expect(node.agent.addressFallbackOn()).toBe(true); } finally { await teardown(node); }
  });
  it('no shell turns it on by itself: web and mobile hand the person\'s setting, the box hands nothing that says true', () => {
    for (const shell of ['apps/basis/web/v2/circleApp.js', 'apps/basis-mobile/App.js']) {
      const src = read(shell);
      expect(src, `${shell} hands the person's setting`).toMatch(/allowAddressFallback:\s*\(\)\s*=>\s*[\w.]+\.allowFallback\s*===\s*true/);
    }
    const box = read('apps/basis/bin/device-runner.mjs');
    expect(box, 'the box never turns the fallback on').not.toMatch(/allowAddressFallback:\s*(true|\(\)\s*=>\s*true)/);
  });

  it('the layers below hold the same default: the circle fan and the member address ladder are OFF unless handed true', async () => {
    const { resolveMemberAddress } = await import('../../../pinboard/src/lib/memberAddress.js');
    const member = { webid: 'w:bram', pubKey: 'bram-global-key' };   // no per-circle address known
    const r = await resolveMemberAddress(member, { circleId: 'c1', preferCircleAddress: true });
    expect(r.addr, 'no setting: never the global key').toBe(null);
    expect((await resolveMemberAddress(member, { circleId: 'c1', preferCircleAddress: true, allowFallback: true })).addr).toBe('bram-global-key');
    expect(read('packages/circles/src/circleFanOut.js')).toMatch(/allowAddressFallback = false/);
    expect(read('apps/basis/src/core/agent/realAgent.js'), 'realAgent hands pinboard its ONE live answer, never the raw option').toMatch(/allowAddressFallback: addressFallbackOn,/);
    expect(read('apps/basis/src/core/agent/realAgent.js'), 'the circle-scoped send takes its route from the one decision (circleSendRoute)').toMatch(/const route = circleSendRoute\(\{ asPerson, fallbackOn \}\);/);
  });
});
