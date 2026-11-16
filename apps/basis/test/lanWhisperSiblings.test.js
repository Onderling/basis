/**
 * TWO PHONES OF ONE PERSON MEET ON THE LAN. Their chat key is the same on every device of the persona, so they used to
 * skip each other as "self", and the sibling carry (addressed to a DEVICE address, which mDNS could not carry) always
 * went by relay. Now each phone speaks a LAN key, and inside the bound channel they whisper a tag under the persona's
 * circle root: they match, each proves its device address, each checks the other against its device map, and the
 * sibling carry crosses the LAN. A device the map has tombstoned still holds the old root and still matches, but its
 * proof is refused by the map: nothing binds.
 *
 * Real agents (createRealHouseholdAgent, a real enrolment), real mDNS transports over loopback sockets, no relay at
 * all: whatever arrives, arrived over the LAN.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { DISCOVERABILITY } from '@onderling/core';
import { setDeviceDelegation, deviceDelegationOf } from '@onderling/agent-registry';
import { MdnsTransport } from '@onderling/transports/mdns';
import { createMdnsNodeBackend, createLoopbackDiscovery } from '@onderling/transports/mdns-node';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(50); } return !!(await fn()); };
const vaults = () => ({ ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() });

async function enrolled(phrase, label) {
  const v = vaults();
  const pre = await createRealHouseholdAgent({ seedHousehold: false, ...v });
  expect((await pre.callSkill('household', 'enrollDevice', { mnemonic: phrase, label })).ok).toBe(true);
  await pre.dispose?.();
  return createRealHouseholdAgent({ seedHousehold: false, ...v });
}
async function hold(agent, rec) {
  const reg = agent.agentsRegistry();
  const entry = await reg.lookup('default');
  await reg.register({ ...entry, properties: setDeviceDelegation(entry.properties ?? {}, rec.deviceId, rec) });
}
const deviceAddress = (agent) => agent.persona('default').enrolledDevice.record.pubKey;

describe('two phones of one person meet on the LAN by the whisper', () => {
  const cleanups = [];
  afterAll(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });
  let A; let B; let phrase;

  beforeAll(async () => {
    A = await createRealHouseholdAgent({ seedHousehold: false, ...vaults() });
    phrase = (await A.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    B = await enrolled(phrase, 'B');
    await hold(A, B.persona('default').enrolledDevice.record);
    await hold(B, A.persona('default').enrolledDevice.record);
    cleanups.push(() => A.dispose?.(), () => B.dispose?.());
  }, 180_000);

  const onTheLan = async (agent, discovery) => {
    const { native, emitter } = createMdnsNodeBackend({ discovery, host: '127.0.0.1' });
    const mdns = new MdnsTransport({ identity: agent.sa.agent.identity, native, emitter });
    mdns.useWhisper(() => agent.lanWhisperSecrets());
    await agent.sa.addSecureTransport('mdns', mdns, { connect: false });
    cleanups.push(() => mdns.disconnect());
    return mdns;
  };

  it('they match, bind each other\'s device address, and a sibling payload crosses mDNS from the device address', async () => {
    expect(A.sa.identity.pubKey, 'one persona, one chat key on both phones').toBe(B.sa.identity.pubKey);
    const discovery = createLoopbackDiscovery();
    const mA = await onTheLan(A, discovery);
    const mB = await onTheLan(B, discovery);
    const atB = [];
    mB.on('envelope', (e) => atB.push(e?._from));
    await mB.setDiscoverability(DISCOVERABILITY.PUBLISH);
    await mA.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(await until(() => mA.canReach(deviceAddress(B)) && mB.canReach(deviceAddress(A))), 'each bound the other\'s device address').toBe(true);

    await A.sendPeerMessage(deviceAddress(B), { subtype: 'lan-sibling-probe', n: 1 }, { guarantee: 'now', retryDelays: [] });
    expect(await until(() => atB.includes(deviceAddress(A))), 'the sibling payload crossed the LAN from A\'s device address').toBe(true);
    expect(atB, 'and never from the shared chat key').not.toContain(A.sa.identity.pubKey);
  }, 60_000);

  it('a revoked device: after the re-key its old root matches nothing; where the root is still shared, the map refuses its proof', async () => {
    const C = await enrolled(phrase, 'C');
    cleanups.push(() => C.dispose?.());
    const cId = C.persona('default').enrolledDevice.deviceId;
    await hold(C, B.persona('default').enrolledDevice.record);
    await hold(A, C.persona('default').enrolledDevice.record);
    // A revokes C: the signed tombstone, and A's circle root moves to the next epoch
    expect((await A.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: cId }))?.ok).toBe(true);
    expect(A.persona('default').circleRoot.epoch).toBeGreaterThan(C.persona('default').circleRoot.epoch);
    const tomb = deviceDelegationOf(await A.agentsRegistry().lookup('default'), cId);
    expect(tomb?.revoked).toBe(true);
    // B has not re-keyed yet (nothing carried): it shares C's old root, and it holds the tombstone
    await hold(B, tomb);
    expect(B.persona('default').circleRoot.epoch).toBe(C.persona('default').circleRoot.epoch);

    const discovery = createLoopbackDiscovery();
    const mA = await onTheLan(A, discovery);
    const mB = await onTheLan(B, discovery);
    const mC = await onTheLan(C, discovery);
    for (const m of [mA, mB, mC]) await m.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(await until(() => mC.canReach(mA.lanAddress) && mC.canReach(mB.lanAddress)), 'all on the LAN').toBe(true);
    // B and C share the old root: they MATCH, and C (whose map still lists B) binds B …
    expect(await until(() => mC.canReach(deviceAddress(B))), 'the old root still matches where it is shared').toBe(true);
    await wait(500);
    // … but B's map holds C's tombstone: the proof is refused, nothing binds
    expect(mB.canReach(deviceAddress(C)), 'B never binds the tombstoned device').toBe(false);
    // A re-keyed: C's old root matches nothing there, either way
    expect(mA.canReach(deviceAddress(C))).toBe(false);
    expect(mC.canReach(deviceAddress(A))).toBe(false);
  }, 120_000);
});
