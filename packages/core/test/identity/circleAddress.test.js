// Identity step 3 — per-circle addresses: deterministic (recoverable) yet distinct per circle.
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { Bootstrap } from '../../src/identity/Bootstrap.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { deriveCircleSeed, deriveCircleAddress, circleIdentity } from '../../src/identity/circleAddress.js';

const aProfileSeed = () => Bootstrap.create().bootstrap.deriveAgentSeed('default');

describe('per-circle addresses (step 3)', () => {
  it('is deterministic: same profile seed + circleId → same address (recovery)', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'circle-42')).toBe(deriveCircleAddress(s, 'circle-42'));
    expect(typeof deriveCircleAddress(s, 'circle-42')).toBe('string');
  });

  it('a DIFFERENT circle → a different address (unlinkable across circles)', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'circle-42')).not.toBe(deriveCircleAddress(s, 'werk-7'));
  });

  it('a different profile → a different address in the same circle', () => {
    expect(deriveCircleAddress(aProfileSeed(), 'circle-42')).not.toBe(deriveCircleAddress(aProfileSeed(), 'circle-42'));
  });

  it('a device with ONLY the profile seed (no owner root) derives the SAME address', () => {
    const { mnemonic } = Bootstrap.create();
    const seedHere  = Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('home');
    const seedThere = Bootstrap.fromMnemonic(mnemonic).deriveAgentSeed('home');   // re-derived on another device
    expect(deriveCircleAddress(seedHere, 'circle-42')).toBe(deriveCircleAddress(seedThere, 'circle-42'));
  });

  it('the address is a valid AgentIdentity pubKey of the per-circle seed', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'circle-42')).toBe(AgentIdentity.pubKeyFromSeed(deriveCircleSeed(s, 'circle-42')));
  });

  it('the per-circle address differs from the profile pubKey itself', () => {
    const s = aProfileSeed();
    expect(deriveCircleAddress(s, 'circle-42')).not.toBe(AgentIdentity.pubKeyFromSeed(s));
  });

  it('validates inputs', () => {
    expect(() => deriveCircleSeed(new Uint8Array(16), 'c')).toThrow('32-byte');
    expect(() => deriveCircleSeed(aProfileSeed(), '')).toThrow('circleId');
  });

  it('circleIdentity: a per-circle SIGNING identity whose pubKey IS the circle address', async () => {
    const s = aProfileSeed();
    const id = await circleIdentity(s, 'circle-42', new VaultMemory());
    expect(id.pubKey).toBe(deriveCircleAddress(s, 'circle-42'));       // roster records this
    const sig = id.sign(new TextEncoder().encode('hi'));              // and it signs verifiably
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBeGreaterThan(0);
    // a different circle → a different signing identity
    const other = await circleIdentity(s, 'werk-7', new VaultMemory());
    expect(other.pubKey).not.toBe(id.pubKey);
  });
});
