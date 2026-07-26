/**
 * No-pod group-key rotation across THREE devices — stories 11.2 + 11.3 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * The rotation loop that keeps a NO-POD circle readable: `controlAgent.removeMember` rotates the key and
 * emits it as a log key-event; `keyEventLogSink` records it locally and FANS it to the event's recipients;
 * each member records what it receives and folds its own key CHAIN on read. There is no pod anywhere in
 * that path — the log is the source of truth.
 *
 * The property under test is the one that keeps biting elsewhere in this codebase: **does the rotation reach
 * the BYSTANDER?** Removing Cato must leave Bram — who did nothing, and may have been offline — able to read
 * both the content sealed before the removal and the content sealed after it, while Cato keeps only what
 * they could already read. Two devices can't express it: with only remover + removed, there is no bystander.
 *
 * Cast: Anna (admin/controller) · Bram (member, the bystander) · Cato (member, removed).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createControlAgent, generateKeypair, makeOpener,
  readKeyChain, currentGroupKey, openAcrossKeyChain, sealWithGroupKey,
} from '@onderling/pod-client';
import { makeKeyEventLogSink, recipientAddrsFromRoster } from '@onderling/kring-host/keyEventLogSink';

/**
 * Three devices around one control agent. Each member keeps its OWN key-event log (what it actually
 * received) — never a shared view — so an offline member's chain is exactly what reached it.
 * A partitioned device HOLDS its fan and flushes on reconnect, as the relay's hold-forward does.
 */
function circle() {
  const anna = { ...generateKeypair(), ref: 'did:anna' };
  const bram = { ...generateKeypair(), ref: 'did:bram' };
  const cato = { ...generateKeypair(), ref: 'did:cato' };

  const logs = { 'did:anna': [], 'did:bram': [], 'did:cato': [] };   // per-device key-event logs
  const online = { 'did:anna': true, 'did:bram': true, 'did:cato': true };
  const held = { 'did:anna': [], 'did:bram': [], 'did:cato': [] };

  // The live roster the fan resolves addresses from (control agent members + their sealing keys).
  let roster = [
    { webId: anna.ref, addr: anna.ref, publicKey: anna.publicKey, role: 'admin' },
    { webId: bram.ref, addr: bram.ref, publicKey: bram.publicKey, role: 'member' },
    { webId: cato.ref, addr: cato.ref, publicKey: cato.publicKey, role: 'member' },
  ];

  let stored = null;
  const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
  const sharing = { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };

  const deliver = (addr, payload) => { logs[addr]?.push(payload.event); };
  const keyEventLog = makeKeyEventLogSink({
    groupId: 'c1',
    resolveRecipientAddrs: (event) => recipientAddrsFromRoster(event, roster),
    sendPeer: (addr, payload) => {
      if (online[addr]) deliver(addr, payload);
      else held[addr].push(payload);                 // hold-forward while partitioned
    },
    recordLocal: (event) => { logs[anna.ref].push(event); },   // the emitter folds its own event
  });

  const agent = createControlAgent({
    sharing, containerUri: 'https://pod/c1/', keyStore, controllerKey: anna,
    roster: [{ webId: anna.ref, publicKey: anna.publicKey, role: 'admin' }],
    keyEventLog, groupId: 'c1',
  });

  /** A member's key CHAIN — folded from only what THAT device received. */
  const chainOf = (who) => readKeyChain(logs[who.ref], { groupId: 'c1', opener: makeOpener(who.privateKey) });

  return {
    anna, bram, cato, agent, logs, roster,
    setRoster: (r) => { roster = r; },
    partition: (who) => { online[who.ref] = false; },
    reconnect: (who) => {
      online[who.ref] = true;
      for (const p of held[who.ref].splice(0, held[who.ref].length)) deliver(who.ref, p);
    },
    chainOf,
    /** Seal content under the key version the CONTROLLER currently holds (what the app would do). */
    sealNow: (text) => sealWithGroupKey(text, currentGroupKey(chainOf(anna))),
    canRead: (who, sealed) => {
      try { return openAcrossKeyChain(sealed, chainOf(who)); } catch { return null; }
    },
  };
}

async function joinAll(c) {
  await c.agent.addMember({ webId: c.bram.ref, publicKey: c.bram.publicKey });
  await c.agent.addMember({ webId: c.cato.ref, publicKey: c.cato.publicKey });
}

describe('11.2 — removing one member reaches the bystander too', () => {
  it('Bram keeps reading across the rotation; Cato keeps only what came before it', async () => {
    const c = circle();
    await joinAll(c);

    const before = c.sealNow('pre-rotation content');
    expect(c.canRead(c.bram, before)).toBe('pre-rotation content');
    expect(c.canRead(c.cato, before)).toBe('pre-rotation content');

    await c.agent.removeMember({ webId: c.cato.ref });          // rotation + fan to the remaining
    const after = c.sealNow('post-rotation content');

    // The BYSTANDER — did nothing, must lose nothing and gain the new version.
    expect(c.canRead(c.bram, before)).toBe('pre-rotation content');
    expect(c.canRead(c.bram, after)).toBe('post-rotation content');
    // The REMOVED member — keeps what they could already read, gets nothing new (backward secrecy).
    expect(c.canRead(c.cato, before)).toBe('pre-rotation content');
    expect(c.canRead(c.cato, after)).toBeNull();
  });

  it('Anna and Bram converge on the SAME current key version', async () => {
    const c = circle();
    await joinAll(c);
    await c.agent.removeMember({ webId: c.cato.ref });

    const annaChain = c.chainOf(c.anna);
    const bramChain = c.chainOf(c.bram);
    expect(currentGroupKey(bramChain)).toBe(currentGroupKey(annaChain));
    expect(bramChain[0].version).toBe(annaChain[0].version);
    // Cato's chain stops at the pre-rotation version — it never advanced.
    expect(c.chainOf(c.cato)[0].version).toBeLessThan(annaChain[0].version);
  });

  it('the removed member is not even ADDRESSED by the rotation fan', async () => {
    const c = circle();
    await joinAll(c);
    const catoEventsBefore = c.logs[c.cato.ref].length;

    await c.agent.removeMember({ webId: c.cato.ref });

    expect(c.logs[c.cato.ref].length).toBe(catoEventsBefore);   // nothing was sent to them at all
    expect(c.logs[c.bram.ref].length).toBeGreaterThan(catoEventsBefore - 1);
  });
});

describe('11.3 — the bystander was OFFLINE during the removal', () => {
  it('Bram catches the rotation up on reconnect and loses nothing he could read before', async () => {
    const c = circle();
    await joinAll(c);
    const before = c.sealNow('pre-rotation content');

    c.partition(c.bram);                                        // Bram goes offline…
    await c.agent.removeMember({ webId: c.cato.ref });          // …through the whole removal
    const after = c.sealNow('post-rotation content');

    // While away he cannot read the new content — he simply never received that version.
    expect(c.canRead(c.bram, after)).toBeNull();
    expect(c.canRead(c.bram, before)).toBe('pre-rotation content');   // but loses nothing

    c.reconnect(c.bram);                                        // the held key-event flushes

    expect(c.canRead(c.bram, after)).toBe('post-rotation content');
    expect(c.canRead(c.bram, before)).toBe('pre-rotation content');   // still intact
    expect(currentGroupKey(c.chainOf(c.bram))).toBe(currentGroupKey(c.chainOf(c.anna)));
  });

  it('a re-delivered key-event does not corrupt or duplicate the chain', async () => {
    const c = circle();
    await joinAll(c);
    c.partition(c.bram);
    await c.agent.removeMember({ webId: c.cato.ref });
    c.reconnect(c.bram);

    const once = c.chainOf(c.bram);
    // Replay every event Bram already holds (a duplicate flush).
    for (const e of [...c.logs[c.bram.ref]]) c.logs[c.bram.ref].push(e);
    const twice = c.chainOf(c.bram);

    expect(twice.map((v) => v.version)).toEqual(once.map((v) => v.version));   // de-duped by version
    expect(currentGroupKey(twice)).toBe(currentGroupKey(once));
  });
});
