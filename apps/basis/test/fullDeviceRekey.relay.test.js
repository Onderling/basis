/**
 * REVOKING A FULL DEVICE RE-KEYS THE PERSONA. Since one address per persona per circle, every full device of the person
 * holds the persona's circle root and presents its address; retiring the lost device's own derived addresses therefore
 * leaves it able to sign and open as the person. The ceremony closes that: the persona's circle root moves to the next
 * epoch, the new address is introduced in every circle, the group key rotates past the old address, the old address is
 * retired — and the revoked device, which only holds the old root, opens nothing sealed after it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses,
  sealCircleViaProducer, postSealed, readSealed, until, teardown,
} from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';

const CIRCLE = 'full-device-rekey';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };

describe('revoking a full device re-keys the persona', () => {
  let relay; let A; let B; let A2;
  afterAll(async () => { await teardown(A, B, A2); try { await relay?.close?.(); } catch { /* */ } });

  it('the phone revokes the box: a new persona address in the circle, the old one retired, and the box opens nothing sealed after', async () => {
    relay = await startJourneyRelay();
    [A, B] = await Promise.all([
      // as a shell composes them: each with its device log (the membership lane rides it)
      bootRealAgentNode('A', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), deviceLog: new EventLog({ initial: [], muted: [] }) } }),
      bootRealAgentNode('B', { agentOpts: { deviceLog: new EventLog({ initial: [], muted: [] }) } }),
    ]);
    await connectNodesOverRelay([A, B], { relayUrl: relay.url });
    await createCircle(A, { groupId: CIRCLE, name: 'Re-key' });
    const joined = await joinExistingCircle(A, B, { groupId: CIRCLE, handle: 'bea' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await bindCircleAddresses([A, B], CIRCLE);
    await Promise.all([A, B].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    await sealCircleViaProducer({ admin: A, members: [B], groupId: CIRCLE });
    expect(await until(() => (B.keyEventStore.list(CIRCLE).length > 0 ? true : null), { timeout: 10000, step: 50 })).toBe(true);

    // the box: a FULL device of Anna's (enrolled through the real offer — it holds her circle root)
    const built = await A.agent.callSkill('household', 'buildEnrollOffer', {});
    expect(built.ok, JSON.stringify(built)).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, built.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: { ...vaults, enrollOfferStorage: storage } });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', { agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    await connectNodesOverRelay([A2], { relayUrl: relay.url });
    await bindCircleAddresses([A2], CIRCLE);
    const consumed = await consumeEnrollOffer({
      agent: A2.agent, callSkill: (a, o, x) => A2.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => A2.agent.sendPeerMessage(to, p, o), storage,
    });
    expect(consumed.circles?.find((c) => c.circleId === CIRCLE)?.ok, JSON.stringify(consumed)).toBe(true);
    const oldAddr = A.agent.circleAddressFor(CIRCLE);
    expect(A2.agent.circleAddressFor(CIRCLE), 'the box is not a full device of Anna (another address)').toBe(oldAddr);

    const beaIngests = [];
    { const rail = B.agent.membershipRail; const orig = rail.ingest.bind(rail);
      rail.ingest = async (cid, st) => { const r = await orig(cid, st); beaIngests.push(`${st?.body?.kind}:${String(st?.body?.hash).slice(0, 6)}:${r?.ok ? 'ok' : r?.reason}`); return r; }; }
    const beaKeyIngests = [];
    { const rail = B.agent.keyRail; const orig = rail.ingest.bind(rail);
      rail.ingest = async (cid, st) => { const r = await orig(cid, st); beaKeyIngests.push(`${String(st?.body?.author).slice(0, 6)}:${r?.ok ? 'ok' : r?.reason}`); return r; }; }
    // the phone revokes the box
    const boxId = A2.agent.persona('default').enrolledDevice?.deviceId;
    expect(boxId, 'the box has no device id').toBeTruthy();
    const r = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: boxId, circleIds: [CIRCLE] });
    expect(r?.ok, JSON.stringify(r)).toBe(true);

    // Anna presents a NEW address, and Bea's roster carries it — and no longer the old one
    expect(await until(() => (A.agent.circleAddressFor(CIRCLE) !== oldAddr ? true : null), { timeout: 20000, step: 200 }),
      'the phone still presents the address the revoked box holds').toBe(true);
    const newAddr = A.agent.circleAddressFor(CIRCLE);
    const annaOnBea = async () => (((await B.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? []).find((m) => m.webid === A.pubKey) ?? null);
    expect(await until(async () => { const row = await annaOnBea(); const set = [row?.circleAddress, ...(row?.circleAddresses ?? [])]; return set.includes(newAddr) && !set.includes(oldAddr) ? true : null; }, { timeout: 20000, step: 200 }),
      `Bea ingested ${JSON.stringify(beaIngests.slice(-8))}; Bea holds ${JSON.stringify((B.agent.membershipRail.storedStatements(CIRCLE) ?? []).map((x) => `${x.body.kind}:${x.body.hash.slice(0, 6)}`).slice(-6))}, verified-disputed ${JSON.stringify([...((await B.agent.membershipRail.readVerified(CIRCLE)).disputed ?? [])].map((d) => String(d).slice(0, 6)))}; Bea's row for Anna does not show the move: ${JSON.stringify((({ circleAddress: p, circleAddresses: set, retiredAddresses: gone } = {}) => ({ primary: p === newAddr ? 'NEW' : p === oldAddr ? 'OLD' : p, set: (set ?? []).map((a) => (a === newAddr ? 'NEW' : a === oldAddr ? 'OLD' : a.slice(0, 6))), retired: (gone ?? []).map((g) => (g?.address === oldAddr ? 'OLD' : String(g?.address).slice(0, 6))) }))(await annaOnBea() ?? {}))}`).toBe(true);
      const evs = A.keyEventStore.list(CIRCLE);
    // what Anna seals next: Bea reads it, the old root's key opens nothing
    const env = await postSealed({ admin: A, members: [B], groupId: CIRCLE, text: 'na de nieuwe sleutel' });
    const beaReads = await until(() => { try { return readSealed(B, env, CIRCLE) === 'na de nieuwe sleutel' ? true : null; } catch { return null; } }, { timeout: 15000, step: 200 });
    let why = null; try { readSealed(B, env, CIRCLE); } catch (e) { why = e?.message; }
    expect(beaReads, `Bea cannot read after the re-key: Bea's key ingests ${JSON.stringify(beaKeyIngests)}, Bea's store ${JSON.stringify(B.keyEventStore.list(CIRCLE).map((e) => e.version))}, phone's ${JSON.stringify(A.keyEventStore.list(CIRCLE).map((e) => e.version))}; ${why}`).toBe(true);
    const { Bootstrap, deriveCircleRoot, deriveCircleSeed, b64encode } = await import('@onderling/core');
    const { sealingKeyPairFromNetworkKey, readKeyChain, openAcrossKeyChain, open } = await import('@onderling/pod-client');
    const { keyEventsFromRail } = await import('../src/v2/keyRail.js');
    const oldRoot = deriveCircleRoot(Bootstrap.fromMnemonic(phrase).deriveAgentSeed('default'), 0);
    const boxPriv = sealingKeyPairFromNetworkKey(b64encode(deriveCircleSeed(oldRoot, CIRCLE))).privateKey;
    let boxChain = [];
    try { boxChain = readKeyChain(await keyEventsFromRail(A.agent.keyRail, CIRCLE), { groupId: CIRCLE, opener: (sealed) => open(sealed, boxPriv) }); } catch { boxChain = []; }
    let leaked = null;
    try { leaked = openAcrossKeyChain(env, boxChain); } catch { leaked = null; }
    expect(leaked, 'the revoked box\'s root opened a message sealed after the re-key').not.toBe('na de nieuwe sleutel');
  }, 240_000);
});
