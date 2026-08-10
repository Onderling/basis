/**
 * governanceManifest — the DECLARED contract for circle governance's log entries.
 *
 * Cross-cutting plumbing manifest, same shape and role as `paramsManifest`: no item types, no nouns — it
 * exists so what governance APPENDS to the device log is DECLARED rather than implied by code. Each op row
 * names the signed statement kind it appends (`appends: [{ lane, kind }]`); the composition derives the
 * rail's allowed-kind set from this table (`entryKindRegistryFromManifests`), and the rail refuses anything
 * else at BOTH ends — a misconfigured caller fails loudly at its own append, a malicious peer's invented
 * kind is refused at ingest. A third-party add-on wanting its own lane declares the same way.
 *
 * The op ids are the DECLARATION's names for the three governance acts; today the acts are reached through
 * the shared governance handle (`bindCircleGovernance`), not the waist — routing them through `callSkill`
 * is the flow layer's later step, and nothing here blocks it.
 */

/** The device-log lane governance statements ride (the EventLog kind — system lane, audit retention). */
export const GOVERNANCE_LANE = 'governance';

export const governanceManifest = Object.freeze({
  app: 'governance',
  itemTypes: [],
  nouns: {},
  operations: [
    { id: 'governance.propose', description: 'Open a proposal (a governed action + subject) on the circle log.', appends: [{ lane: GOVERNANCE_LANE, kind: 'propose' }] },
    { id: 'governance.vote',    description: 'Cast a yes/no vote on an open proposal.',                          appends: [{ lane: GOVERNANCE_LANE, kind: 'vote' }] },
    { id: 'governance.resolve', description: 'Record a proposal\'s close (enacted, rejected, or cancelled).',    appends: [{ lane: GOVERNANCE_LANE, kind: 'resolve' }] },
  ],
});

export default governanceManifest;
