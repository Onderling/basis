/**
 * THE CIRCLE TYPES, ON THE PHONE (the function matrix's circle-types × mobile cell): the two types a person can MAKE in
 * the alpha, normal and shared pod (pod-only and the name 'central' are out: decision 2026-11-13 in docs/decisions.md).
 * Two phones in Node, each its own bundle and inbound wiring (test/support/mobileNode.js). Anna's phone makes the circle
 * through the create wizard's own steps (the kind, the storage radio, the pod address beside a shared choice), persists
 * its policy as the create modal does and opens it; Bram's phone joins. Per type:
 *   - the circle has the type the radio gave it (its storage policy), on Anna's phone and, once it arrived, on Bram's;
 *   - Anna posts as the circle screen does, and the post reaches Bram's phone;
 *   - the send took the type's branch, read from Anna's phone's own log: a normal circle sends by the fan-out and never
 *     talks about a pod; a shared-pod circle writes to the circle's pod and does not degrade to the fan-out.
 * The shared-pod case needs a Community Solid Server with two client-credentials accounts (CSS_A_*, CSS_B_*); it skips
 * clean otherwise. Run locally: node scripts/run-integration.mjs --provision --only=circleTypesPhone
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle, until } from '../../basis/test/support/pairRealAgents.js';
import { circleChatMessageEvent, broadcastCircleFanOut } from '@onderling/kring-host/circleBroadcast';
import { policyPatchFromState } from '../../basis/src/core/wizards/createGroupState.js';
import { bootMobileNode } from './support/mobileNode.js';

const CSS_URL = process.env.CSS_URL;
const HAVE_POD = !!(CSS_URL && process.env.CSS_A_CLIENT_ID && process.env.CSS_A_CLIENT_SECRET && process.env.CSS_A_WEBID
  && process.env.CSS_B_CLIENT_ID && process.env.CSS_B_CLIENT_SECRET && process.env.CSS_B_WEBID);

/** A client-credentials bearer token from the CSS: what the app's session holds after a sign-in. */
async function bearer(id, secret) {
  const base = CSS_URL.replace(/\/$/, '');
  const oidc = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
  const basic = Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');
  const res = await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=webid',
  });
  const tok = await res.json();
  if (!tok.access_token) throw new Error(`no token: ${JSON.stringify(tok).slice(0, 200)}`);
  return tok.access_token;
}
function memStore() {
  const m = new Map();
  return { getItemAsync: async (k) => (m.has(k) ? m.get(k) : null), setItemAsync: async (k, v) => { m.set(k, String(v)); }, deleteItemAsync: async (k) => { m.delete(k); } };
}
async function signedIn(node, who) {
  const { OidcSessionRN } = await import('@onderling/oidc-session-rn');
  const session = new OidcSessionRN({ store: memStore(), appId: `circle-types-${who}` });
  await session.adoptTokens({ accessToken: await bearer(process.env[`CSS_${who}_CLIENT_ID`], process.env[`CSS_${who}_CLIENT_SECRET`]), webid: process.env[`CSS_${who}_WEBID`] });
  await node.signInToPod(session);
}
const chatIn = (node) => node.eventLog.query({}).map((e) => e?.payload?.text ?? e?.payload?.payload?.text ?? null).filter(Boolean);
const logLines = (node) => node.copyLog().split('\n');

const CASES = [
  { type: 'normal', storage: null, policy: 'none', pod: false, branch: 'fan-out' },
  { type: 'shared pod', storage: 'shared', policy: 'shared', pod: true, branch: 'pod' },
];

describe('the circle types, on the phone', () => {
  let relay; let anna; let bram;
  afterEach(async () => {
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    try { await relay?.close?.(); } catch { /* */ }
    anna = null; bram = null; relay = null;
  });

  for (const c of CASES) {
    (c.pod && !HAVE_POD ? it.skip : it)(`${c.type}: made in the wizard, a member's message reaches the other member, and the send took its branch`, async () => {
      const circle = `types-phone-${c.policy}-${Date.now()}`;
      const text = `${c.type}: de vergadering is om acht uur`;
      relay = await startJourneyRelay();
      anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
      bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
      // the join wizard's seams as the launcher hands them: the phone's own peer redeem and post-join step
      bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
      bram.onJoined = bram.bundle.onCircleJoined;
      if (c.pod) { await signedIn(anna, 'A'); await signedIn(bram, 'B'); }

      const groupPodUri = c.pod ? `${process.env.CSS_A_WEBID.replace(/profile\/card#me$/, '')}circles/${circle}/` : null;
      const { created, state: made } = await createCircle(anna, { groupId: circle, name: `Soort ${c.type}`, storage: c.storage, groupPodUri, handle: 'anna' });
      await anna.persistPolicy(circle, policyPatchFromState(made));
      await anna.openCircle(circle);
      expect((await anna.callSkill('pinboard', 'getCircleStoragePolicy', { groupId: circle }))?.policy, 'the circle has the type the radio gave it').toBe(c.policy);

      const joined = await joinExistingCircle(anna, bram, { groupId: circle, handle: 'bram', podUrl: c.pod ? (created?.storage?.groupPodUri ?? null) : null });
      expect(joined.joined?.ok, `Bram's phone joined: ${JSON.stringify(joined.joined)}`).toBe(true);
      await anna.bundle.registerCirclePresence?.([circle]);
      await bram.openCircle(circle);
      // the type reaches the member's phone with the circle's policy
      const wantPod = c.pod ? 'shared' : 'none';
      expect(await until(async () => ((await bram.policyOf(circle))?.pod ?? 'none') === wantPod && (await bram.policyOf(circle))?.policyPending !== true, { timeout: 30_000, step: 500 }),
        `Bram's phone holds the circle as ${c.type}: ${JSON.stringify(await bram.policyOf(circle))}`).toBe(true);
      // …and the newcomer holds Anna's per-circle address (the presence signal after the join)
      const annaRow = async () => ((await bram.callSkill('pinboard', 'listGroupMembers', { groupId: circle }))?.members ?? [])
        .find((m) => m?.webid && m.webid !== bram.agent.circleSelf?.(circle)?.webid && m.webid !== bram.pubKey && m.circleAddress);
      expect(await until(annaRow, { timeout: 30_000, step: 500 }), 'Bram\'s phone holds Anna\'s per-circle address').toBeTruthy();

      // Anna posts as the circle screen does (CircleLauncherScreen: appendCircleMessage + broadcastFanOut)
      const podWrites = () => logLines(anna).filter((l) => /pod\/pod\.write/.test(l)).length;
      const logBefore = logLines(anna).length;
      const writesBefore = podWrites();
      const msgId = `circle-${circle}-${Date.now()}`;
      const ts = Date.now();
      anna.eventLog.append(circleChatMessageEvent({ msgId, ts, circleId: circle, actor: 'me', text }));
      broadcastCircleFanOut({
        rawCallSkill: anna.bundle.callSkill, circleId: circle, msgId, text, ts,
        deliveryStateMap: anna.deliveryMap, onChange: () => {},
        signStatement: (cid, mid) => anna.bundle.agent?.chatRail?.signEntry?.(cid, mid) ?? null,
      });
      expect(await until(() => chatIn(bram).includes(text), { timeout: 30_000, step: 250 }), 'the post reached Bram\'s phone').toBe(true);

      // the branch, from Anna's phone's own log (the send path says every degrade)
      const sendLog = logLines(anna).slice(logBefore);
      const degraded = sendLog.filter((l) => /degrading to fan-out-full/.test(l));
      expect(degraded, `the ${c.type} send must not degrade:\n${sendLog.join('\n')}`).toEqual([]);
      if (c.branch === 'pod') {
        expect(await until(() => podWrites() > writesBefore, { timeout: 20_000, step: 250 }), 'the post was written to the circle\'s pod').toBe(true);
      } else {
        expect(podWrites(), 'a normal circle writes nothing to a pod').toBe(writesBefore);
        expect(sendLog.filter((l) => /\bpod\b/i.test(l) && /circle-data|fan-?out|send/i.test(l)), 'a normal circle\'s send never talks about a pod').toEqual([]);
      }
    }, 240_000);
  }
});
