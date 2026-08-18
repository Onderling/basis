/**
 * THE PAIR-A-VIEW WALK OVER A REAL RELAY — the acting half, across the wire it will actually use.
 *
 * The in-process walk calls the door directly. That leaves the production path untested: a view
 * does not call a function, it puts an envelope on a transport, and the acting agent's peer
 * ROUTER dispatches it by subtype. This walk crosses that seam — a real relay process, both ends
 * connected through the app's own `connectPeerTransport`, and the door wired into the inbound
 * router exactly as a shell wires it (one more subtype in the handler map).
 *
 * THE POINT OF THE SHAPE: the view is a BARE KEYPAIR that owns no agent and no address. Its
 * envelope is carried by a DIFFERENT node's transport — so the carrier is not the author, and the
 * door's trust has to come from the token plus the envelope signature rather than from whoever
 * happened to deliver it. If the door ever started trusting the transport, this walk breaks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '@onderling/relay';
import { bootRealAgentNode, connectNodesOverRelay, teardown } from './support/pairRealAgents.js';
import { makeSurfaceActClient, SURFACE_ACT_SUBTYPES } from '../src/v2/surfaceRail.js';

/** First contact over a relay races the HI handshake; hold + retry the way the app does. */
const SEND = { hold: true, firstSendTimeoutMs: 4000 };

describe('the pair-a-view walk over a REAL relay — envelope in, verified, dispatched, replied', () => {
  let relay; let relayUrl; let A; let CARRIER; let view; let client; let grant;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;

    // A is the acting agent (the owner's device). CARRIER is an ordinary node that merely puts
    // the view's envelopes on the wire — it holds no grant and no authority of its own.
    [A, CARRIER] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('carrier')]);
    await connectNodesOverRelay([A, CARRIER], { relayUrl });
    await A.agent.surfaceGrantsReady();

    // The view: a keypair, nothing more.
    view = await AgentIdentity.generate(new VaultMemory());

    grant = await A.agent.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], label: 'relay-view',
    });
    expect(grant.ok).toBe(true);

    // A's shell wiring: the acting door joins the inbound router under its subtype, and replies
    // go back to whoever sent the envelope — the address the door hands to `reply`.
    const door = A.agent.makeSurfaceActDoor({
      reply: (payload, to) => A.agent.sendPeerMessage(to, payload, SEND).catch(() => {}),
    });
    const aPrev = A._routerRef.fn;
    A._routerRef.fn = (env) => (env?.payload?.subtype === SURFACE_ACT_SUBTYPES.request
      ? door(env.from, env.payload)
      : aPrev?.(env));

    // The view side, carried by CARRIER's transport.
    client = makeSurfaceActClient({
      identity: view,
      send: (payload) => CARRIER.agent.sendPeerMessage(A.pubKey, payload, SEND),
      timeoutMs: 20_000,
    });
    const cPrev = CARRIER._routerRef.fn;
    CARRIER._routerRef.fn = (env) => (env?.payload?.subtype === SURFACE_ACT_SUBTYPES.result
      ? client.handleResult(env.payload)
      : cPrev?.(env));
  }, 120_000);

  afterAll(async () => {
    await teardown(A, CARRIER);
    await relay?.stop?.();
  });

  it('the granted op crosses the relay, verifies at the door, and lands on the acting agent', async () => {
    const res = await client.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'dark' },
      token: grant.tokens[0],
    });
    expect(res.ok, `the act did not come back ok: ${JSON.stringify(res)}`).toBe(true);
    expect(A.agent.getParamValue('display.theme')).toBe('dark');
  }, 60_000);

  it('an op outside the picks is refused over the wire, and changes nothing', async () => {
    const res = await client.act({
      group: 'household', op: 'revealOwnerPhrase', args: {}, token: grant.tokens[0],
    });
    expect(res).toEqual({ ok: false, code: 'out-of-scope' });
    expect(A.agent.getParamValue('display.theme')).toBe('dark');
  }, 60_000);

  it('after the owner unpairs it, the same held token is refused over the wire', async () => {
    const rev = await A.agent.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey });
    expect(rev).toMatchObject({ ok: true, revoked: true });

    const res = await client.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'light' },
      token: grant.tokens[0],
    });
    expect(res).toEqual({ ok: false, code: 'revoked' });
    expect(A.agent.getParamValue('display.theme')).toBe('dark');
  }, 60_000);
});
