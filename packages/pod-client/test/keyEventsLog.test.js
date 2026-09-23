// keyEventsLog.test.js — the group key + its rotations carried as log entries (no pod).
//
// Proves the mechanism in isolation with node crypto (milliseconds): establish → fold(log) → key chain, a
// member opens content sealed under the version(s) it holds, a non-recipient opens none; a rotation on removal
// seals a NEW version to the REMAINING members only, so the departed keeps pre-removal content (backward
// secrecy) but is denied post-removal content; and an offline member that catches the rotation up later reads it.

import { describe, it, expect } from 'vitest';
import {
  generateKeypair, makeOpener, sealForAudience,
  establishKeyEvent, rotateKeyEvent, foldKeyEvents,
  readKeyChain, currentGroupKey, openAcrossKeyChain, KEY_EVENT_KIND,
  collapseKeyEvents, MAX_KEYS_PER_VERSION,
} from '../src/index.js';

const GID = 'circle-x';
const opener = (kp) => makeOpener(kp.privateKey);
const seal = (groupKey, text) => sealForAudience(text, { groupKey }, { audience: 'circle' });

describe('key-events in the log — establish, fold, read', () => {
  it('a member folds the log to the key chain and opens content; a non-recipient opens none', () => {
    const admin = generateKeypair();
    const bob = generateKeypair();
    const stranger = generateKeypair();

    const { event } = establishKeyEvent({ groupId: GID, recipients: [admin.publicKey, bob.publicKey] });
    expect(event.kind).toBe(KEY_EVENT_KIND);
    expect(event.version).toBe(1);

    // The admin folds its log, seals content under the current version, fans it; bob reads it.
    const adminChain = readKeyChain([event], { groupId: GID, opener: opener(admin) });
    const env = seal(currentGroupKey(adminChain), 'hallo circle');
    expect(readKeyChain([event], { groupId: GID, opener: opener(bob) }).length).toBe(1);
    expect(openAcrossKeyChain(env, readKeyChain([event], { groupId: GID, opener: opener(bob) }))).toBe('hallo circle');

    // A stranger is not a recipient of the key-event → empty chain → cannot open.
    expect(readKeyChain([event], { groupId: GID, opener: opener(stranger) })).toEqual([]);
    expect(() => openAcrossKeyChain(env, readKeyChain([event], { groupId: GID, opener: opener(stranger) }))).toThrow();
  });

  it('fold produces a groupKeyResource-shaped chain (current + history) that orders by version', () => {
    const a = generateKeypair(); const b = generateKeypair();
    const { event: e1 } = establishKeyEvent({ groupId: GID, recipients: [a.publicKey, b.publicKey] });
    const { event: e2 } = rotateKeyEvent({ groupId: GID, priorEvents: [e1], recipients: [a.publicKey] });
    const resource = foldKeyEvents([e2, e1], { groupId: GID });   // out of order in the log
    expect(resource.version).toBe(2);
    expect(resource.history.map((h) => h.version)).toEqual([1]);
    expect(foldKeyEvents([], { groupId: GID })).toBeNull();
  });
});

describe('no-pod rotation on removal — backward secrecy', () => {
  it('a rotation seals v2 to the remaining member only; the departed keeps v1 content, is denied v2', () => {
    const admin = generateKeypair();
    const bob = generateKeypair();      // stays
    const carol = generateKeypair();    // removed

    const { event: e1 } = establishKeyEvent({ groupId: GID, recipients: [admin.publicKey, bob.publicKey, carol.publicKey] });
    const v1env = seal(currentGroupKey(readKeyChain([e1], { groupId: GID, opener: opener(admin) })), 'before removal');

    // Remove carol → rotate to the REMAINING recipients (admin + bob); carol is NOT a recipient of e2.
    const { event: e2 } = rotateKeyEvent({ groupId: GID, priorEvents: [e1], recipients: [admin.publicKey, bob.publicKey] });
    expect(e2.version).toBe(2);
    expect(e2.recipients).not.toContain(carol.publicKey);

    const v2env = seal(currentGroupKey(readKeyChain([e1, e2], { groupId: GID, opener: opener(admin) })), 'after removal');

    // Bob (remaining) holds both versions → reads both.
    const bobLog = [e1, e2];
    expect(openAcrossKeyChain(v1env, readKeyChain(bobLog, { groupId: GID, opener: opener(bob) }))).toBe('before removal');
    expect(openAcrossKeyChain(v2env, readKeyChain(bobLog, { groupId: GID, opener: opener(bob) }))).toBe('after removal');

    // Carol was only ever fanned e1 (she is absent from e2's recipients, so she never receives it) → she still
    // reads pre-removal v1 content she was entitled to, but her chain has NO v2 key → v2 content is denied.
    const carolLog = [e1];
    expect(openAcrossKeyChain(v1env, readKeyChain(carolLog, { groupId: GID, opener: opener(carol) }))).toBe('before removal');
    expect(() => openAcrossKeyChain(v2env, readKeyChain(carolLog, { groupId: GID, opener: opener(carol) }))).toThrow();

    // Even if carol somehow captured e2's ciphertext, she is not a recipient → cannot fold its key in.
    expect(readKeyChain([e1, e2], { groupId: GID, opener: opener(carol) }).map((k) => k.version)).toEqual([1]);
  });

  it('an offline member catches the rotation up later and then reads the new version', () => {
    const admin = generateKeypair();
    const bob = generateKeypair();
    const { event: e1 } = establishKeyEvent({ groupId: GID, recipients: [admin.publicKey, bob.publicKey] });
    const { event: e2 } = rotateKeyEvent({ groupId: GID, priorEvents: [e1], recipients: [admin.publicKey, bob.publicKey] });
    const v2env = seal(currentGroupKey(readKeyChain([e1, e2], { groupId: GID, opener: opener(admin) })), 'new era');

    // Bob offline during the rotation: his log has only e1 → he cannot read v2 yet.
    expect(() => openAcrossKeyChain(v2env, readKeyChain([e1], { groupId: GID, opener: opener(bob) }))).toThrow();
    // Reconnect: e2 is re-served (a durable log entry) → folded in → v2 opens.
    expect(openAcrossKeyChain(v2env, readKeyChain([e1, e2], { groupId: GID, opener: opener(bob) }))).toBe('new era');
  });
});

// ── TWO ADMINS ROTATE AT ONCE (2026-09-23) ───────────────────────────────────────────────────────────────
// Not an adversary: two people with the authority to rotate, doing it at the same moment. Until today the
// collapse was `byVersion.set(e.version, e)` — last in READ ORDER wins — in two places, the local store and
// this fold. Each device kept whichever arrived last, so members held different keys for the same version and
// could not open each other's content. Electing one deterministically would stop the split but lose whatever
// was sealed under the loser; keeping both loses nothing, because the reader already trials the whole chain.
describe('two admins rotate to the same version at once', () => {
  const twoRotations = () => {
    const a = generateKeypair(); const b = generateKeypair(); const c = generateKeypair();
    const { event: e1 } = establishKeyEvent({ groupId: GID, recipients: [a.publicKey, b.publicKey, c.publicKey] });
    // Both admins see v1 and rotate. Neither has seen the other's rotation — that is what "at once" means.
    const { event: fromA } = rotateKeyEvent({ groupId: GID, priorEvents: [e1], recipients: [a.publicKey, b.publicKey, c.publicKey] });
    const { event: fromB } = rotateKeyEvent({ groupId: GID, priorEvents: [e1], recipients: [a.publicKey, b.publicKey, c.publicKey] });
    return { a, b, c, e1, fromA, fromB };
  };

  it('content sealed under EITHER key opens, on a device that saw them in either order', () => {
    const { a, c, e1, fromA, fromB } = twoRotations();
    // Each admin sealed something under its own new key before hearing about the other.
    const underA = seal(currentGroupKey(readKeyChain([e1, fromA], { groupId: GID, opener: opener(a) })), 'from A');
    const underB = seal(currentGroupKey(readKeyChain([e1, fromB], { groupId: GID, opener: opener(a) })), 'from B');
    // A third member receives both, in whichever order the relay hands them over.
    for (const log of [[e1, fromA, fromB], [e1, fromB, fromA]]) {
      const chain = readKeyChain(log, { groupId: GID, opener: opener(c) });
      expect(openAcrossKeyChain(underA, chain), 'A\'s content opens').toBe('from A');
      expect(openAcrossKeyChain(underB, chain), 'B\'s content opens too — neither is discarded').toBe('from B');
    }
  });

  it('every device agrees which key is CURRENT, whatever order it read them in', () => {
    // The chain keeps both, but the next write must not fork again: `current` is one event, chosen the same
    // way everywhere, so the race heals on the next rotation instead of persisting.
    const { e1, fromA, fromB } = twoRotations();
    const one = foldKeyEvents([e1, fromA, fromB], { groupId: GID });
    const other = foldKeyEvents([fromB, e1, fromA], { groupId: GID });
    expect(one.sealed, 'the same current envelope on both devices').toBe(other.sealed);
    expect(one.version).toBe(2);
  });

  it('a RE-WRAP of one key still collapses — and keeps the wrap that reaches MORE people', () => {
    // The benign case the de-dupe was built for: the same key re-sealed as the roster grows. Keeping both
    // would grow the log for nothing; keeping the LAST READ can drop the wrap that added the new member on a
    // device that read them the other way round. The superset always serves.
    const a = generateKeypair(); const b = generateKeypair(); const c = generateKeypair();
    const { event: e1, groupKey } = establishKeyEvent({ groupId: GID, recipients: [a.publicKey, b.publicKey] });
    const { event: wider } = rotateKeyEvent({ groupId: GID, priorEvents: [], recipients: [a.publicKey, b.publicKey, c.publicKey], groupKey });
    const widerAtV1 = { ...wider, version: 1 };   // the same KEY, re-wrapped to one more recipient, at v1
    for (const log of [[e1, widerAtV1], [widerAtV1, e1]]) {
      const r = foldKeyEvents(log, { groupId: GID });
      expect(r.version, 'still one version').toBe(1);
      const chain = readKeyChain(log, { groupId: GID, opener: opener(c) });
      expect(chain.length, 'the newcomer can open v1 whichever order the device read the two wraps').toBe(1);
    }
  });

  it('a fourth key at one version is REFUSED — that is the only adversary in this item', () => {
    // Two honest admins colliding is two keys; three is a partition healing; more is a client minting keys to
    // grow every member's chain, which is a cost it imposes on everyone else. Every device drops the same
    // extras, by keyId, so a refusal does not become a new way for devices to disagree.
    const a = generateKeypair();
    const { event: e1 } = establishKeyEvent({ groupId: GID, recipients: [a.publicKey] });
    const many = [e1];
    for (let i = 0; i < 6; i += 1) {
      const { event } = rotateKeyEvent({ groupId: GID, priorEvents: [e1], recipients: [a.publicKey] });
      many.push(event);
    }
    const kept = collapseKeyEvents(many).filter((e) => e.version === 2);
    expect(kept.length, 'capped').toBe(MAX_KEYS_PER_VERSION);
    // …and the same ones, whatever order they arrived in.
    const shuffled = collapseKeyEvents([...many].reverse()).filter((e) => e.version === 2);
    expect(shuffled.map((e) => e.keyId)).toEqual(kept.map((e) => e.keyId));
  });

  it('keyId names the KEY, not the wrap — the same key wrapped twice has one id, two keys have two', () => {
    const a = generateKeypair(); const b = generateKeypair();
    const { event: e1, groupKey } = establishKeyEvent({ groupId: GID, recipients: [a.publicKey] });
    const { event: rewrapped } = establishKeyEvent({ groupId: GID, recipients: [a.publicKey, b.publicKey], groupKey });
    const { event: different } = establishKeyEvent({ groupId: GID, recipients: [a.publicKey] });
    expect(rewrapped.keyId, 'a re-wrap of one key keeps its name').toBe(e1.keyId);
    expect(rewrapped.sealed, '…even though the envelope differs').not.toBe(e1.sealed);
    expect(different.keyId, 'a different key gets a different name').not.toBe(e1.keyId);
  });
});
