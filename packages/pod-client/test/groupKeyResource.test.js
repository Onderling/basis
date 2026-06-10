import { describe, it, expect } from 'vitest';
import {
  buildGroupKeyResource, unwrapGroupKey, grantMember, rotateGroupKeyResource,
} from '../src/sealing/groupKeyResource.js';
import { generateKeypair, generateGroupKey, sealWithGroupKey, openWithGroupKey } from '../src/sealing/index.js';

describe('groupKeyResource — build + unwrap', () => {
  it('every member can unwrap the group key; a non-member cannot', () => {
    const a = generateKeypair(); const b = generateKeypair(); const stranger = generateKeypair();
    const gk = generateGroupKey();
    const res = buildGroupKeyResource({ version: 1, groupKey: gk, recipients: [a.publicKey, b.publicKey] });
    expect(res.version).toBe(1);
    expect(res.members).toBe(2);
    expect(unwrapGroupKey(res, a.privateKey)).toBe(gk);
    expect(unwrapGroupKey(res, b.privateKey)).toBe(gk);
    expect(() => unwrapGroupKey(res, stranger.privateKey)).toThrow(/not a recipient/);
  });
});

describe('groupKeyResource — grant (join, O(1), same key)', () => {
  it('a new member can read content sealed before they joined (same key, same version)', () => {
    const a = generateKeypair(); const c = generateKeypair();
    const gk = generateGroupKey();
    const v1 = buildGroupKeyResource({ version: 1, groupKey: gk, recipients: [a.publicKey] });
    const content = sealWithGroupKey('existing list', gk);     // sealed before c joined

    const v1b = grantMember(v1, { newRecipient: c.publicKey, granterPrivateKey: a.privateKey, currentRecipients: [a.publicKey] });
    expect(v1b.version).toBe(1);                                // grant does NOT bump the version
    expect(v1b.members).toBe(2);
    const cKey = unwrapGroupKey(v1b, c.privateKey);
    expect(cKey).toBe(gk);                                      // same group key
    expect(openWithGroupKey(content, cKey)).toBe('existing list');
  });
});

describe('groupKeyResource — revoke (rotate, forward secrecy)', () => {
  it('rotation gives a new key + version; the departed member loses access to NEW content but keeps OLD', () => {
    const a = generateKeypair(); const b = generateKeypair(); const leaver = generateKeypair();
    const v1 = rotateGroupKeyResource({ previous: null, recipients: [a.publicKey, b.publicKey, leaver.publicKey] });
    expect(v1.version).toBe(1);
    const gk1 = unwrapGroupKey(v1, leaver.privateKey);
    const oldContent = sealWithGroupKey('pre-leave note', gk1);

    // leaver departs → rotate to the remaining members
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [a.publicKey, b.publicKey] });
    expect(v2.version).toBe(2);
    const gk2 = unwrapGroupKey(v2, a.privateKey);
    expect(gk2).not.toBe(gk1);                                  // fresh key
    const newContent = sealWithGroupKey('post-leave secret', gk2);

    // the leaver can't unwrap v2 (not a recipient) → can't read new content...
    expect(() => unwrapGroupKey(v2, leaver.privateKey)).toThrow(/not a recipient/);
    // ...but their cached v1 key still opens already-downloaded old content (forward, not retroactive)
    expect(openWithGroupKey(oldContent, gk1)).toBe('pre-leave note');
    // a remaining member reads the new content
    expect(openWithGroupKey(newContent, gk2)).toBe('post-leave secret');
  });

  it('versions increment across rotations', () => {
    const a = generateKeypair();
    const v1 = rotateGroupKeyResource({ recipients: [a.publicKey] });
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [a.publicKey] });
    const v3 = rotateGroupKeyResource({ previous: v2, recipients: [a.publicKey] });
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
  });
});
