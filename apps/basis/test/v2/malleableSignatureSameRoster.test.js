/**
 * A CRAFTED SIGNATURE IS REFUSED THE SAME WAY ON EVERY DEVICE, SO EVERY DEVICE KEEPS THE SAME ROSTER.
 *
 * Ed25519 has a malleable encoding: replace the signature's scalar S by S + L and the bare tweetnacl check (what every
 * device ran until the strict rule) still accepts it, while node:crypto, WebCrypto and libsodium refuse it. A member
 * who sends a statement ONLY in that form would be in the circle on a device with a lenient check and out of it on a
 * device with a strict one. Under the platform's one rule every device refuses it.
 *
 * Two devices (two logs, two real membership rails, the real fold): the founder's join of a member arrives only with
 * the S + L signature. Both devices refuse it, so both fold the same roster without that member; the honest form of
 * the same statement is accepted by both.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { AgentIdentity, signSpine, foldRoster, b64encode, b64decode, canonicalize } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog } from '../../src/eventLog.js';
import { makeMembershipRail } from '../../src/v2/membershipRail.js';

const CID = 'circle-malleable-signature';
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const leToBig = (b) => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);
const bigToLe = (n) => { const out = new Uint8Array(32); for (let i = 0; i < 32; i += 1) { out[i] = Number(n & 0xffn); n >>= 8n; } return out; };

/** The same statement with S replaced by S + L: the same content, a non-canonical signature. */
function malleable(statement) {
  const sig = b64decode(statement.sig);
  const sPlusL = bigToLe(leToBig(sig.subarray(32)) + L);
  return { ...statement, sig: b64encode(new Uint8Array([...sig.subarray(0, 32), ...sPlusL])) };
}

async function device(founder, member) {
  const eventLog = new EventLog();
  const rail = makeMembershipRail({
    eventLog,
    circleIdentityFor: async () => founder,
    ownCeremonyCommitmentFor: () => null,
    myRef: () => founder.pubKey,
    callSkill: async () => ({ members: [founder, member].map((p) => ({ webid: p.pubKey, circleAddress: p.pubKey })) }),
  });
  const roster = async () => foldRoster((await rail.readVerifiedBodies(CID)).bodies, { founders: [founder.pubKey] }).members;
  return { rail, roster };
}

describe('a crafted (S + L) signature is refused alike on every device', () => {
  it('only the crafted form arrives: both devices refuse it and fold the same roster', async () => {
    const founder = await AgentIdentity.generate(new VaultMemory());
    const member = await AgentIdentity.generate(new VaultMemory());
    const join = signSpine(founder, { kind: 'join', circleId: CID, subject: member.pubKey, payload: { authorRef: founder.pubKey, rulesAccepted: 'v1' } });
    const crafted = malleable(join);

    // the hazard this closes: the bare library check accepts the crafted form
    const bareAccepts = nacl.sign.detached.verify(new TextEncoder().encode(canonicalize(crafted.body)), b64decode(crafted.sig), b64decode(crafted.body.author));
    expect(bareAccepts, 'bare tweetnacl accepts S + L (why the rule exists)').toBe(true);

    const [a, b] = await Promise.all([device(founder, member), device(founder, member)]);
    const ra = await a.rail.ingest(CID, crafted);
    const rb = await b.rail.ingest(CID, crafted);
    expect(ra.ok, 'device A refuses the crafted signature').toBe(false);
    expect(rb.ok, 'device B refuses the crafted signature').toBe(false);
    expect(await a.roster()).toEqual(await b.roster());
    expect(await a.roster()).not.toContain(member.pubKey);

    // the honest form of the very same statement lands on both
    expect((await a.rail.ingest(CID, join)).ok).toBe(true);
    expect((await b.rail.ingest(CID, join)).ok).toBe(true);
    expect(await a.roster()).toContain(member.pubKey);
    expect(await a.roster()).toEqual(await b.roster());
  });
});
