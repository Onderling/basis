/**
 * grantsManifest — the DECLARED contract for the grants lane's log entries.
 *
 * Same shape and role as `membershipManifest`: a cross-cutting plumbing manifest declaring which
 * signed statement kinds the grants lane of the device log carries. The rail refuses anything else
 * at both ends (append + verify-on-ingest). The acts themselves are the connection grant/revoke
 * writers (`surfaceGrants.js` — pairing a view, unpairing it): a connection is a property of the
 * PERSON, so these statements travel between the owner's own devices, and the active-grant set on
 * any device is a fold of this lane.
 */

/** The device-log lane grant statements ride (system lane; RECORD retention — a revoke that
 *  compacted away would silently re-admit the view it unpaired, the same never-drop argument as
 *  membership). */
export const GRANTS_LANE = 'grants';

/**
 * The scope key the lane's statements carry where a circle rail carries a circleId. Grants are
 * PERSONAL — the "circle" is the owner's own device set — so every statement on the lane shares
 * this one constant scope.
 */
export const OWN_DEVICES_SCOPE = 'own-devices';

export const grantsManifest = Object.freeze({
  app: 'grants',
  itemTypes: [],
  nouns: {},
  operations: [
    { id: 'grants.grant',  description: 'The owner pairs a view: a standing connection grant (metadata + the minted token ids — the token blobs go to the view, never the lane).', appends: [{ lane: GRANTS_LANE, kind: 'grant' }] },
    { id: 'grants.revoke', description: 'The owner unpairs a view (deny-wins: a revoke defeats any grant that did not causally see it, on every device).',                          appends: [{ lane: GRANTS_LANE, kind: 'grant-revoke' }] },
  ],
});

export default grantsManifest;
