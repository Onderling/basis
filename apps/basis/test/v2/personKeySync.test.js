/**
 * The person key between a person's devices: the ceremony hands the new version to the survivors over the one
 * sibling carry; a landing is admitted only when the ceremony's ROOT REVEAL verifies against the receiver's own
 * commitment, and is stored monotonically. The sender's address decides nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPersonKeySync, PERSON_KEY_CARRY, PERSON_KEY_CATCHUP_SUBTYPES } from '../../src/v2/personKeySync.js';
import { b64encode, Bootstrap, ceremonyCommitment, rootPubKeyB64Of, signCeremonyReveal, derivePersonKeySeed, personKeyPubKeyB64, personKeyFacts } from '@onderling/core';

const root = Bootstrap.create().bootstrap;
const rootPub = rootPubKeyB64Of(root.secret);
const ME = 'w:anna';
const profile = root.deriveAgentSeed('default');
const keyAt = (version, circles = ['k1', 'k2'], secret = root.secret) => {
  const seed = derivePersonKeySeed(profile, version);
  const facts = personKeyFacts({ version, pubKey: personKeyPubKeyB64(seed) });
  const reveals = Object.fromEntries(circles.map((c) => [c, signCeremonyReveal(secret, { circleId: c, kind: PERSON_KEY_CARRY, subject: ME, authorRef: ME, facts })]));
  return { version, seed, reveals };
};
const SIBS = ['addr:box', 'addr:laptop'];
const rig = ({ current = keyAt(2), siblings = SIBS, circles = ['k1', 'k2'] } = {}) => {
  const sent = [];
  const stored = [];
  const store = vi.fn(async (k) => { const ok = !stored.length || stored.at(-1).version < k.version; if (ok) stored.push(k); return ok; });
  const refused = [];
  const sync = createPersonKeySync({
    siblings: async () => siblings, sendToPeer: async (to, payload, opts) => { sent.push({ to, payload, opts }); return { delivered: true }; },
    current: () => current, store, selfPubKey: ME,
    ownCommitmentFor: (c) => (circles.includes(c) ? ceremonyCommitment(rootPub, c) : null),
    onRefused: (reason, from) => refused.push([reason, from]),
  });
  return { sync, sent, stored, refused, store };
};
const wire = (k) => ({ subtype: PERSON_KEY_CARRY, version: k.version, seed: b64encode(k.seed), reveals: k.reveals });

describe('the ceremony hands the current key to the survivors', () => {
  it('carryCurrent sends { version, seed, reveals } to every sibling over hold-forward; an exclusion is honoured', async () => {
    const { sync, sent } = rig();
    expect((await sync.carryCurrent()).attempted).toBe(2);
    expect(sent[0].payload).toMatchObject({ subtype: PERSON_KEY_CARRY, version: 2 });
    expect(Object.keys(sent[0].payload.reveals)).toEqual(['k1', 'k2']);
    expect(sent[0].opts).toEqual({ guarantee: 'hold-forward' });
    sent.length = 0;
    expect((await sync.carryCurrent({ exclude: ['addr:box'] })).attempted).toBe(1);
    expect(sent[0].to).toBe('addr:laptop');
  });
  it('the hand-over carries the link key\'s PUBLIC half and never a link seed; a landed one keeps the pub', async () => {
    const k = { ...keyAt(2), linkKeyPub: 'LINK-PUB' };
    const { sync, sent } = rig({ current: k });
    await sync.carryCurrent();
    expect(sent[0].payload.linkKeyPub).toBe('LINK-PUB');
    expect(Object.keys(sent[0].payload).sort()).toEqual(['linkKeyPub', 'links', 'previous', 'reveals', 'seed', 'subtype', 'version']);
    const { sync: rx, stored } = rig({ current: keyAt(1) });
    await rx.handlers[PERSON_KEY_CARRY]('addr:box', sent[0].payload);
    expect(stored[0]?.linkKeyPub).toBe('LINK-PUB');
  });
  it('a device with no key, or a re-derived key with no reveals, hands over nothing', async () => {
    expect((await rig({ current: null }).sync.carryCurrent()).skipped).toBe('no-key-or-no-reveals');
    expect((await rig({ current: { version: 1, seed: derivePersonKeySeed(profile, 1), reveals: {} } }).sync.carryCurrent()).skipped).toBe('no-key-or-no-reveals');
  });
});

describe('landing — the root decides, not the address', () => {
  it('a hand-over whose reveal verifies against my commitment lands from ANY address; a higher version supersedes; a lower never lands', async () => {
    const { sync, stored } = rig();
    await sync.handlers[PERSON_KEY_CARRY]('addr:whatever', wire(keyAt(3)));
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(2)));
    await sync.handlers[PERSON_KEY_CARRY]('addr:laptop', wire(keyAt(4)));
    expect(stored.map((k) => k.version)).toEqual([3, 4]);
    expect(stored[1].reveals).toEqual(keyAt(4).reveals);
  });
  it('one shared circle suffices — reveals for circles I am not in are simply skipped', async () => {
    const { sync, stored } = rig({ circles: ['k2'] });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(3, ['k1', 'k2'])));
    expect(stored.map((k) => k.version)).toEqual([3]);
  });
  it('refused: no reveal, another root\'s reveal, a reveal for a circle I do not share, a swapped seed, a bumped version, junk', async () => {
    const { sync, stored, refused } = rig();
    const good = keyAt(3);
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { subtype: PERSON_KEY_CARRY, version: 3, seed: b64encode(good.seed) });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(3, ['k1', 'k2'], Bootstrap.create().bootstrap.secret)));
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', wire(keyAt(3, ['k9'])));
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { ...wire(good), seed: b64encode(derivePersonKeySeed(profile, 7)) });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { ...wire(good), version: 9 });
    await sync.handlers[PERSON_KEY_CARRY]('addr:box', { subtype: PERSON_KEY_CARRY, version: 3, seed: 'junk', reveals: good.reveals });
    expect(stored).toEqual([]);
    expect(refused.map((r) => r[0])).toEqual(['malformed', 'no-root-reveal', 'no-root-reveal', 'no-root-reveal', 'no-root-reveal', 'malformed']);
  });
});

describe('catch-up', () => {
  it('a sibling\'s request is answered with the current key and its reveals; a stranger\'s is not', async () => {
    const { sync, sent } = rig();
    await sync.handlers[PERSON_KEY_CATCHUP_SUBTYPES.request]('addr:laptop', { subtype: PERSON_KEY_CATCHUP_SUBTYPES.request });
    await sync.handlers[PERSON_KEY_CATCHUP_SUBTYPES.request]('addr:stranger', { subtype: PERSON_KEY_CATCHUP_SUBTYPES.request });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'addr:laptop', payload: { subtype: PERSON_KEY_CARRY, version: 2 } });
    expect(Object.keys(sent[0].payload.reveals)).toEqual(['k1', 'k2']);
  });
  it('requestFromSiblings asks every sibling', async () => {
    const { sync, sent } = rig();
    expect(await sync.requestFromSiblings()).toEqual({ requested: 2 });
  });
});
