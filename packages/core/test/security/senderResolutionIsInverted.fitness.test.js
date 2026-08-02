/**
 * FITNESS — the line that has to stay deleted (Decision 1, design §12).
 *
 * The whole of Decision 1 is the disappearance of one lookup:
 *
 *     const senderKey = this.#peers.get(env._from);        // ← gone
 *     if (!AgentIdentity.verify(canonicalize(withoutSig), sigBytes, senderKey)) …
 *
 * Every behavioural guard next door asserts what happens when an attacker tries something. None of
 * them fails if someone re-adds that lookup *as well as* the carried key — the tests would keep
 * passing while the property quietly came back, because a re-added lookup is only exploitable in
 * the cases nobody wrote a test for. That is precisely the failure mode a fitness function exists
 * for, and it is why the design asked for this one by name rather than trusting the behaviour
 * suite.
 *
 * The check is deliberately crude and positional: NOTHING may resolve a key from an address before
 * the signature is verified. After it, `#peers` is read all it likes — that is the authorize step,
 * and reading a binding to CHECK a proven key is the opposite of using it to choose one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync }          from 'node:fs';
import { fileURLToPath }         from 'node:url';
import { dirname, join }         from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src  = readFileSync(join(here, '../../src/security/SecurityLayer.js'), 'utf8');

/** The body of `decryptAndVerify`, from its signature to the next method at the same indent. */
function inboundBody() {
  const start = src.indexOf('  decryptAndVerify(rawEnvelope) {');
  expect(start, 'decryptAndVerify still exists').toBeGreaterThan(-1);
  const end = src.indexOf('\n  // ── Private helpers', start);
  expect(end, 'the inbound section still ends before the private helpers').toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Source with `//` and `/* *\/` comments removed — prose about the old lookup is welcome. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * …and with string literals removed too. A diagnostic message naming the roster is prose that
 * happens to be quoted; only IDENTIFIERS say what the code knows about.
 */
function stripCommentsAndStrings(text) {
  return stripComments(text)
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

describe('identity resolution is inverted, and stays inverted', () => {
  it('no key is resolved from an ADDRESS before the signature is verified', () => {
    const body = stripComments(inboundBody());
    const verifyAt = body.indexOf('AgentIdentity.verify(');
    expect(verifyAt, 'the inbound path still verifies a signature').toBeGreaterThan(-1);
    const beforeVerify = body.slice(0, verifyAt);

    // Any name→key lookup, however it is spelled.
    for (const forbidden of ['#peers.get(', 'getPeerKey(', 'peers.get(']) {
      expect(
        beforeVerify.includes(forbidden),
        `\`${forbidden}\` appears BEFORE the signature check — that is the lookup Decision 1 removed. `
        + 'The key an envelope is verified against must come from the envelope, never from what the '
        + 'address it claims maps to.',
      ).toBe(false);
    }
  });

  it('the key the signature is checked against comes from the CARRIED credential', () => {
    const body = stripComments(inboundBody());
    const resolveAt = body.indexOf('resolveSenderKey(');
    const verifyAt  = body.indexOf('AgentIdentity.verify(');
    expect(resolveAt, 'the carried credential is resolved on the inbound path').toBeGreaterThan(-1);
    expect(resolveAt, 'and it is resolved BEFORE the signature is checked').toBeLessThan(verifyAt);
    // The verify call takes exactly the resolved key.
    expect(body.slice(verifyAt, verifyAt + 200)).toMatch(/senderKey/);
  });

  it('nothing mutates the peer map before the signature check', () => {
    // The 07-31 fix needed a rollback because step 3 wrote to `#peers` before verifying. Under the
    // inversion there is nothing to write yet, so the rollback is gone — and it must stay gone for
    // the right reason. A `#peers.set` creeping back above the verify would silently reintroduce
    // both the poisoning bug and the machinery that was needed to undo it.
    const body = stripComments(inboundBody());
    const beforeVerify = body.slice(0, body.indexOf('AgentIdentity.verify('));
    expect(beforeVerify.includes('#peers.set(')).toBe(false);
    expect(beforeVerify.includes('#peers.delete(')).toBe(false);
  });

  it('the outbound half stamps the credential inside the signed bytes', () => {
    const signAt = src.indexOf('  #sign(env, signer = this.#identity) {');
    expect(signAt).toBeGreaterThan(-1);
    const body = stripComments(src.slice(signAt, signAt + 700));
    const credentialAt = body.indexOf('senderCredential(');
    const signCallAt   = body.indexOf('signer.sign(');
    expect(credentialAt, 'the signing key is stamped on the envelope').toBeGreaterThan(-1);
    expect(credentialAt, 'and stamped BEFORE it is signed, so swapping it invalidates the signature')
      .toBeLessThan(signCallAt);
  });

  it('the kernel calls the roster port and never implements one', () => {
    // Invariant 5 — concrete membership knowledge does not live in `packages/core`. This is the
    // mechanical half of L3 staying open: whichever layer ends up owning the implementation, it is
    // not this one.
    const stripped = stripCommentsAndStrings(src);
    expect(stripped).toMatch(/askSenderAuthorizer\(/);
    for (const membershipWord of ['roster', 'circleId', 'members', 'membership']) {
      expect(
        new RegExp(`\\b${membershipWord}\\b`).test(stripped),
        `\`${membershipWord}\` is an IDENTIFIER in the kernel (comments and messages are fine) — `
        + 'membership knowledge belongs above the kernel.',
      ).toBe(false);
    }
  });
});
