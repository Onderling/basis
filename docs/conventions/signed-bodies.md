# Versioning signed bodies

Several places in the platform sign a small canonical object and fan it to peers, who verify and act on it
without a server in between: the verified-origin attribution on a skill invocation, a device reachability
claim, a key rotation, a member eviction. Each of these **signed bodies** carries a version field so a
verifier can tell which shape it is looking at, refuse a shape it does not understand, and so the format can
evolve without a flag day.

## The rule

1. **The version is a self-describing string, namespaced to this project** — `"onderling/<name>.v<n>"`, e.g.
   `"onderling/eviction.v1"`, `"onderling/origin.v1"`. Not a bare integer. This is an open format: an
   independent implementation reads the string and knows exactly which shape and rules apply, without our
   source. A bare `1` means nothing to a third party.

2. **The version lives inside the signed body** — it is one of the canonicalised fields, so it is covered by
   the signature. A verifier cannot be tricked into reading a `v1` body under `v2` rules: change the version
   and the signature no longer verifies.

3. **A verifier rejects any version it does not recognise** — `unsupported version: <v>`. It never
   best-effort-parses an unknown shape. Forward compatibility is opt-in per version, never assumed.

4. **Change the body shape ⇒ mint a new version string.** Any change to which fields are signed, what they
   mean, or how they are canonicalised is a new version (`.v2`). Adding an *optional* field that older
   verifiers can ignore safely is the only exception, and only when the older verifier already ignores
   unknown fields by construction — when in doubt, bump.

5. **One helper pair per body**, `sign<Name>` / `verify<Name>`, and the version constant sits with them. The
   signer writes the current version; the verifier owns the accept/reject set. Keep the two in one file so
   they cannot drift.

## Which signatures are valid (rule set `ed25519-strict-1`, 2026-11-12)

Every device, and every independent implementation, must accept exactly the same Ed25519 signatures, or a member can
craft a statement that some devices accept and others refuse, and their rosters differ. Libraries disagree on crafted
input, so the platform fixes the rule itself, as byte checks before the library's equation
(`packages/core/src/crypto/ed25519Strict.js`, `verifyEd25519Strict`; every check in shipped code goes through it,
`lint-one-signature-check`):

1. the signature is 64 bytes and the public key 32;
2. the scalar S (the signature's last 32 bytes, little-endian) is canonical: S < L, the group order;
3. the public key A and the point R (the signature's first 32 bytes) are canonically encoded: y < p = 2^255 − 19;
4. neither A nor R is of small order (its encoding, sign bit ignored, is not one of the seven encodings of the eight
   small-order points);
5. then the library's single-signature equation, which must be the COFACTORLESS one (never the cofactored one, never
   batch verification).

The conformance set is `@onderling/core/conformance`: `ED25519_EDGE_VECTORS` (the 12 vectors of "Taming the many
EdDSAs", Chalkias, Garillot, Nikolaenko 2020), `ED25519_ACCEPTED` (exactly case 3) and `ed25519Disagreements(verify)`,
which must return an empty list for any check an implementation uses. Honest signatures from a standard signer always
pass the rule.

## What this looks like

```js
export const EVICTION_STMT_VERSION = 'onderling/eviction.v1';

function evictionBody({ circleId, evicted, by, seq }) {
  return { v: EVICTION_STMT_VERSION, kind: 'eviction', circleId, evicted, by, seq };
}
// verify: if (body.v !== EVICTION_STMT_VERSION) return { ok: false, reason: `unsupported version: ${body.v}` };
```

## Current state

Following this convention:
- **eviction** — `packages/core/src/security/evictionStatement.js` — `"onderling/eviction.v2"` (a signed,
  chained spine statement — content + `authorChain` fields; v1 was the standalone wall-clock form).
- **origin signature** — `packages/core/src/security/originSignature.js` — `"onderling/origin.v1"`.
- **reachability claim** — `packages/core/src/security/reachabilityClaim.js` — `"onderling/reachability.v1"`.

Still on a bare integer `v: 1`, scheduled to migrate to the string form under the compatibility licence (see
[naming-and-compatibility.md](./naming-and-compatibility.md)); until then treat each as `.v1` of its name:
- **secure-agent capability claim** — `packages/secure-agent/src/claim.js` (`CLAIM_VERSION`).
- **sealed envelope** — `SEALED_VERSION`.

New signed bodies follow this convention from their first commit.
