/**
 * A CIRCLE THIS DEVICE JOINED IS NOT PLAINTEXT UNTIL ITS POLICY SAYS SO. Every circle the wizard makes is sealed (p2). A
 * joiner's phone learned the circle's policy only from the founder's policy statement, by its governance pull after the
 * join; until it landed (seconds; measured 2026-11-14), the joiner's policy store answered its defaults (p0) and a
 * noticeboard post in that window was written UNSEALED. A joined circle's posture is NOT KNOWN until its policy arrived:
 * a scoped write then is refused (never stored in the clear), and once the policy lands it is sealed.
 * Two phones in Node on one relay, no pod.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle, until } from '../../basis/test/support/pairRealAgents.js';
import { policyPatchFromState } from '../../basis/src/core/wizards/createGroupState.js';
import { bootMobileNode } from './support/mobileNode.js';

const G = 'joined-posture-unknown';

describe('a joined circle before its policy arrived', () => {
  let relay; let anna; let bram;
  afterAll(async () => {
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('the joiner\'s post at once is refused or sealed, never in the clear; once the policy lands it is sealed', async () => {
    relay = await startJourneyRelay();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    const { state: made } = await createCircle(anna, { groupId: G, name: 'Gesloten', handle: 'anna' });
    await anna.persistPolicy(G, policyPatchFromState(made));
    await anna.openCircle(G);
    await anna.bundle.registerCirclePresence?.([G]);
    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;
    const joined = await joinExistingCircle(anna, bram, { groupId: G, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);

    // at once, before anything else: open and post
    await bram.openCircle(G);
    const outcomes = [];
    for (let i = 0; i < 40; i += 1) {
      const r = await (await bram.circleCall(G))('pinboard', 'postRequest', { intent: 'ask', text: `vraag ${i}`, groupId: G }).catch((e) => ({ thrown: e?.message ?? String(e) }));
      const stored = String(r?.message ?? '').replace(/^.*Posted:\s*/, '');
      outcomes.push(r?.ok === true ? (stored.startsWith('fp1:') ? 'sealed' : 'CLEAR') : 'refused');
      if (r?.ok === true) break;
      await new Promise((res) => { setTimeout(res, 500); });
    }
    expect(outcomes, `no post was written in the clear: ${JSON.stringify(outcomes)}`).not.toContain('CLEAR');
    expect(outcomes.at(-1), `once the policy (and key) landed, the post is sealed: ${JSON.stringify(outcomes)}`).toBe('sealed');
  }, 120_000);
});
