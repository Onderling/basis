// IHub_V1.aidl — Hub-Android Inter-Process Binding interface, version 1.
//
// Implemented by the Hub service. Bundles (Tasks, Stoop, Folio, …) bind to
// the service via `Context.bindService` and call these methods to delegate
// storage + envelope routing to the central Hub agent. The Hub owns the
// real-pod / pseudo-pod / replication-ring decisions; bundles stay
// platform-neutral.
//
// Standardisation Phase 51.7. See substrates-v2-functional-design §4.7 +
// `Project Files/SDK/react-native-v2-coding-plan-2026-05-11.md` §51.7.
//
// Permission: every call requires the caller hold
// `org.onderling.hub.PERMISSION_BIND`. The Hub additionally checks the
// caller's package signature against its trusted-signers list.

package org.onderling.hub;

import org.onderling.hub.IIncomingCallback;

interface IHub_V1 {
    /**
     * Returns the maximum interface version this Hub speaks.
     * Bundles use this for version negotiation (Phase 51.9.2).
     */
    int getSupportedVersion();

    /**
     * Register a bundle with the Hub.
     *
     * @param manifestJson  JSON string with the bundle's identity:
     *                       {bundleId, displayName, supportedTypes: [...]}.
     * @return JSON ack string: {ok: true, bundleSessionId: "..."} on success.
     */
    String registerBundle(String manifestJson);

    /**
     * Declare the bundle's runtime capabilities. May be called multiple
     * times to refresh.
     *
     * @param capabilitiesJson  JSON string with `{caps: [...], etc}`.
     * @return JSON ack string.
     */
    String declareCapabilities(String bundleSessionId, String capabilitiesJson);

    /**
     * Fetch a resource by URI via the Hub's pseudo-pod / pod-client.
     *
     * @param uri   pseudo-pod:// or https:// URI.
     * @return raw bytes (the AIDL binding chunks oversized payloads
     *         internally — bundle-side wrapper joins them back).
     */
    byte[] fetchResource(String bundleSessionId, String uri);

    /**
     * Write a resource via the Hub.
     *
     * @param uri   target URI.
     * @param bytes payload.
     * @param etag  optional If-Match etag; empty string for none.
     * @return new etag.
     */
    String writeResource(String bundleSessionId, String uri, in byte[] bytes, String etag);

    /**
     * Publish a notify-envelope through the Hub's transport.
     *
     * @param envelopeJson  the full envelope (matches @onderling/notify-envelope's
     *                       wire shape: {v, kind, ref, etag?, fromActor?, payload?, ...}).
     * @param recipientsCsv comma-separated recipient addresses (CSV avoids
     *                       String[] marshalling quirks across some Android versions).
     */
    void publishEnvelope(String bundleSessionId, String envelopeJson, String recipientsCsv);

    /**
     * Register a callback for incoming envelopes. The Hub fires
     * `callback.onEnvelope(...)` whenever an inbound envelope matches
     * the bundle's declared types.
     */
    void registerIncomingCallback(String bundleSessionId, IIncomingCallback callback);

    /**
     * Unregister + free the session resources. Called by the bundle-
     * side wrapper on `binding.close()`.
     */
    void unregister(String bundleSessionId);
}
