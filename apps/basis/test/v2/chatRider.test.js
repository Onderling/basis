import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog } from '../../src/eventLog.js';
import {
  makeChatRail, makeChatEmitter, makeChatPeerHandler,
  CHAT_STATEMENT_BROADCAST, CHAT_CATCHUP_SUBTYPES,
} from '../../src/v2/chatRail.js';
import { makeFrontierReplay } from '../../src/v2/frontierReplay.js';

// The chat lane's acceptance: a sent message is ONE signed render entry on the device log — it shows as
// the bubble (non-silent, payload.text) AND carries its proof (payload.statement). Receivers verify
// before anything renders; a forged statement never lands; an evicted (no-roster-row) author is refused
// at the door; a hostile reuse of someone's msgId cannot overwrite their message; mute stays a view
// filter; the offline device converges through the windowed, consent-gated replay.

const CIRCLE = 'circle:chat';

/** A member device over the REAL EventLog (the render path is the point here). */
async function device(ref, rosterAll) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const row = rosterAll.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  const eventLog = new EventLog({ initial: [] });
  const wire = [];
  const rail = makeChatRail({
    eventLog,
    circleIdentityFor: async () => cid,
    myRef: ref,
    callSkill: async () => ({}),
    verifyBinding: async ({ author, ref: r }) => rosterAll.some((m) => m.circleAddress === author && m.webid === r),
  });
  const emit = makeChatEmitter({ rail, fan: (circleId, statement) => wire.push({ from: ref, circleId, statement }) });
  const receiver = makeChatPeerHandler({ rail });
  return { ref, cid, eventLog, rail, emit, receiver, wire };
}

const deliver = async (fromDev, toDev) => {
  while (fromDev.wire.length) {
    const w = fromDev.wire.shift();
    await toDev.receiver(null, { subtype: CHAT_STATEMENT_BROADCAST, circleId: w.circleId, event: w.statement });
  }
};

describe('the chat lane — one signed render entry per message', () => {
  it('a sent message renders locally AND lands verified on the peer as the SAME bubble shape', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const ada = await device('webid:ada', rosterAll);
    const bo  = await device('webid:bo',  rosterAll);

    const entry = await ada.emit(CIRCLE, { msgId: 'm1', ts: 1000, text: 'hoi buur', actor: 'me', scope: 'kring' });
    expect(entry.id).toBe('m1');                                   // the entry IS the render event
    expect(entry.type).toBe('chat-message');
    expect(entry.silent).not.toBe(true);                           // visible — the conversation shows it
    expect(entry.payload.text).toBe('hoi buur');
    expect(entry.payload.statement.sig).toBeTruthy();              // …and carries its proof

    await deliver(ada, bo);
    const onBo = bo.eventLog.query({}).find((e) => e.id === 'm1');
    expect(onBo?.payload.text).toBe('hoi buur');
    expect(onBo?.actor).toBe('webid:ada');                         // derived from the VERIFIED authorRef
    expect(onBo?.payload.statement.body.payload.msgId).toBe('m1'); // msgId inside the signed payload
  });

  it('a FORGED statement (rogue key claiming a member) and a NON-ROSTER (evicted) author are both refused', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const ada = await device('webid:ada', rosterAll);
    const rogue = await AgentIdentity.generate(new VaultMemory());

    // A rogue key claiming bo's ref: signature verifies, the roster binding does not.
    await ada.receiver(null, {
      subtype: CHAT_STATEMENT_BROADCAST, circleId: CIRCLE,
      event: signSpine(rogue, { kind: 'message', circleId: CIRCLE, subject: 'f1', payload: { msgId: 'f1', text: 'planted', authorRef: 'webid:bo' }, parent: null }),
    });
    // An EVICTED member: their key signs fine, but they have no roster row anymore (the fold removed it).
    const evicted = await AgentIdentity.generate(new VaultMemory());
    await ada.receiver(null, {
      subtype: CHAT_STATEMENT_BROADCAST, circleId: CIRCLE,
      event: signSpine(evicted, { kind: 'message', circleId: CIRCLE, subject: 'f2', payload: { msgId: 'f2', text: 'still here?', authorRef: 'webid:gone' }, parent: null }),
    });
    expect(ada.eventLog.query({}).filter((e) => e.type === 'chat-message')).toHaveLength(0);
  });

  it('a hostile reuse of someone\'s msgId can NEVER overwrite their message', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }, { webid: 'webid:mal', role: 'member' }];
    const ada = await device('webid:ada', rosterAll);
    const bo  = await device('webid:bo',  rosterAll);
    const mal = await device('webid:mal', rosterAll);

    await bo.emit(CIRCLE, { msgId: 'target', text: 'origineel', ts: 1 });
    await deliver(bo, ada);
    // mal is a REAL member (valid signature, valid binding) but tries to land on bo's msgId.
    await mal.emit(CIRCLE, { msgId: 'target', text: 'overschreven', ts: 2 });
    await deliver(mal, ada);

    const onAda = ada.eventLog.query({}).find((e) => e.id === 'target');
    expect(onAda.payload.text).toBe('origineel');                  // bo's message stands
    // The author's OWN resend on the same msgId still replaces (their edit-by-resend).
    await bo.emit(CIRCLE, { msgId: 'target', text: 'origineel v2', ts: 3 });
    await deliver(bo, ada);
    expect(ada.eventLog.query({}).find((e) => e.id === 'target').payload.text).toBe('origineel v2');
  });

  it('MUTE is NOT an ingest refusal: a muted member\'s message still lands (hiding is the projection\'s job)', async () => {
    // The sitting's call: mute = a view filter (the conversation projection hides by actor; unmute
    // restores history because nothing was discarded); eviction = the refusal, via the roster binding.
    // So the RAIL must land a muted author's message — refusing here would silently discard history.
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const ada = await device('webid:ada', rosterAll);
    const bo  = await device('webid:bo',  rosterAll);

    await bo.emit(CIRCLE, { msgId: 'muted-1', text: 'toch gestuurd', ts: 1 });
    await deliver(bo, ada);
    const landed = ada.eventLog.query({}).find((e) => e.id === 'muted-1');
    expect(landed).toBeTruthy();
    expect(landed.actor).toBe('webid:bo');   // the actor the projection's hide-filter keys on
  });

  it('re-delivery reports existed (the replay\'s progress guard) and never double-renders', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:bo', role: 'member' }];
    const ada = await device('webid:ada', rosterAll);
    const bo  = await device('webid:bo',  rosterAll);
    const { statement } = await ada.rail.appendMessage(CIRCLE, { msgId: 'd1', text: 'één keer', ts: 1 });
    expect((await bo.rail.ingest(CIRCLE, statement)).existed).toBe(false);
    expect((await bo.rail.ingest(CIRCLE, statement)).existed).toBe(true);
    expect(bo.eventLog.query({}).filter((e) => e.id === 'd1')).toHaveLength(1);
  });

  it('the offline device converges through the windowed replay, consent-gated above the threshold', async () => {
    const rosterAll = [{ webid: 'webid:ada', role: 'admin' }, { webid: 'webid:cato', role: 'member' }];
    const ada  = await device('webid:ada', rosterAll);
    const cato = await device('webid:cato', rosterAll);
    for (let i = 0; i < 5; i += 1) await ada.emit(CIRCLE, { msgId: `m${i}`, text: `bericht ${i}`, ts: i });
    ada.wire.length = 0;                                           // cato was offline for all of it

    const toCato = [];
    const serve = makeFrontierReplay({
      rail: ada.rail, subtypes: CHAT_CATCHUP_SUBTYPES, offerThreshold: 2,
      sendToPeer: (a, p) => toCato.push(p),
    });
    const offers = [];
    const toAda = [];
    const pull = makeFrontierReplay({
      rail: cato.rail, subtypes: CHAT_CATCHUP_SUBTYPES, autoAllow: 2,
      sendToPeer: (a, p) => toAda.push(p),
      onOffer: (o) => offers.push(o),                              // the chat surface's consent seam
    });
    const route = async () => {
      while (toAda.length || toCato.length) {
        while (toAda.length) { const p = toAda.shift(); if (p.subtype === CHAT_CATCHUP_SUBTYPES.request) await serve.onRequest('peer:cato', p); }
        while (toCato.length) {
          const p = toCato.shift();
          if (p.subtype === CHAT_CATCHUP_SUBTYPES.offer) await pull.onOffer('peer:ada', p);
          else await pull.onBatch('peer:ada', p);
        }
      }
    };
    await pull.requestFrom('peer:ada', CIRCLE);
    await route();
    expect(offers).toHaveLength(1);                                // 5 > threshold, above auto-allow → ask
    expect(cato.eventLog.query({}).filter((e) => e.type === 'chat-message')).toHaveLength(0);   // consent pending
    await offers[0].allow();
    await route();
    const msgs = cato.eventLog.query({}).filter((e) => e.type === 'chat-message');
    expect(msgs).toHaveLength(5);                                  // the history arrived, verified, rendered
    expect(msgs.every((e) => e.payload.statement?.sig)).toBe(true);
  });
});
