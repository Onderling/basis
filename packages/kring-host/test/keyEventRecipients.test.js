import { describe, it, expect } from 'vitest';
import {
  recipientAddrsFromRoster, recipientWebidsFromRoster, makeKeyEventLogSink,
} from '../src/keyEventLogSink.js';

// Every group-key rotation used to fan to NOBODY.
//
// The resolver reads a member's sealing key off the roster row — `sealingPublicKey ?? sealingPubKey
// ?? publicKey` — and a real roster row carries none of the three: `listGroupMembers` surfaces one
// only when the joiner supplied it at redemption, which the live join flow does not. So the match
// found no one, the fan sent nothing, and the rotation was signed, chained and appended while the
// other members stayed on the old key forever. In a no-pod circle, where the log IS the key source,
// that silently splits the circle.
//
// A member's sealing key is a deterministic function of their network key, so the deriver is
// injected (kring-host must not depend up on pod-client). These pin both halves: that a row with no
// stored key still matches, and that the two projections of that match — addresses for the direct
// peer fan, webids for the waist fan's `only` narrowing — stay in step.
const derive = (networkKey) => `seal(${networkKey})`;

/** A roster row as `listGroupMembers` really returns one: no sealing key of any name. */
const row = (webid, circleAddress) => ({
  webid, pubKey: webid, circleAddress, role: 'member', handle: null, rulesAccepted: '1',
});

const ada = row('webid:ada', 'addr:ada');
const bo = row('webid:bo', 'addr:bo');
const departed = row('webid:cas', 'addr:cas');

/** A key-event sealed to ada + bo (not to the departed member). */
const event = {
  kind: 'group-key-event', groupId: 'circle:k', version: 2,
  recipients: [derive('addr:ada'), derive('addr:bo')],
};

describe('a key-event\'s recipients resolve from a roster that stores no sealing keys', () => {
  it('finds nobody without the deriver — the shape that made every rotation fan into the void', () => {
    expect(recipientAddrsFromRoster(event, [ada, bo])).toEqual([]);
  });

  it('finds the recipients by DERIVING each member\'s sealing key', () => {
    expect(recipientAddrsFromRoster(event, [ada, bo], { deriveSealingKey: derive }))
      .toEqual(['addr:ada', 'addr:bo']);
  });

  it('excludes a member the key was not sealed to — the removed member, without special-casing', () => {
    expect(recipientAddrsFromRoster(event, [ada, bo, departed], { deriveSealingKey: derive }))
      .toEqual(['addr:ada', 'addr:bo']);
  });

  it('a STORED sealing key still wins over deriving one', () => {
    const stored = { ...ada, sealingPublicKey: derive('addr:ada') };
    expect(recipientAddrsFromRoster(event, [stored])).toEqual(['addr:ada']);
  });

  it('the webid projection matches the same members — the fan-out core narrows by webid, not address', () => {
    const opts = { deriveSealingKey: derive };
    expect(recipientWebidsFromRoster(event, [ada, bo, departed], opts)).toEqual(['webid:ada', 'webid:bo']);
    expect(recipientAddrsFromRoster(event, [ada, bo, departed], opts)).toHaveLength(2);
  });
});

describe('the sink fans a signed statement through the waist', () => {
  const statement = { body: { hash: 'h1', subject: 'v2' }, sig: 'sig' };
  const base = {
    groupId: 'circle:k',
    emitStatement: async () => statement,
    statementSubtype: 'circle-key-statement',
    resolveRecipientAddrs: async () => ['addr:ada', 'addr:bo'],
    resolveRecipientWebids: async () => ['webid:ada', 'webid:bo'],
  };

  it('prefers the waist fan, narrowed by WEBID — a direct peer send carries the canonical identity, which every receiver refuses inside a circle', async () => {
    const fanned = [];
    const direct = [];
    const sink = makeKeyEventLogSink({
      ...base,
      fanStatement: (cid, st, only) => { fanned.push([cid, st, only]); },
      sendPeer: (addr) => { direct.push(addr); },
    });

    await sink.append(event);

    expect(direct).toEqual([]);                                  // nothing went out bare
    expect(fanned).toHaveLength(1);
    expect(fanned[0][1]).toBe(statement);
    expect(fanned[0][2]).toEqual(['webid:ada', 'webid:bo']);     // webids, not addresses
  });

  it('falls back to the direct peer fan when the waist fan is unavailable or throws', async () => {
    const direct = [];
    const sink = makeKeyEventLogSink({
      ...base,
      fanStatement: () => { throw new Error('no op wired'); },
      sendPeer: (addr) => { direct.push(addr); },
    });

    await sink.append(event);

    expect(direct).toEqual(['addr:ada', 'addr:bo']);
  });

  it('still fails closed: a lane that REFUSES to sign fans nothing at all', async () => {
    const fanned = [];
    const direct = [];
    const sink = makeKeyEventLogSink({
      ...base,
      emitStatement: async () => null,                           // the lane refused
      fanStatement: (...a) => { fanned.push(a); },
      sendPeer: (addr) => { direct.push(addr); },
    });

    await sink.append(event);

    expect(fanned).toEqual([]);
    expect(direct).toEqual([]);
  });
});
