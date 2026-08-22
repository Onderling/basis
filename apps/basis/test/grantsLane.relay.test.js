/**
 * THE GRANTS LANE OVER A REAL RELAY — the marquee stories (pair on the phone, act at the laptop's
 * door; then the live revoke) on the transport where per-device addressing is REAL: a ws relay socket, alias
 * binding answered with the per-circle key's signed challenge, and the fan riding hold-forward.
 * The in-process bus walk (`grantsLaneJourneys.test.js`) covers all nine journeys; this closes
 * the seam the bus cannot: the production relay transport end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity, CIRCLE_ADDRESS_ANNOUNCE_KIND } from '@onderling/core';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown,
} from './support/pairRealAgents.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { actAsConnection, trustForGrant } from './support/actAsConnection.js';
import { CONNECTION_MANIFESTS } from '../src/v2/connectionManifests.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'grants-relay-circle';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };

describe('grants lane over a real relay — paired on the phone, revoked for the laptop too', () => {
  let relay; let relayUrl; let P; let L; let B; let V;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    relayUrl = relay.url;
    V = await AgentIdentity.generate(new VaultMemory());

    P = await bootRealAgentNode('P', {
      agentOpts: {
        ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(),
        a2aManifests: CONNECTION_MANIFESTS, deviceLog: new EventLog({ initial: [], muted: [] }),
      },
    });
    B = await bootRealAgentNode('B');
    await connectNodesOverRelay([P, B], { relayUrl });
    await pairCircle(P, B, { groupId: GROUP, name: 'Grants relay walk', handle: 'bea' });
    await bindCircleAddresses([P, B], GROUP);

    // L enrolls with Anna's phrase (the ceremony) and boots as her second device.
    const vaultsL = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('L-pre', { agentOpts: vaultsL });
    const phrase = (await P.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const enrolled = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'laptop' });
    expect(enrolled.ok).toBe(true);
    await teardown(pre);
    L = await bootRealAgentNode('L', {
      agentOpts: { ...vaultsL, a2aManifests: CONNECTION_MANIFESTS, deviceLog: new EventLog({ initial: [], muted: [] }) },
    });
    expect(L.pubKey).toBe(P.pubKey);
    await connectNodesOverRelay([L], { relayUrl });
    await bindCircleAddresses([L], GROUP);   // the SIGNED alias challenge — real on a relay

    // L's re-announce over the relay grows P's own roster row into the proven address SET —
    // the grants fan's sibling target. Addressed to P's PER-CIRCLE alias: on a relay the shared
    // profile key is one address one socket, so a sibling is reachable only at its per-device
    // circle addresses — exactly the production re-announce shape.
    const addrL = L.agent.circleAddressFor(GROUP);
    const addrP = P.agent.circleAddressFor(GROUP);
    const mine = ownAnnouncementFor({ agent: L.agent, circleId: GROUP });
    await L.agent.sendPeerMessage(addrP, {
      type: 'p2p-chat', subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND, circleId: GROUP,
      msgId: 'relay-announce-l', ts: Date.now(), announcements: [mine],
    }, SEND);
    const row = await until(async () => {
      const res = await P.agent.callSkill('stoop', 'listGroupMembers', { groupId: GROUP });
      const r = (res?.members ?? []).find((m) => m.webid === P.pubKey);
      return (r?.circleAddresses?.includes(addrL)) ? r : null;
    }, { timeout: 20000, step: 100 });
    expect(row, 'P never learned L\'s proven address over the relay').toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await teardown(P, L, B);
    try { await relay?.close?.(); } catch { /* */ }
  });

  it('a grant paired on P admits V at L\'s door; the revoke on P refuses it there, live', async () => {
    const act = async (node, token) => {
      await trustForGrant(node.agent, V.pubKey);
      return actAsConnection(node.agent, {
        callerPubKey: V.pubKey, opId: 'params.set-param',
        args: { key: 'display.theme', value: 'dark' }, token: token?.toJSON?.() ?? token,
      });
    };

    const grant = await P.agent.callSkill('household', 'grantSurface', {
      viewPubKey: V.pubKey, ops: ['params.set-param'], label: 'hallway screen',
    });
    expect(grant.ok).toBe(true);

    // The statement crossed the RELAY: L's fold holds the grant, and V acts at L's door.
    const onL = await until(async () =>
      (((await L.agent.callSkill('household', 'listSurfaceGrants', {})).surfaces ?? []).length === 1 ? true : null),
    { timeout: 20000, step: 100 });
    expect(onL, 'the grant never crossed the relay to L').toBe(true);
    expect((await act(L, grant.tokens[0])).ok).toBe(true);

    // The revoke on P closes L's door — no reboot, no manual sync.
    expect(await P.agent.callSkill('household', 'revokeSurface', { viewPubKey: V.pubKey }))
      .toMatchObject({ ok: true, revoked: true });
    const refused = await until(async () => {
      const r = await act(L, grant.tokens[0]);
      return r.ok === false && r.code === 'INVALID_TOKEN' ? r : null;
    }, { timeout: 20000, step: 100 });
    expect(refused, 'L\'s door kept admitting after the relay-carried revoke').toBeTruthy();
  }, 120_000);
});
