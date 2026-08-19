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
