import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity }   from '../src/identity/AgentIdentity.js';
import { VaultMemory }     from '@onderling/vault';
import { generateMnemonic } from '../src/identity/Mnemonic.js';

function makeVault() { return new VaultMemory(); }

describe('AgentIdentity.generate', () => {
  it('creates an identity with a pubKey string', async () => {
    const id = await AgentIdentity.generate(makeVault());
    expect(typeof id.pubKey).toBe('string');
    expect(id.pubKey.length).toBeGreaterThan(0);
  });

  it('stores the private key in the vault', async () => {
    const vault = makeVault();
    await AgentIdentity.generate(vault);
    expect(await vault.get('agent-privkey')).not.toBeNull();
  });

  it('generates unique keypairs', async () => {
    const a = await AgentIdentity.generate(makeVault());
    const b = await AgentIdentity.generate(makeVault());
    expect(a.pubKey).not.toBe(b.pubKey);
  });
});

describe('AgentIdentity.restore', () => {
  it('restores the same pubKey', async () => {
    const vault = makeVault();
    const original = await AgentIdentity.generate(vault);
    const restored  = await AgentIdentity.restore(vault);
    expect(restored.pubKey).toBe(original.pubKey);
  });

  it('throws when vault is empty', async () => {
    await expect(AgentIdentity.restore(makeVault())).rejects.toThrow();
  });
});

describe('AgentIdentity.fromMnemonic', () => {
  it('derives the same keypair from the same mnemonic', async () => {
    const mnemonic = generateMnemonic();
    const a = await AgentIdentity.fromMnemonic(mnemonic, makeVault());
    const b = await AgentIdentity.fromMnemonic(mnemonic, makeVault());
    expect(a.pubKey).toBe(b.pubKey);
  });

  it('different mnemonics produce different keys', async () => {
    const a = await AgentIdentity.fromMnemonic(generateMnemonic(), makeVault());
    const b = await AgentIdentity.fromMnemonic(generateMnemonic(), makeVault());
    expect(a.pubKey).not.toBe(b.pubKey);
  });
});

describe('getMnemonic', () => {
  it('round-trips through mnemonic', async () => {
    const vault = makeVault();
    const id = await AgentIdentity.generate(vault);
    const mnemonic = await id.getMnemonic();
    expect(typeof mnemonic).toBe('string');
    const recovered = await AgentIdentity.fromMnemonic(mnemonic, makeVault());
    expect(recovered.pubKey).toBe(id.pubKey);
  });
});

describe('sign / verify', () => {
  it('verifies own signature', async () => {
    const id = await AgentIdentity.generate(makeVault());
    const data = 'test message';
    const sig  = id.sign(data);
    expect(AgentIdentity.verify(data, sig, id.pubKey)).toBe(true);
  });

  it('rejects tampered data', async () => {
    const id  = await AgentIdentity.generate(makeVault());
    const sig = id.sign('original');
    expect(AgentIdentity.verify('tampered', sig, id.pubKey)).toBe(false);
  });

  it('rejects wrong key', async () => {
    const alice = await AgentIdentity.generate(makeVault());
    const bob   = await AgentIdentity.generate(makeVault());
    const sig   = alice.sign('hello');
    expect(AgentIdentity.verify('hello', sig, bob.pubKey)).toBe(false);
  });

  it('signs Uint8Array data', async () => {
    const id   = await AgentIdentity.generate(makeVault());
    const data = new TextEncoder().encode('binary data');
    const sig  = id.sign(data);
    expect(AgentIdentity.verify(data, sig, id.pubKey)).toBe(true);
  });
});

describe('box / unbox', () => {
  it('encrypts and decrypts a message between two agents', async () => {
    const alice = await AgentIdentity.generate(makeVault());
    const bob   = await AgentIdentity.generate(makeVault());

    const plaintext = new TextEncoder().encode('secret message');
    const { nonce, ciphertext } = alice.box(plaintext, bob.pubKey);

    const decrypted = bob.unbox(ciphertext, nonce, alice.pubKey);
    expect(decrypted).not.toBeNull();
    expect(new TextDecoder().decode(decrypted)).toBe('secret message');
  });

  it('returns null for tampered ciphertext', async () => {
    const alice = await AgentIdentity.generate(makeVault());
    const bob   = await AgentIdentity.generate(makeVault());

    const { nonce, ciphertext } = alice.box(new TextEncoder().encode('msg'), bob.pubKey);
    ciphertext[0] ^= 0xff;  // tamper
    expect(bob.unbox(ciphertext, nonce, alice.pubKey)).toBeNull();
  });

  it('returns null for wrong sender', async () => {
    const alice = await AgentIdentity.generate(makeVault());
    const bob   = await AgentIdentity.generate(makeVault());
    const eve   = await AgentIdentity.generate(makeVault());

    const { nonce, ciphertext } = alice.box(new TextEncoder().encode('msg'), bob.pubKey);
    expect(bob.unbox(ciphertext, nonce, eve.pubKey)).toBeNull();
  });
});

describe('deriveSessionKey', () => {
  it('both parties derive the same key', async () => {
    const alice = await AgentIdentity.generate(makeVault());
    const bob   = await AgentIdentity.generate(makeVault());

    const keyAB = alice.deriveSessionKey(bob.pubKey);
    const keyBA = bob.deriveSessionKey(alice.pubKey);

    expect(keyAB).toEqual(keyBA);
    expect(keyAB.length).toBe(32);
  });
});

describe('secretbox / secretunbox', () => {
  it('encrypts and decrypts with a session key', async () => {
    const alice = await AgentIdentity.generate(makeVault());
    const bob   = await AgentIdentity.generate(makeVault());
    const key   = alice.deriveSessionKey(bob.pubKey);
    const nonce = new Uint8Array(24).fill(1);

    const plaintext = new TextEncoder().encode('stream data');
    const ct = AgentIdentity.secretbox(plaintext, nonce, key);
    const pt = AgentIdentity.secretunbox(ct, nonce, key);

    expect(new TextDecoder().decode(pt)).toBe('stream data');
  });

  it('returns null for tampered ciphertext', async () => {
    const alice = await AgentIdentity.generate(makeVault());
    const bob   = await AgentIdentity.generate(makeVault());
    const key   = alice.deriveSessionKey(bob.pubKey);
    const nonce = new Uint8Array(24).fill(2);

    const ct = AgentIdentity.secretbox(new TextEncoder().encode('x'), nonce, key);
    ct[0] ^= 0xff;
    expect(AgentIdentity.secretunbox(ct, nonce, key)).toBeNull();
  });
});

// ── stableId (Pinboard V1 Phase 11, 2026-05-06) ──────────────────────────────

describe('AgentIdentity.stableId', () => {
  it('is set on first generate()', async () => {
    const id = await AgentIdentity.generate(makeVault());
    expect(typeof id.stableId).toBe('string');
    expect(id.stableId.length).toBeGreaterThan(0);
  });

  it('persists across restore()', async () => {
    const vault = makeVault();
    const a = await AgentIdentity.generate(vault);
    const b = await AgentIdentity.restore(vault);
    expect(b.stableId).toBe(a.stableId);
  });

  it('is unique across separate identities', async () => {
    const a = await AgentIdentity.generate(makeVault());
    const b = await AgentIdentity.generate(makeVault());
    expect(a.stableId).not.toBe(b.stableId);
  });

  it('survives rotation (new keypair, same stableId)', async () => {
    const vault = makeVault();
    const a = await AgentIdentity.generate(vault);
    const oldStable = a.stableId;
    const oldPubKey = a.pubKey;

    const { newIdentity } = await AgentIdentity.rotate(vault);
    expect(newIdentity.stableId).toBe(oldStable);
    expect(newIdentity.pubKey).not.toBe(oldPubKey);
  });

  it('previous identity in restoreWithPrevious carries same stableId', async () => {
    const vault = makeVault();
    const a = await AgentIdentity.generate(vault);
    const stable = a.stableId;
    await AgentIdentity.rotate(vault);

    const { current, previous } = await AgentIdentity.restoreWithPrevious(vault);
    expect(current.stableId).toBe(stable);
    expect(previous?.identity.stableId).toBe(stable);
  });

  it('lazy-inits on legacy vaults (privkey present, no agent-stable-id)', async () => {
    const vault = makeVault();
    await AgentIdentity.generate(vault);
    // Simulate a pre-Phase-11 vault by clearing the stable-id key.
    if (typeof vault.remove === 'function') await vault.remove('agent-stable-id');
    else                                    await vault.set('agent-stable-id', '');

    const restored = await AgentIdentity.restore(vault);
    expect(typeof restored.stableId).toBe('string');
    expect(restored.stableId.length).toBeGreaterThan(0);
  });

  it('fromMnemonic also sets a stableId', async () => {
    const mnemonic = generateMnemonic();
    const id = await AgentIdentity.fromMnemonic(mnemonic, makeVault());
    expect(typeof id.stableId).toBe('string');
    expect(id.stableId.length).toBeGreaterThan(0);
  });
});
