/**
 * Anna's two devices and Bea, over a real relay — the composition the sibling-carry tests need: Anna's phone and her
 * always-on device (enrolled from the phrase, the same person), Bea a circle member, all three in one circle with each
 * device's proven per-circle address announced and the roster seeded on the enrolled device. What the sibling set
 * reads is then exactly what production reads.
 */
import { expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown, shareDeviceRecords } from './pairRealAgents.js';
import { EventLog } from '../../src/eventLog.js';

// The enrolling device's first words to its sibling speak as the PERSON (its per-circle address is on nobody's roster yet).
export const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [], asPerson: true };

export async function bootAnnaTwoDevices({ group, agentOpts = {} }) {
  const relay = await startJourneyRelay();
  const relayUrl = relay.url;
  const vaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() });
  const logs = {};
  const log = (who) => { logs[who] = new EventLog({ initial: [], muted: [] }); return { deviceLog: logs[who] }; };
  const A = await bootRealAgentNode('phone', { agentOpts: { ...vaults(), ...log('A'), ...agentOpts } });
  const B = await bootRealAgentNode('bea', { agentOpts: { ...log('B'), ...agentOpts } });
  await connectNodesOverRelay([A, B], { relayUrl });
  await pairCircle(A, B, { groupId: group, name: 'Anna en Bea', handle: 'bea' });
  await bindCircleAddresses([A, B], group);

  const secondVaults = vaults();
  const pre = await bootRealAgentNode('always-on-pre', { agentOpts: secondVaults });
  const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
  expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'always-on' })).ok).toBe(true);
  await teardown(pre);
  const A2 = await bootRealAgentNode('always-on', { agentOpts: { ...secondVaults, ...log('A2'), ...agentOpts } });
  expect(A2.pubKey, 'the second device is the same person').toBe(A.pubKey);
  await connectNodesOverRelay([A2], { relayUrl });
  await bindCircleAddresses([A2], group);

  // ONE ADDRESS PER PERSONA PER CIRCLE: Anna's two devices share the circle address, so they meet through the device map
  // (what an enrol offer introduces), and the roster seed is asked of the phone at its DEVICE address.
  expect(A2.agent.circleAddressFor(group), 'one address for Anna in the circle').toBe(A.agent.circleAddressFor(group));
  await shareDeviceRecords([A, A2], 'default');
  const seedRequest = await A2.agent.rosterSeed.buildRequest(group, A2.agent.ownDeviceAddress('default'));
  await A2.agent.sendPeerMessage(A.agent.ownDeviceAddress('default'), seedRequest, { circleId: group });
  expect(await until(async () => {
    const res = await A2.agent.callSkill('pinboard', 'listGroupMembers', { groupId: group });
    return (res?.members ?? []).some((m) => m.webid === B.pubKey) ? true : null;
  }, { timeout: 20000, step: 100 }), 'the always-on device never received the roster seed').toBe(true);
  return { relay, A, B, A2, logs, phrase, close: async () => { await teardown(A, B, A2); await relay?.close?.(); } };
}
