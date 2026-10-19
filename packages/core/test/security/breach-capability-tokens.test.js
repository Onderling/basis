/**
 * J-SECURITY BREACH SUITE — capability-token attacks.
 * PLAN-real-usage-and-deployment.md §7.
 *
 * Adversarial audit of the capability-token verification path
 * (`PolicyEngine.checkInbound` → `#verifyPresentedToken`, and the pod-scope
 * `PodCapabilityToken.matchesScope`). Mirrors the deny-side discipline of
 * `PolicyEngine.integration.test.js` / companion `companionGate.test.js`:
 * every rejection is asserted with the exact code so a regression that
 * SILENTLY ACCEPTS a bad token fails loudly.
 *
 * Scenarios covered here:
 *   1. Forge a capability token — bad/absent signature → REJECT.        (DEFENDED)
 *   2. Stolen / replayed token — issued FOR Alice, presented BY Bob     (DEFENDED)
 *      (subject-binding defeats replay/forwarding).
 *   3. Mis-scoped token — a skill-scope used out of scope; a pod-scope
 *      used for a path/action it doesn't grant → REJECT.                (DEFENDED)
 *
 * These are UNIT tests against the verifier, not full Agent wiring — the
 * verifier IS the security boundary and testing it directly makes the
 * assertion unambiguous.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentIdentity }        from '../../src/identity/AgentIdentity.js';
import { VaultMemory }          from '@onderling/vault';
import { TrustRegistry }        from '../../src/permissions/TrustRegistry.js';
import { PolicyEngine, PolicyDeniedError } from '../../src/permissions/PolicyEngine.js';
import { SkillRegistry }        from '../../src/skills/SkillRegistry.js';
import { CapabilityToken }      from '../../src/permissions/CapabilityToken.js';
import { PodCapabilityToken }   from '../../src/permissions/PodCapabilityToken.js';

/**
 * Build a verifier harness: victim agent (idV) exposes a `requires-token`
 * skill `vault.read`; `attacker` and `subject` are peers. The issuer is the
 * victim itself (self-issued), elevated to `trusted` so a *valid* token
 * would pass — isolating the attack variable.
 */
async function makeVerifier({ skillId = 'vault.read' } = {}) {
  const idV       = await AgentIdentity.generate(new VaultMemory());  // victim / issuer
  const idSubject = await AgentIdentity.generate(new VaultMemory());  // legitimate token holder
  const idAttacker= await AgentIdentity.generate(new VaultMemory());  // thief / forger

  const trust  = new TrustRegistry(new VaultMemory());
  const skills = new SkillRegistry();
  skills.register(skillId, async () => [], { visibility: 'authenticated', policy: 'requires-token' });

  const pe = new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: idV.pubKey });

  // Both peers are 'authenticated'; the issuer (victim) is 'trusted' so a
  // legitimate self-issued token clears the issuer-trust gate.
  await trust.setTier(idSubject.pubKey,  'authenticated');
  await trust.setTier(idAttacker.pubKey, 'authenticated');
  await trust.setTier(idV.pubKey,        'trusted');

  return { idV, idSubject, idAttacker, trust, skills, pe, skillId };
}

// Token expiry is Date-based; a sibling test file that leaks vi fake timers
// would otherwise skew our clock. Pin real timers before each test so this
// suite is deterministic regardless of run order.
beforeEach(() => { vi.useRealTimers(); });

const denialCode = async (promise) => {
  try { await promise; return null; }
  catch (e) { return e instanceof PolicyDeniedError ? e.code : `THREW:${e?.name}`; }
};

describe('§7.1 — forge a capability token', () => {
  it('CONTROL: a legitimate self-issued token is ACCEPTED (isolates the attack variable)', async () => {
    const { idV, idSubject, pe, skillId } = await makeVerifier();
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000,
    });
    const out = await pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: token.toJSON() });
    expect(out.allowed).toBe(true);
  });

  it('a token with a TAMPERED signature is rejected (INVALID_TOKEN)', async () => {
    const { idV, idSubject, pe, skillId } = await makeVerifier();
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000,
    });
    const forged = token.toJSON();
    // Flip one BIT inside the signature's bytes. (Rewriting its last base64url characters was a flake: the final
    // character of an 86-character Ed25519 signature carries only two data bits, so ~7% of those "tampered"
    // signatures decoded to the very same bytes and verified — the verifier was right, the tamper was not.)
    const bytes = Buffer.from(forged.sig, 'base64url');
    bytes[20] ^= 0x01;
    forged.sig = bytes.toString('base64url');
    expect(forged.sig).not.toBe(token.toJSON().sig);

    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: forged }));
    expect(code).toBe('INVALID_TOKEN');
  });

  it('a token with an ABSENT signature (sig:null) is rejected', async () => {
    const { idV, idSubject, pe, skillId } = await makeVerifier();
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000,
    });
    const forged = { ...token.toJSON(), sig: null };
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: forged }));
    expect(code).toBe('INVALID_TOKEN');
  });

  it('a token whose PRIVILEGES were escalated after signing (skill widened to *) is rejected', async () => {
    const { idV, idSubject, pe, skillId } = await makeVerifier();
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000,
    });
    // Attacker widens the grant to the wildcard AFTER signing — signature
    // covers the canonical body incl. `skill`, so verify must fail.
    const forged = { ...token.toJSON(), skill: '*' };
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: forged }));
    expect(code).toBe('INVALID_TOKEN');
  });

  it('a token signed by an UNKNOWN key claiming to be issued by the victim is rejected', async () => {
    const { idV, idSubject, idAttacker, pe, skillId } = await makeVerifier();
    // Attacker self-signs but sets issuer to the victim's pubKey → sig won't
    // verify against the claimed issuer.
    const real = await CapabilityToken.issue(idAttacker, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000,
    });
    const forged = { ...real.toJSON(), issuer: idV.pubKey };
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: forged }));
    expect(code).toBe('INVALID_TOKEN');
  });
});

describe('§7.2 — stolen / replayed token (subject-binding defeats theft)', () => {
  it('a token issued FOR the subject, presented BY a different peer, is rejected', async () => {
    const { idV, idSubject, idAttacker, pe, skillId } = await makeVerifier();
    // Valid token bound to the subject.
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000,
    });
    // Attacker steals the exact bytes and replays them under HIS pubKey.
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idAttacker.pubKey, skillId, token: token.toJSON() }));
    expect(code).toBe('INVALID_TOKEN');   // subject !== caller
  });

  it('the SAME stolen token still works for its rightful subject (proves it is subject-binding, not a blanket break)', async () => {
    const { idV, idSubject, pe, skillId } = await makeVerifier();
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: 60_000,
    });
    const out = await pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: token.toJSON() });
    expect(out.allowed).toBe(true);
  });

  it('an EXPIRED token (replayed after its window) is rejected', async () => {
    const { idV, idSubject, pe, skillId } = await makeVerifier();
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idV.pubKey, expiresIn: -1_000,  // already dead
    });
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: token.toJSON() }));
    expect(code).toBe('INVALID_TOKEN');
  });

  it('a token minted for a DIFFERENT agent (agentId ≠ this agent) is rejected', async () => {
    const { idV, idSubject, idAttacker, pe, skillId } = await makeVerifier();
    // Issued by the victim but targeting a THIRD agent — replaying it here
    // (agentPubKey = victim) must fail the agentId binding.
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: skillId, agentId: idAttacker.pubKey, expiresIn: 60_000,
    });
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId, token: token.toJSON() }));
    expect(code).toBe('INVALID_TOKEN');
  });
});

describe('§7.3 — mis-scoped token (skill scope)', () => {
  it('a token scoped to `notes.read` presented at `vault.delete` is rejected', async () => {
    const { idV, idSubject, pe } = await makeVerifier({ skillId: 'vault.delete' });
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: 'notes.read', agentId: idV.pubKey, expiresIn: 60_000,
    });
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId: 'vault.delete', token: token.toJSON() }));
    expect(code).toBe('INVALID_TOKEN');   // skill mismatch
  });

  it('a `bot.*` prefix token does NOT reach a non-prefixed skill', async () => {
    const { idV, idSubject, pe } = await makeVerifier({ skillId: 'vault.read' });
    const token = await CapabilityToken.issue(idV, {
      subject: idSubject.pubKey, skill: 'bot.*', agentId: idV.pubKey, expiresIn: 60_000,
    });
    const code = await denialCode(
      pe.checkInbound({ peerPubKey: idSubject.pubKey, skillId: 'vault.read', token: token.toJSON() }));
    expect(code).toBe('INVALID_TOKEN');
  });
});

describe('§7.3 — mis-scoped token (pod-resource scope, PodCapabilityToken)', () => {
  it('a read-only pod token does NOT authorize a delete', () => {
    const granted  = 'pod.read:/notes/';
    expect(PodCapabilityToken.matchesScope(granted, 'pod.delete:/notes/foo.md')).toBe(false);
    expect(PodCapabilityToken.matchesScope(granted, 'pod.read:/notes/foo.md')).toBe(true);   // sanity
  });

  it('a token scoped to /notes/ does NOT authorize an out-of-scope path (/secrets/)', () => {
    const granted = 'pod.write:/notes/';
    expect(PodCapabilityToken.matchesScope(granted, 'pod.write:/secrets/x.md')).toBe(false);
    // sibling-prefix confusion: /notesX/ must NOT match /notes/
    expect(PodCapabilityToken.matchesScope(granted, 'pod.write:/notesX/x.md')).toBe(false);
  });

  it('a resource-scope grant (no trailing slash) is exact-match only — no prefix widening', () => {
    const granted = 'pod.read:/notes/foo.md';
    expect(PodCapabilityToken.matchesScope(granted, 'pod.read:/notes/foo.md')).toBe(true);
    expect(PodCapabilityToken.matchesScope(granted, 'pod.read:/notes/foo.md.evil')).toBe(false);
    expect(PodCapabilityToken.matchesScope(granted, 'pod.read:/notes/')).toBe(false);
  });

  it('a chain that WIDENS scope beyond the parent fails verifyChain (attenuation)', async () => {
    const idIssuer = await AgentIdentity.generate(new VaultMemory());
    const idMid    = await AgentIdentity.generate(new VaultMemory());
    const parent = await PodCapabilityToken.issue(idIssuer, {
      subject: idMid.pubKey, pod: 'https://pod/', scopes: ['pod.read:/notes/'], expiresIn: 60_000,
    });
    // Child tries to widen read→write and narrow-path→broader — must be rejected.
    const child = await PodCapabilityToken.issue(idMid, {
      subject: idMid.pubKey, pod: 'https://pod/', scopes: ['pod.write:/'], expiresIn: 30_000,
      parentId: parent.id,
    });
    expect(PodCapabilityToken.verifyChain([parent.toJSON(), child.toJSON()])).toBe(false);
  });
});
