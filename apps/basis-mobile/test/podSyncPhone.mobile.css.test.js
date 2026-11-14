/**
 * SYNCING THROUGH A POD, ON THE PHONE (the function matrix's pod-sync × mobile cell). Two phones in Node, each its own
 * bundle and inbound wiring (test/support/mobileNode.js), each signed in to its own account on a real Community Solid
 * Server the way the app signs in (a held session; the circle pods read it). Anna's phone founds a circle with the
 * shared circle pod; Bram's phone joins it. Bram is away while Anna posts; Anna stops; Bram comes back with his relay
 * gone and reads the post FROM THE POD:
 *   - through the app's own entry for coming back to the front (ChatScreen's pod read-back, `comeToFront`), not a
 *     direct call to the reader;
 *   - with the circle's group key opened by his phone's own per-circle key pair (nothing handed in by the test).
 * What this form cannot show, and the phone session keeps: AppState itself firing 'active', the OS background slot.
 *
 * Gated on a CSS with client-credentials for two accounts (CSS_A_*, CSS_B_*); skips clean otherwise. Run locally:
 *   node scripts/run-integration.mjs --provision --only=podSyncPhone
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { createCircle, joinExistingCircle, until } from '../../basis/test/support/pairRealAgents.js';
import { circleChatMessageEvent, broadcastCircleFanOut } from '@onderling/kring-host/circleBroadcast';
import { policyPatchFromState } from '../../basis/src/core/wizards/createGroupState.js';
import { bootMobileNode } from './support/mobileNode.js';

const CSS_URL = process.env.CSS_URL;
const HAVE = !!(CSS_URL && process.env.CSS_A_CLIENT_ID && process.env.CSS_A_CLIENT_SECRET && process.env.CSS_A_WEBID
  && process.env.CSS_B_CLIENT_ID && process.env.CSS_B_CLIENT_SECRET && process.env.CSS_B_WEBID);
const SUITE = HAVE ? describe : describe.skip;

const CIRCLE = 'pod-sync-phone';
const TEXT = 'de sleutel ligt onder de mat';

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
  const session = new OidcSessionRN({ store: memStore(), appId: `pod-sync-${who}` });
  await session.adoptTokens({ accessToken: await bearer(process.env[`CSS_${who}_CLIENT_ID`], process.env[`CSS_${who}_CLIENT_SECRET`]), webid: process.env[`CSS_${who}_WEBID`] });
  await node.signInToPod(session);
  return session;
}
const chatIn = (node) => node.eventLog.query({}).map((e) => e?.payload?.text ?? e?.payload?.payload?.text ?? null).filter(Boolean);

SUITE('syncing through a pod, on the phone', () => {
  let relay; let anna; let bram;
  afterAll(async () => {
    for (const n of [anna, bram]) { try { await n?.dispose?.(); } catch { /* */ } }
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('Bram, away while Anna posted, comes back to the front with no relay and reads the post from the pod', async () => {
    relay = await startJourneyRelay();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    bram = await bootMobileNode({ name: 'bram', relayUrl: relay.url });
    // the join wizard's seams as the launcher hands them: the phone's own peer redeem and post-join step
    bram.sendPeerRedeem = bram.bundle.sendPeerRedeem;
    bram.onJoined = bram.bundle.onCircleJoined;
    await signedIn(anna, 'A');
    await signedIn(bram, 'B');

    const { created, state: made } = await createCircle(anna, { groupId: CIRCLE, name: 'Pod samen', storage: 'shared', groupPodUri: `${process.env.CSS_A_WEBID.replace(/profile\/card#me$/, '')}circles/${CIRCLE}/`, handle: 'anna' });
    // …and what the phone's create wizard does next: the chosen policy into the phone's own policy store
    await anna.persistPolicy(CIRCLE, policyPatchFromState(made));
    // the launcher shows the new circle: its view builds the circle's pod producer before anyone is invited
    await anna.openCircle(CIRCLE);
    const joined = await joinExistingCircle(anna, bram, { groupId: CIRCLE, handle: 'bram', podUrl: created?.storage?.groupPodUri ?? null });
    expect(joined.joined?.ok, `Bram's phone joined: ${JSON.stringify(joined.joined)}`).toBe(true);
    await anna.bundle.registerCirclePresence?.([CIRCLE]);
    // the circle's pod policy reaches the joiner by its post-join governance pull
    expect(await until(async () => (await bram.policyOf(CIRCLE))?.pod === 'shared', { timeout: 30_000, step: 500 }), 'Bram\'s phone holds the circle as a shared-pod circle').toBe(true);
    // …and the newcomer holds the others' per-circle addresses (the presence signal after the join clears the early sends)
    const annaRow = async () => ((await bram.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? [])
      .find((m) => m?.webid && m.webid !== bram.agent.circleSelf?.(CIRCLE)?.webid && m.webid !== bram.pubKey && m.circleAddress);
    expect(await until(annaRow, { timeout: 30_000, step: 500 }), 'Bram\'s phone holds Anna\'s per-circle address').toBeTruthy();

    // Bram away: his phone off the relay (its socket removed, as when the app is closed)
    await bram.agent.relays.remove(relay.url);
    expect((bram.agent.relays.list() ?? []).some((x) => x.url === relay.url && x.connected), 'Bram is off the relay').toBe(false);
    // Anna posts as the circle screen does (CircleLauncherScreen: appendCircleMessage + broadcastFanOut): the line on
    // her event log, then the shared fan-out over the phone's waist, the chat rail signing the entry
    const podWrites = () => anna.copyLog().split('\n').filter((l) => /pod\/pod\.write/.test(l)).length;
    const writesBefore = podWrites();
    const msgId = `circle-${CIRCLE}-${Date.now()}-pod`;
    const ts = Date.now();
    anna.eventLog.append(circleChatMessageEvent({ msgId, ts, circleId: CIRCLE, actor: 'me', text: TEXT }));
    broadcastCircleFanOut({
      rawCallSkill: anna.bundle.callSkill, circleId: CIRCLE, msgId, text: TEXT, ts,
      deliveryStateMap: anna.deliveryMap, onChange: () => {},
      signStatement: (cid, mid) => anna.bundle.agent?.chatRail?.signEntry?.(cid, mid) ?? null,
    });
    expect(await until(() => podWrites() > writesBefore, { timeout: 20_000, step: 250 }), 'Anna\'s post was written to the circle\'s pod').toBe(true);
    // Anna stops, and the relay is gone: nothing Bram reads now can come from either
    await anna.dispose();
    anna = null;
    await relay.close();

    // Bram comes back to the front: the app's own entry (ChatScreen's pod read-back, AppState 'active')
    const r = await bram.comeToFront();
    expect(r?.ingested, `the read-back read the post from the pod: ${JSON.stringify(r)}`).toBeGreaterThan(0);
    expect(chatIn(bram), 'Bram\'s phone holds Anna\'s post').toContain(TEXT);
  }, 240_000);
});
