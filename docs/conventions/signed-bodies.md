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
- **eviction** — `packages/core/src/security/evictionStatement.js` — `"onderling/eviction.v1"`.
- **origin signature** — `packages/core/src/security/originSignature.js` — `"onderling/origin.v1"`.
- **reachability claim** — `packages/core/src/security/reachabilityClaim.js` — `"onderling/reachability.v1"`.

Still on a bare integer `v: 1`, scheduled to migrate to the string form under the compatibility licence (see
[naming-and-compatibility.md](./naming-and-compatibility.md)); until then treat each as `.v1` of its name:
- **secure-agent capability claim** — `packages/secure-agent/src/claim.js` (`CLAIM_VERSION`).
- **sealed envelope** — `SEALED_VERSION`.

New signed bodies follow this convention from their first commit.
