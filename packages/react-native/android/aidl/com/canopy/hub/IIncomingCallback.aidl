// IIncomingCallback.aidl — Hub → bundle callback interface.
//
// Implemented by the bundle. Registered via `IHub_V1.registerIncomingCallback`.
// The Hub invokes `onEnvelope` whenever an inbound envelope matches the
// bundle's declared types (per its registerBundle manifest).
//
// Standardisation Phase 51.7.

package org.onderling.hub;

oneway interface IIncomingCallback {
    /**
     * Deliver an inbound envelope to the bundle.
     *
     * `oneway` so the Hub doesn't block on bundle processing.
     *
     * @param envelopeJson  the wire envelope JSON, including payload when
     *                       the picker chose 'full-payload' mode.
     */
    void onEnvelope(String envelopeJson);
}
