/**
 * @onderling/oidc-session — Solid OIDC auth for Node.
 *
 * Phase 50.1 (2026-05-11) extracted `SolidVault` from
 * `@onderling/core/storage` to break the package cycle.
 *
 * Phase 52.15.1 (2026-05-14) added `KNOWN_ISSUERS` + `resolveIssuer()`
 * + the shared `SolidAuth` typedef for the Solid-auth consolidation
 * work (see `Project Files/Inrupt-migration/`). Peer of
 * `@onderling/oidc-session-rn` (the React Native variant).
 */

export { SolidVault, _setSessionFactory } from './src/SolidVault.js';

export {
  KNOWN_ISSUERS,
  DEFAULT_ISSUER_ID,
  DEFAULT_ISSUER,
  resolveIssuer,
} from './src/issuers.js';

// Phase 52.15.2 (2026-05-14) — substrate promotion of the browser-
// redirect OIDC flow wrapper. Folio + Pinboard's `OidcSession.js`
// wrappers retire in 52.15.3.
export {
  createSolidAuthNode,
  OIDC_VAULT_KEYS,
  _setSolidAuthNodeSessionFactory,
} from './src/createSolidAuthNode.js';

// Phase 52.15.4 (2026-05-14) — server-rendered HTML issuer picker.
export { getIssuerPickerHtml } from './src/issuerPickerHtml.js';

// Re-export the typedef module so consumers can JSDoc-import
// `SolidAuth`, `SignInOpts`, `Session` from this package root.
export * from './src/types.js';
