/**
 * PolicyEngine + Agent integration tests.
 *
 * Verifies that the PolicyEngine blocks or permits calls end-to-end
 * when configured on an Agent — not just the unit-level policy checks.
 */
import { describe, it, expect } from 'vitest';
import { Agent }          from '../src/Agent.js';
import { AgentIdentity }  from '../src/identity/AgentIdentity.js';
import { VaultMemory }    from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, Parts } from '../src/Parts.js';
import { TrustRegistry }  from '../src/permissions/TrustRegistry.js';
import { PolicyEngine }   from '../src/permissions/PolicyEngine.js';
import { CapabilityToken } from '../src/permissions/CapabilityToken.js';
import { TokenRegistry }  from '../src/permissions/TokenRegistry.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

async function makePair() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);
  const tr  = new TrustRegistry(new VaultMemory());

  const alice = new Agent({ identity: idA, transport: tA });
  const bob   = new Agent({ identity: idB, transport: tB, trustRegistry: tr });

  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();
  return { alice, bob, idA, idB, tr };
}

/**
 * Install a PolicyEngine on bob AFTER skills have been registered, so that
 * the PE's skillRegistry references the already-populated registry.
 */
function installPE(bob, tr, isRevoked = null) {
  // `isRevoked` is CONSTRUCTED in — there is no setter, so a test wires its revocation source the
  // same way production does.
  const pe = new PolicyEngine({
    trustRegistry: tr,
    skillRegistry: bob.skills,
    agentPubKey:   bob.pubKey,
    ...(isRevoked ? { isRevoked } : {}),
  });
  Object.defineProperty(bob, 'policyEngine', { get: () => pe, configurable: true });
  return pe;
}

// ── Visibility gate ───────────────────────────────────────────────────────────

describe('visibility gate', () => {
  it('public skill is callable by tier-0 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('greet', async () => [TextPart('hello')], { visibility: 'public' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'public');

    const result = await alice.invoke(bob.address, 'greet', []);
    expect(Parts.text(result)).toBe('hello');

    await alice.stop(); await bob.stop();
  });

  it('authenticated skill is blocked for tier-0 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('secret', async () => [TextPart('secret data')], { visibility: 'authenticated' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'public');

    const task = alice.call(bob.address, 'secret', []);
    await expect(task.done()).rejects.toThrow();
    expect(task.state).toBe('failed');

    await alice.stop(); await bob.stop();
  });

  it('authenticated skill is callable by tier-1 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('secret', async () => [TextPart('secret data')], { visibility: 'authenticated' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const result = await alice.invoke(bob.address, 'secret', []);
    expect(Parts.text(result)).toBe('secret data');

    await alice.stop(); await bob.stop();
  });

  it('private skill is blocked even for tier-3 caller', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('admin', async () => [TextPart('admin')], { visibility: 'private', policy: 'never' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'private');

    const task = alice.call(bob.address, 'admin', []);
    await expect(task.done()).rejects.toThrow();

    await alice.stop(); await bob.stop();
  });
});

// ── Policy gate ───────────────────────────────────────────────────────────────

describe('policy gate', () => {
  it('on-request skill is callable when caller is tier >= 1', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('data', async () => [TextPart('data')],
      { visibility: 'authenticated', policy: 'on-request' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const result = await alice.invoke(bob.address, 'data', []);
    expect(Parts.text(result)).toBe('data');

    await alice.stop(); await bob.stop();
  });
});

// ── Capability token gate ─────────────────────────────────────────────────────

describe('capability token gate', () => {
  it('issued token has correct fields and verifies', async () => {
    const { alice, bob, idB } = await makePair();

    const token = await CapabilityToken.issue(idB, {
      subject:   alice.pubKey,
      skill:     'vip',
      agentId:   bob.pubKey,
      expiresIn: 60_000,
    });

    expect(CapabilityToken.verify(token, bob.pubKey)).toBe(true);
    expect(token.subject).toBe(alice.pubKey);
    expect(token.skill).toBe('vip');
    expect(token.isExpired).toBe(false);

    await alice.stop(); await bob.stop();
  });

  it('expired capability token fails verify', async () => {
    const { alice, idB } = await makePair();

    const token = await CapabilityToken.issue(idB, {
      subject:   alice.pubKey,
      skill:     'any',
      agentId:   idB.pubKey,
      expiresIn: -1_000,   // already expired
    });

    expect(CapabilityToken.verify(token, idB.pubKey)).toBe(false);

    await alice.stop();
  });

  it('caller with valid token in TokenRegistry can access a skill', async () => {
    const { alice, bob, idB, tr } = await makePair();
    bob.register('vip', async () => [TextPart('vip-content')],
      { visibility: 'authenticated', policy: 'on-request' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const token = await CapabilityToken.issue(idB, {
      subject:   alice.pubKey,
      skill:     'vip',
      agentId:   bob.pubKey,
      expiresIn: 60_000,
    });
    const tokenReg = new TokenRegistry(new VaultMemory());
    await tokenReg.store(token);
    expect(await tokenReg.get(bob.pubKey, 'vip')).not.toBeNull();

    const result = await alice.invoke(bob.address, 'vip', []);
    expect(Parts.text(result)).toBe('vip-content');

    await alice.stop(); await bob.stop();
  });
});

// ── Invoke-time token enforcement (verify-when-present) ───────────────────────
// The hole-closer: a token is now fully verified WHENEVER it is presented, not
// only under `requires-token`. So a revoked/forged token offered to a default
// `on-request` skill can no longer pass on tier alone.

/** Like makePair, but alice HOLDS tokens so her outbound calls attach `_token`. */
async function makePairAliceHoldsTokens() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);
  const tr  = new TrustRegistry(new VaultMemory());
  const aliceTokens = new TokenRegistry(new VaultMemory());

  const alice = new Agent({ identity: idA, transport: tA, tokenRegistry: aliceTokens });
  const bob   = new Agent({ identity: idB, transport: tB, trustRegistry: tr });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();
  return { alice, bob, idA, idB, tr, aliceTokens };
}

describe('invoke-time token enforcement', () => {
  it('a REVOKED token presented to an on-request skill is DENIED (previously passed on tier alone)', async () => {
    const { alice, bob, idB, tr, aliceTokens } = await makePairAliceHoldsTokens();
    bob.register('vip', async () => [TextPart('vip')], { visibility: 'authenticated', policy: 'on-request' });
    const revoked = new Set();
    installPE(bob, tr, (id) => revoked.has(id));
    await tr.setTier(alice.pubKey, 'authenticated');
    await tr.setTier(idB.pubKey, 'trusted'); // a PRESENTED token's issuer must be trusted

    const token = await CapabilityToken.issue(idB, {
      subject: alice.pubKey, skill: 'vip', agentId: bob.pubKey, expiresIn: 60_000,
    });
    await aliceTokens.store(token); // → alice's outbound call attaches it as `_token`

    // Valid, issuer-trusted token → passes (and IS actually verified now).
    expect(Parts.text(await alice.invoke(bob.address, 'vip', []))).toBe('vip');

    // Revoke it → the SAME presented token is denied at invoke time. This is the
    // enforcement that did not exist before (on-request never consulted the token).
    revoked.add(token.id);
    await expect(alice.call(bob.address, 'vip', []).done()).rejects.toThrow();

    await alice.stop(); await bob.stop();
  });

  it('an ABSENT token on an on-request skill still passes — trusted internal routing untouched', async () => {
    const { alice, bob, tr } = await makePair(); // alice holds no tokens → none attached
    bob.register('vip', async () => [TextPart('vip')], { visibility: 'authenticated', policy: 'on-request' });
    installPE(bob, tr, () => true); // even a revoke-ALL check can't touch a token-less call
    await tr.setTier(alice.pubKey, 'authenticated');

    expect(Parts.text(await alice.invoke(bob.address, 'vip', []))).toBe('vip');
    await alice.stop(); await bob.stop();
  });

  it('a presented token whose issuer is NOT trusted is denied (fail-closed — the enablement caveat)', async () => {
    const { alice, bob, idB, tr, aliceTokens } = await makePairAliceHoldsTokens();
    bob.register('vip', async () => [TextPart('vip')], { visibility: 'authenticated', policy: 'on-request' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');
    // NOTE: issuer (idB) left at default 'authenticated' (< trusted) on purpose.
    const token = await CapabilityToken.issue(idB, {
      subject: alice.pubKey, skill: 'vip', agentId: bob.pubKey, expiresIn: 60_000,
    });
    await aliceTokens.store(token);

    // A self-issued token whose issuer isn't elevated to 'trusted' fails closed —
    // this is why live enablement must setTier(issuer, 'trusted'). Documented, pinned.
    await expect(alice.call(bob.address, 'vip', []).done()).rejects.toThrow();
    await alice.stop(); await bob.stop();
  });
});

// ── Unknown skill ─────────────────────────────────────────────────────────────

describe('unknown skill', () => {
  it('calling a non-existent skill fails', async () => {
    const { alice, bob } = await makePair();

    const task = alice.call(bob.address, 'does-not-exist', []);
    await expect(task.done()).rejects.toThrow();
    expect(task.state).toBe('failed');

    await alice.stop(); await bob.stop();
  });
});

// ── Dynamic trust tier changes ────────────────────────────────────────────────

describe('dynamic trust tier changes', () => {
  it('dropping a caller to tier-0 blocks subsequent calls', async () => {
    const { alice, bob, tr } = await makePair();
    bob.register('data', async () => [TextPart('ok')], { visibility: 'authenticated' });
    installPE(bob, tr);
    await tr.setTier(alice.pubKey, 'authenticated');

    const r1 = await alice.invoke(bob.address, 'data', []);
    expect(Parts.text(r1)).toBe('ok');

    await tr.setTier(alice.pubKey, 'public');

    const task2 = alice.call(bob.address, 'data', []);
    await expect(task2.done()).rejects.toThrow();

    await alice.stop(); await bob.stop();
  });
});
