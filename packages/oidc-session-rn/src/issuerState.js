/**
 * The sign-in hook's state is PER ISSUER. A discovery document and a registered (DCR) client belong to the provider
 * they were made for; the hook keeps each as `{ issuer, value }`, and reads it only while that is still the issuer
 * it was handed. Without this, picking another provider left the previous one's discovery standing (`ready` stayed
 * true) and its client id in use: every sign-in went to the first provider.
 */

/** The slot's value when it was made for `issuer`, else null. */
export function forIssuer(slot, issuer) {
  return slot && slot.issuer === issuer ? (slot.value ?? null) : null;
}

/**
 * May a sign-in start for `issuer`? Its own discovery, its own client (or one the app fixed), and the request built.
 * @param {{ issuer: string, discovered: object|null, client: object|null, request: object|null, fixedClientId?: string|null }} s
 */
export function issuerReady({ issuer, discovered, client, request, fixedClientId = null }) {
  return Boolean(forIssuer(discovered, issuer) && (fixedClientId || forIssuer(client, issuer)) && request);
}
