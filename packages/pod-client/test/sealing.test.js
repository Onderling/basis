import { describe, it, expect } from 'vitest';
import {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
} from '../src/sealing/index.js';

describe('sealing — recipient mode', () => {
  it('round-trips a single recipient', () => {
    const k = generateKeypair();
    const env = seal('hello world', k.publicKey);
    expect(isSealed(env)).toBe(true);
    expect(env).not.toContain('hello world');
    expect(open(env, k.privateKey)).toBe('hello world');
  });

  it('round-trips multiple recipients (each can open the same envelope)', () => {
    const a = generateKeypair(); const b = generateKeypair();
    const env = seal('shared secret', [a.publicKey, b.publicKey]);
    expect(open(env, a.privateKey)).toBe('shared secret');
    expect(open(env, b.privateKey)).toBe('shared secret');
  });

  it('a non-recipient cannot open it', () => {
    const k = generateKeypair(); const stranger = generateKeypair();
    const env = seal('private', k.publicKey);
    expect(() => open(env, stranger.privateKey)).toThrow(/not a recipient/);
  });

  it('open passes plaintext / non-sealed text through unchanged', () => {
    const k = generateKeypair();
    expect(open('just text', k.privateKey)).toBe('just text');
    expect(isSealed('just text')).toBe(false);
  });

  it('recipientId is stable + 8-byte-derived', () => {
    const k = generateKeypair();
    expect(recipientId(k.publicKey)).toBe(k.recipientId);
    expect(recipientId(k.publicKey)).toBe(recipientId(k.publicKey));
  });

  it('seal requires at least one recipient', () => {
    expect(() => seal('x', [])).toThrow(/at least one recipient/);
  });
});

describe('sealing — group-key mode', () => {
  it('round-trips under a shared group key', () => {
    const gk = generateGroupKey();
    const env = sealWithGroupKey('household note', gk);
    expect(isSealed(env)).toBe(true);
    expect(env).not.toContain('household note');
    expect(openWithGroupKey(env, gk)).toBe('household note');
  });

  it('a different group key cannot open it', () => {
    const env = sealWithGroupKey('note', generateGroupKey());
    expect(() => openWithGroupKey(env, generateGroupKey())).toThrow();
  });

  it('the two modes reject each other (clear error, no silent garbage)', () => {
    const k = generateKeypair(); const gk = generateGroupKey();
    expect(() => open(sealWithGroupKey('x', gk), k.privateKey)).toThrow(/group-key envelope/);
    expect(() => openWithGroupKey(seal('x', k.publicKey), gk)).toThrow(/recipient envelope/);
  });

  it('group key is distributed via recipient-mode seal (join → member opens content)', () => {
    // A control-agent generates a group key, seals content under it, and distributes the key by
    // sealing it to each member's public key (the household shared-pod model).
    const gk = generateGroupKey();
    const content = sealWithGroupKey('the shared list', gk);
    const alice = generateKeypair(); const bob = generateKeypair();
    const keyResource = seal(gk, [alice.publicKey, bob.publicKey]);   // /.keys/group-vN.json
    // Bob joins: unwraps the group key from the key resource, then opens the content.
    const bobsGroupKey = open(keyResource, bob.privateKey);
    expect(bobsGroupKey).toBe(gk);
    expect(openWithGroupKey(content, bobsGroupKey)).toBe('the shared list');
  });
});

describe('sealing — closures', () => {
  it('makeSealer/makeOpener + makeGroupSealer/makeGroupOpener', () => {
    const k = generateKeypair();
    const sealer = makeSealer(k.publicKey); const opener = makeOpener(k.privateKey);
    expect(opener(sealer('via closures'))).toBe('via closures');
    const gk = generateGroupKey();
    const gs = makeGroupSealer(gk); const go = makeGroupOpener(gk);
    expect(go(gs('group via closures'))).toBe('group via closures');
  });
});
