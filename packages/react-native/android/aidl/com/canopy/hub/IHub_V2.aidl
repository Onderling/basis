// IHub_V2.aidl — Hub-Android binding, version 2. Additive over V1.
//
// V2 surfaces interface-registry + protocol-orchestration calls so
// bundles can register renderers and drive state-machine protocols
// through the central Hub.
//
// Standardisation Phase 51.11 (direction-only). V0 ships the AIDL
// + the JS-side wrapper; the Hub-Android side picks up the
// implementation when V2 timing is committed.

package org.onderling.hub;

import org.onderling.hub.IHub_V1;

interface IHub_V2 {
    /**
     * Returns 2 on a V2-capable Hub. Bundles use this for version
     * negotiation alongside `IHub_V1.getSupportedVersion`.
     */
    int getSupportedVersion();

    // ── V1 surface, re-exposed verbatim ───────────────────────────────────

    String registerBundle(String manifestJson);
    String declareCapabilities(String bundleSessionId, String capabilitiesJson);
    byte[] fetchResource(String bundleSessionId, String uri);
    String writeResource(String bundleSessionId, String uri, in byte[] bytes, String etag);
    void   publishEnvelope(String bundleSessionId, String envelopeJson, String recipientsCsv);
    void   registerIncomingCallback(String bundleSessionId, IBinder callback);
    void   unregister(String bundleSessionId);

    // ── V2 additions ─────────────────────────────────────────────────────

    /**
     * Register a renderer with the interface-registry substrate.
     *
     * @param rendererJson  {type, bundleId, rendererManifest, actions}.
     *                      The rendererManifest carries the loadable
     *                      renderer's locator (URI + checksum); the
     *                      actual renderer fn lives in the bundle.
     */
    String registerInterface(String bundleSessionId, String rendererJson);

    /**
     * Look up the active renderer for a type.
     *
     * @return JSON: {entry, conflicts: [...]} or {entry: null} if no
     *         renderer is registered.
     */
    String lookupInterface(String bundleSessionId, String typeName);

    /**
     * Drive a protocol step via the central orchestrator.
     *
     * @param protocolId   the protocol's id (e.g. 'propose-subtask').
     * @param eventJson    {instanceId, event, payload?}.
     * @return JSON: the next instance state.
     */
    String orchestrateProtocol(String bundleSessionId, String protocolId, String eventJson);

    /**
     * Subscribe to protocol state transitions. The Hub fires the
     * bundle's IIncomingCallback with `{kind: 'protocol-state', ...}`
     * envelopes.
     */
    void subscribeProtocolState(String bundleSessionId, String instanceId);
}
