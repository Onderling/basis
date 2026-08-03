// Confidential-LLM route safety — the shared guard so no surface silently leaks
// raw, pre-consent / private plaintext to a host that can read it.
//
// THE RULE. Raw private text may only reach:
//   • a LOCAL model (on the user's own machine), or
//   • privatemode to a LOOPBACK proxy (co-located → the host IS the user's machine), or
//   • an ATTESTED enclave gateway (the client verified the TEE quote — "Option B").
// Anything else (a "confidential" route pointed at a plain remote host, or any other
// remote route) would expose plaintext to a host that can read it → refuse.
//
// This is the canonical home (SDK layer, @onderling/llm-client) so every consumer —
// basis circles, the feedback pipeline, third parties via the SDK — shares ONE
// definition instead of forking it. Browser-safe: `process.env` access is guarded.
//
// See the onderling-feedback repo: docs/CONFIDENTIAL-LLM-TRANSPORT.md for the model, and the
// "Option B" enclave-gateway build item (the real non-loopback production path).

const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);

/** A loopback base means the proxy is co-located with the client (the host IS the user's machine). */
export function isLoopbackBase(base) {
  if (!base) return false;
  try {
    const h = new URL(base).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch { return false; }
}

/**
 * Attestation is "configured" when the caller asserts it (the client verifies the TEE quote — Option B)
 * or the deploy opts in via PRIVATEMODE_ATTESTATION. NB this is a CONFIG FLAG, not quote verification —
 * it records that someone ASSERTED an attested route, and nothing here checks a quote.
 *
 * ⚠ CORRECTED 2026-08-03. This used to say "the real client-side quote check is the unbuilt Option B
 * enclave gateway". **A real verifier exists** — `verifyAttestation` in
 * `packages/confidential-llm/src/attestation.js:65`. What is missing is not the check; it is that nothing
 * calls it on this path. So today a deployment trusts an env flag while a working verifier sits one
 * package away, unreferenced.
 *
 * Until it is wired, this remains the deliberate, auditable bypass for a deployment that has verified its
 * enclave out-of-band — but "unbuilt" was the wrong word, and it is the word that kept anyone from
 * looking.
 */
export function attestationConfigured({ attestation } = {}) {
  return Boolean(attestation || env('PRIVATEMODE_ATTESTATION'));
}

/**
 * Is a confidential route safe to receive RAW plaintext?
 * @param {{ confidential?:boolean, baseUrl?:string|null, attestation?:boolean }} cfg
 *   `confidential:true` marks a route that PROMISES confidentiality (e.g. the Privatemode proxy preset).
 *   A non-confidential route (a local model, or an explicit user-accepted cloud) is the caller's call —
 *   this guard only enforces the promise, it does not police explicit opt-in clouds.
 */
export function isConfidentialRouteSafe({ confidential, baseUrl, attestation } = {}) {
  if (!confidential) return true;                                   // not promising confidentiality → not our gate
  return isLoopbackBase(baseUrl) || attestationConfigured({ attestation });
}

/**
 * Throw unless a confidential route is safe for raw plaintext. `label` names the call site in the error.
 * @param {{ confidential?:boolean, baseUrl?:string|null, attestation?:boolean, label?:string }} cfg
 */
export function assertConfidentialRouteSafe({ confidential, baseUrl, attestation, label = 'this route' } = {}) {
  if (isConfidentialRouteSafe({ confidential, baseUrl, attestation })) return;
  throw new Error(
    `[confidential] ${label}: a confidential route points at a non-loopback host (${baseUrl}) with no ` +
    `attestation — raw plaintext would reach that host. Use a loopback proxy, or an attested enclave ` +
    `gateway (set PRIVATEMODE_ATTESTATION / pass {attestation:true}). ` +
    `See the onderling-feedback repo: docs/CONFIDENTIAL-LLM-TRANSPORT.md.`);
}
