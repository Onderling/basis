/**
 * A ROTATION RETURNS BEFORE ITS FAN, AND NOTHING SEALED RIGHT AFTER IT IS LOST. Since 2026-11-14 a key event's fan is not
 * awaited by its append (an admission's reply had waited on the fan to the newcomer). So a removal's rotation now
 * returns while the new version is still on its way to the remaining members, and the remover may seal content under
 * that version at once. The open path folds the key chain from whatever key events a device holds when it opens
 * (`readKeyChain` → `openAcrossKeyChain`): content sealed under a version the member has not received yet does not
 * open, and opens once that version's key event lands. Nothing is lost; it waits for the event.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createControlAgent, generateKeypair, makeOpener, readKeyChain, currentGroupKey, openAcrossKeyChain, sealWithGroupKey,
} from '@onderling/pod-client';
import { makeKeyEventLogSink, recipientAddrsFromRoster } from '@onderling/kring-host/keyEventLogSink';

describe('a rotation returns before its fan', () => {
  it('content sealed right after the removal opens at the remaining member once the late key event lands', async () => {
    const anna = { ...generateKeypair(), ref: 'did:anna' };
    const bram = { ...generateKeypair(), ref: 'did:bram' };
    const cato = { ...generateKeypair(), ref: 'did:cato' };
    const logs = { [anna.ref]: [], [bram.ref]: [], [cato.ref]: [] };
    const roster = [anna, bram, cato].map((p, i) => ({ webId: p.ref, addr: p.ref, publicKey: p.publicKey, role: i ? 'member' : 'admin' }));
    let stored = null;
    // every send is held at a gate until the test opens it: the fan is still under way when the append returns
    const pending = [];
    const sink = makeKeyEventLogSink({
      groupId: 'c1',
      resolveRecipientAddrs: (event) => recipientAddrsFromRoster(event, roster),
      sendPeer: (addr, payload) => new Promise((resolve) => { pending.push(() => { logs[addr]?.push(payload.event); resolve({ delivered: true }); }); }),
      recordLocal: (event) => { logs[anna.ref].push(event); },
    });
    const agent = createControlAgent({
      sharing: { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) },
      containerUri: 'https://pod/c1/', keyStore: { read: async () => stored, write: async (r) => { stored = r; } },
      controllerKey: anna, roster: [{ webId: anna.ref, publicKey: anna.publicKey, role: 'admin' }], keyEventLog: sink, groupId: 'c1',
    });
    const chainOf = (who) => readKeyChain(logs[who.ref], { groupId: 'c1', opener: makeOpener(who.privateKey) });
    const deliverAll = async () => { for (const go of pending.splice(0)) go(); await new Promise((r) => { setTimeout(r, 0); }); };

    await agent.addMember({ webId: bram.ref, publicKey: bram.publicKey });
    await agent.addMember({ webId: cato.ref, publicKey: cato.publicKey });
    await new Promise((r) => { setTimeout(r, 0); });
    await deliverAll();
    const before = sealWithGroupKey('voor de wisseling', currentGroupKey(chainOf(anna)));
    expect(openAcrossKeyChain(before, chainOf(bram))).toBe('voor de wisseling');

    // the removal returns while its key event is still at the gate
    await agent.removeMember({ webId: cato.ref });
    await new Promise((r) => { setTimeout(r, 0); });
    expect(pending.length, 'the rotation\'s fan is still under way after the removal returned').toBeGreaterThan(0);
    const after = sealWithGroupKey('na de wisseling', currentGroupKey(chainOf(anna)));
    const tryOpen = (who, sealed) => { try { return openAcrossKeyChain(sealed, chainOf(who)); } catch { return null; } };
    expect(tryOpen(bram, after), 'not yet: Bram has not received the new version').toBeNull();

    await deliverAll();   // the late key event lands
    expect(tryOpen(bram, after)).toBe('na de wisseling');
    expect(tryOpen(bram, before)).toBe('voor de wisseling');
    expect(tryOpen(cato, after), 'the removed member never opens it').toBeNull();
  });
});
