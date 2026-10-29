/**
 * A RESTORED DEVICE REJOINS A PERSONA'S CIRCLE — AS THE PERSONA, WITHOUT READMISSION (persona arc e2). The mechanism
 * every restore uses: the member is the same webid on every device (the phrase derives it), so a new device only adds
 * its own per-circle address to that member's proven set — announced with its proof, then the lanes pulled. In a
 * persona's circle the member is the persona: the co-member must see the new address under the PERSONA, and nothing
 * of the default on that circle's roster.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory, RootKeyStoreVault } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat, until, teardown } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { consumeEnrollOffer } from '../src/v2/enrollOffer.js';
import { EventLog } from '../src/eventLog.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const Y = 'buurt-circle';
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const log = () => new EventLog({ initial: [], muted: [] });

describe('a restored device rejoins a persona\'s circle as the persona', () => {
  let relay; const nodes = [];
  afterAll(async () => { await teardown(...nodes); await relay?.close?.(); });

  it('the co-member sees the new device\'s address under the PERSONA — no readmission, nothing of the default', async () => {
    relay = await startJourneyRelay();
    const phone = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: log() } });
    const cor = await bootRealAgentNode('cor', { agentOpts: { deviceLog: log() } });
    nodes.push(phone, cor);
    await connectNodesOverRelay([phone, cor], { relayUrl: relay.url });
    const b = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Buurt' })).id;
    const B = phone.agent.persona(b);
    // Buurt founds Y (bound before the create, on its own socket); Cor joins it
    expect((await phone.agent.callSkill('household', 'bindCirclePersona', { circleId: Y, personaId: b, relayUrl: relay.url })).ok).toBe(true);
    await createCircle(phone, { groupId: Y, name: 'Buurt' });
    await bindCircleAddresses([phone], Y);
    await joinExistingCircle(phone, cor, { groupId: Y, handle: 'cor' });
    for (const n of [phone, cor]) { await bindCircleAddresses([n], Y); await bindCircleAddressKeysFor({ agent: n.agent, circleId: Y }); }
    const phrase = (await phone.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const file = (await phone.agent.callSkill('household', 'exportRecoveryFile', {}))?.file;
    expect(typeof file).toBe('string');

    // a NEW device: the phrase, the file, Buurt received — then the boot that rejoins
    const ownerRootVault = new VaultMemory();
    // what a shell keeps on its disk across the restart: the vaults, the registry, the circle stores and the device log
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-rejoin-'));
    const vaults = { ownerRootVault, rootKeyStore: new RootKeyStoreVault({ vault: ownerRootVault }), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), pinboardPersistDb: { path: path.join(dir, 'pinboard-state.json') },
      // the circles' own stores are durable on a device, as on every shell: the roster trail lives there
      householdPersistDb: { path: path.join(dir, 'household-state.json') } };
    const d2Log = log();
    const storage = memStorage();
    const pre = await bootRealAgentNode('d2-pre', { agentOpts: { ...vaults } });
    expect((await pre.agent.callSkill('household', 'restoreOwnerPhrase', { mnemonic: phrase })).ok).toBe(true);
    await teardown(pre);
    const mid = await bootRealAgentNode('d2-mid', { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: d2Log } });
    expect((await mid.agent.callSkill('household', 'importRecoveryFile', { file }))?.ok).toBe(true);
    const got = await mid.agent.callSkill('household', 'receivePersonas', { mnemonic: phrase, personas: [b] });
    expect(got.ok, JSON.stringify(got)).toBe(true);
    // the shell's stores write behind; a person restarts after the write has landed (the file's temp copy is gone)
    await until(async () => (fs.existsSync(path.join(dir, 'pinboard-state.json')) && !fs.existsSync(path.join(dir, 'pinboard-state.json.tmp'))
      && fs.statSync(path.join(dir, 'pinboard-state.json')).size > 1000) || null, { timeout: 10_000, step: 100 });
    await teardown(mid);
    const d2 = await bootRealAgentNode('d2', { agentOpts: { ...vaults, enrollOfferStorage: storage, deviceLog: d2Log } });
    nodes.push(d2);
    expect(d2.agent.circleSelf(Y).webid, 'Y is Buurt\'s on the new device').toBe(B.chatId.pubKey);
    await d2.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => d2._routerRef.fn?.(env), awaitRelayReady: true });
    await d2.agent.sa.relays.add(relay.url, { identity: d2.agent.persona(b).chatId, awaitReady: true });   // Buurt's own socket
    await bindCircleAddresses([d2], Y);
    // the boot's consume of the stashed bootstrap — the same call the shells make
    const consumed = await consumeEnrollOffer({
      agent: d2.agent, callSkill: (a, o, x) => d2.agent.callSkill(a, o, x),
      sendPeerMessage: (to, p, o) => d2.agent.sendPeerMessage(to, p, o), storage,
    });
    const row = consumed?.circles?.find((c) => c.circleId === Y);
    expect(row?.steps ?? [], JSON.stringify(consumed)).toContain('announce');

    const d2Addr = d2.agent.circleAddressFor(Y);
    const atCor = await until(async () => {
      const members = (await cor.agent.callSkill('pinboard', 'listGroupMembers', { groupId: Y }))?.members ?? [];
      const mine = members.find((m) => m.webid === B.chatId.pubKey);
      return (mine?.circleAddresses ?? []).includes(d2Addr) ? members : null;
    }, { timeout: 30_000, step: 300 });
    expect(atCor, 'Cor learned the new device\'s address under Buurt').toBeTruthy();
    expect(JSON.stringify(atCor).includes(phone.pubKey), 'nothing of the default on Buurt\'s circle').toBe(false);
    // no readmission: still the same two members, and the steps were the bootstrap's own (no invite, no redeem)
    expect(atCor.map((m) => m.webid).sort(), 'the same two members').toEqual([B.chatId.pubKey, cor.pubKey].sort());
    expect(row.steps.some((s) => /redeem|invite/.test(s)), JSON.stringify(row.steps)).toBe(false);
    // the circle is on the new device with its roster
    const atD2 = await until(async () => {
      const members = (await d2.agent.callSkill('pinboard', 'listGroupMembers', { groupId: Y }))?.members ?? [];
      return members.some((m) => m.webid === cor.pubKey) ? members : null;
    }, { timeout: 20_000, step: 300 });
    expect(atD2, 'Cor is on Y\'s roster on the new device').toBeTruthy();
    // the first device is untouched: Y is still Buurt's there, and its address stays in Buurt's set at Cor
    const phoneAddr = phone.agent.circleAddressFor(Y);
    expect(phone.agent.circleSelf(Y).webid).toBe(B.chatId.pubKey);
    expect(atCor.find((m) => m.webid === B.chatId.pubKey).circleAddresses, 'both devices under Buurt').toEqual(expect.arrayContaining([phoneAddr, d2Addr]));

    // what Cor says in Y reaches the new device. A restore is a replacement, as for the default: the new device is
    // announced as Buurt's PRIMARY address, so that is where Cor delivers (the first device keeps its proven address).
    const primaryAtCor = await until(async () => {
      const r = ((await cor.agent.callSkill('pinboard', 'listGroupMembers', { groupId: Y }))?.members ?? []).find((m) => m.webid === B.chatId.pubKey);
      return r?.circleAddress === d2Addr ? r : null;
    }, { timeout: 20_000, step: 300 });
    expect(primaryAtCor, 'the new device is Buurt\'s primary at Cor').toBeTruthy();
    const sent = await sendCircleChat(cor, { groupId: Y, msgId: 'cor-1', text: 'welkom terug' });
    expect(sent?.error ?? null, JSON.stringify(sent)).toBe(null);
    const heard = (n) => until(async () => n.chatRail.storedStatements(Y).find((st) => st?.body?.payload?.text === 'welkom terug') ?? null, { timeout: 20_000, step: 200 });
    expect(await heard(d2), 'Cor\'s message reached the new device').toBeTruthy();
  }, 300_000);
});
