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
    const annaSession = await signedIn(anna, 'A');
    await signedIn(bram, 'B');

    const { created, state: made } = await createCircle(anna, { groupId: CIRCLE, name: 'Pod samen', storage: 'shared', groupPodUri: `${process.env.CSS_A_WEBID.replace(/profile\/card#me$/, '')}circles/${CIRCLE}/`, handle: 'anna' });
    // …and what the phone's create wizard does next: the chosen policy into the phone's own policy store
    await anna.persistPolicy(CIRCLE, policyPatchFromState(made));
    console.info('[pod-sync-phone] created', JSON.stringify({ podBacked: created?.podBacked, podUrl: created?.podUrl, storage: created?.storage }));
    const joined = await joinExistingCircle(anna, bram, { groupId: CIRCLE, handle: 'bram', podUrl: created?.storage?.groupPodUri ?? null });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await anna.bundle.registerCirclePresence?.([CIRCLE]);
    await bram.bundle.registerCirclePresence?.([CIRCLE]);
    const bramShared = await until(async () => (await bram.policyOf(CIRCLE))?.pod === 'shared', { timeout: 30_000, step: 500 });
    console.info('[pod-sync-phone] PROBE bram learned shared:', bramShared);
    const kinds = (n) => n.eventLog.query({}).filter((e) => JSON.stringify(e).includes(CIRCLE)).map((e) => `${e.type}:${e.payload?.body?.kind ?? e.payload?.kind ?? ''}`);
    console.info('[pod-sync-phone] PROBE log kinds', JSON.stringify({ anna: kinds(anna), bram: kinds(bram) }).slice(0, 1500));
    console.info('[pod-sync-phone] PROBE bram all', bram.copyLog().split('\n').slice(-40).join(' | ').slice(0, 4000));
    console.info('[pod-sync-phone] PROBE anna gov', anna.copyLog().split('\n').filter((l) => /gov|polic|lane|pull|rail|statement/i.test(l)).slice(-12).join(' | '));
    console.info('[pod-sync-phone] PROBE bram gov', bram.copyLog().split('\n').filter((l) => /gov|polic|lane|pull|rail|statement|join/i.test(l)).slice(-15).join(' | '));
    console.info('[pod-sync-phone] PROBE policy', JSON.stringify({ anna: (await anna.policyOf(CIRCLE))?.pod ?? null, bram: (await bram.policyOf(CIRCLE))?.pod ?? null, bramFull: await bram.policyOf(CIRCLE) }).slice(0, 600));

    // Bram away: his phone off the relay (its socket removed, as when the app is closed)
    await bram.agent.relays.remove(relay.url);
    expect((bram.agent.relays.list() ?? []).some((x) => x.url === relay.url && x.connected), 'Bram is off the relay').toBe(false);
    // Anna posts as the circle screen does (CircleLauncherScreen: appendCircleMessage + broadcastFanOut): the line on
    // her event log, then the shared fan-out over the phone's waist, the chat rail signing the entry
    const msgId = `circle-${CIRCLE}-${Date.now()}-pod`;
    const ts = Date.now();
    anna.eventLog.append(circleChatMessageEvent({ msgId, ts, circleId: CIRCLE, actor: 'me', text: TEXT }));
    const sent = await broadcastCircleFanOut({
      rawCallSkill: anna.bundle.callSkill, circleId: CIRCLE, msgId, text: TEXT, ts,
      deliveryStateMap: anna.deliveryMap, onChange: () => {},
      signStatement: (cid, mid) => anna.bundle.agent?.chatRail?.signEntry?.(cid, mid) ?? null,
    });
    console.info('[pod-sync-phone] sent', String(JSON.stringify(sent ?? null)).slice(0, 400), JSON.stringify(anna.deliveryMap?.get?.(msgId) ?? null));
    await new Promise((res) => { setTimeout(res, 3000); });
    // PROBE: what the pod holds under the circle (Anna's own session), and the log lines of both phones
    try {
      const root = created?.storage?.groupPodUri;
      const listing = await annaSession.getAuthenticatedFetch()(root, { headers: { accept: 'text/turtle' } });
      console.info('[pod-sync-phone] PROBE pod listing', listing.status, (await listing.text()).match(/<[^>]+>/g)?.slice(0, 20)?.join(' '));
    } catch (e) { console.info('[pod-sync-phone] PROBE pod listing failed', e?.message); }
    console.info('[pod-sync-phone] PROBE anna log', anna.copyLog().split('\n').filter((l) => /pod|refus|seal|key/i.test(l)).slice(-15).join(' | '));
    await anna.dispose();
    anna = null;
    // …and the relay is gone: nothing Bram reads now can come from it
    await relay.close();

    console.info('[pod-sync-phone] PROBE bram circles', JSON.stringify(await bram.callSkill('pinboard', 'listMyCircles', {})).slice(0, 400), typeof bram.podReadBack?.onForeground);
    const r = await bram.comeToFront();
    console.info('[pod-sync-phone] came to front', JSON.stringify(r));
    console.info('[pod-sync-phone] PROBE bram log', bram.copyLog().split('\n').filter((l) => /pod|refus|seal|key/i.test(l)).slice(-15).join(' | '));
    const seen = await until(() => chatIn(bram).includes(TEXT), { timeout: 20_000, step: 250 });
    expect(seen, `Bram's phone holds the post after coming to the front: ${JSON.stringify(chatIn(bram))}`).toBe(true);
  }, 240_000);
});
