/**
 * Canonical predicate IRIs the standardisation plan writes onto a user's
 * WebID profile.  Each names a pointer-URI to a "heavy state" resource
 * that lives on the user's pod (or pseudo-pod replication ring for
 * no-pod users) — §II.3 + §II.8 of the standardisation plan.
 *
 * Short form (with the `dec:` prefix) and full IRI form are both
 * recognised by `discoverPointers`.
 */

export const NAMESPACE = 'https://onderling.org/ns#';

export const WEBID_PREDICATES = Object.freeze({
  /** Pointer to the user's storage-mapping pod resource (§II.3). */
  storageMappingUri: `${NAMESPACE}storage-mapping-uri`,
  /** Pointer to the user's agent-registry pod resource (§II.8). */
  agentRegistryUri:  `${NAMESPACE}agent-registry-uri`,
  /** Pointer to the user's audit-log pod resource (deferred; pre-Hub unused). */
  auditLogUri:       `${NAMESPACE}audit-log-uri`,
});

/**
 * Short-name forms used in Turtle prefix-style.
 * Format: `dec:<localName>` mapped to the local-name part.
 */
export const SHORT_NAMES = Object.freeze({
  'storage-mapping-uri': 'storageMappingUri',
  'agent-registry-uri':  'agentRegistryUri',
  'audit-log-uri':       'auditLogUri',
});
