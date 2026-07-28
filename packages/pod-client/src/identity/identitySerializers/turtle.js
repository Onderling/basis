/**
 * turtle.js — minimal hand-rolled Turtle writer for the manifest.
 *
 * Scope is INTENTIONALLY narrow: this serializer only emits the
 * `<#manifest>` document shape from `Design-v3/identity-pod-schema.md`
 * §Manifest.  It is NOT a general-purpose Turtle library; do not
 * extend it without good reason — pull in `n3.js` instead.
 *
 * Per-resource records (Device, Contact, …) are handled by the
 * encryption-envelope JSON path (see `IdentityPodStore.js` JSDoc for
 * the v1 schema deviation note).  This serializer is only for the
 * manifest.
 */

// Naming migration 2026-07-28: new docs declare the onderling namespace. The parser matches the `dw:`
// PREFIX LABEL, never this URL, so pre-rename docs (declared with canopy.org) still parse unchanged.
const NS_DW  = 'https://onderling.org/ns#';
const NS_XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * Escape characters disallowed in a Turtle short-quoted literal.
 *
 * @param   {string} s
 * @returns {string}
 */
function escapeLiteral(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g,  '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Serialize a manifest object to canonical Turtle.
 *
 * Predicates are emitted in a fixed deterministic order so that the
 * canonical form (used for signing) is stable across implementations.
 * The `signature` predicate, if present, is always last; the
 * `withoutSignature` flag elides it (used for the signing input).
 *
 * @param   {object}  manifest
 * @param   {string}  manifest.schemaVersion
 * @param   {string}  manifest.lastUpdated     ISO-8601 datetime.
 * @param   {string}  manifest.rootDevicePubkey
 * @param   {string}  manifest.contentHash     `sha256:<hex>`.
 * @param   {string}  [manifest.signature]     base64-encoded ed25519 sig.
 * @param   {object}  [opts]
 * @param   {boolean} [opts.withoutSignature=false]
 * @returns {string}
 */
export function serializeManifest(manifest, opts = {}) {
  const lines = [];
  lines.push(`@prefix dw:  <${NS_DW}> .`);
  lines.push(`@prefix xsd: <${NS_XSD}> .`);
  lines.push('');
  lines.push('<#manifest>');
  lines.push('  a dw:IdentityManifest ;');
  lines.push(`  dw:schemaVersion     "${escapeLiteral(manifest.schemaVersion)}" ;`);
  lines.push(`  dw:lastUpdated       "${escapeLiteral(manifest.lastUpdated)}"^^xsd:dateTime ;`);
  lines.push(`  dw:rootDevicePubkey  "${escapeLiteral(manifest.rootDevicePubkey)}" ;`);
  // The signature line, if present, is the LAST predicate; trailing `;`
  // becomes `.` on whichever line is last.
  const includeSig = !opts.withoutSignature && typeof manifest.signature === 'string';
  if (includeSig) {
    lines.push(`  dw:contentHash       "${escapeLiteral(manifest.contentHash)}" ;`);
    lines.push(`  dw:signature         "${escapeLiteral(manifest.signature)}" .`);
  } else {
    lines.push(`  dw:contentHash       "${escapeLiteral(manifest.contentHash)}" .`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Tiny line-based Turtle scanner for the manifest shape.  Only handles
 * what `serializeManifest` produces.  Returns the raw string fields;
 * callers are responsible for re-validating types.
 *
 * @param   {string} ttl
 * @returns {{ schemaVersion?: string, lastUpdated?: string,
 *            rootDevicePubkey?: string, contentHash?: string,
 *            signature?: string }}
 */
export function parseManifest(ttl) {
  const out = {};
  // Match: dw:predicate "literal" optional ^^datatype  (terminator ; or .)
  const re = /dw:(\w+)\s+"((?:[^"\\]|\\.)*)"(?:\^\^xsd:\w+)?\s*[;.]/g;
  let m;
  while ((m = re.exec(ttl)) !== null) {
    const pred = m[1];
    // Unescape Turtle short-string literal escapes.
    const val  = m[2]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    if (pred === 'schemaVersion'
     || pred === 'lastUpdated'
     || pred === 'rootDevicePubkey'
     || pred === 'contentHash'
     || pred === 'signature') {
      out[pred] = val;
    }
  }
  return out;
}
