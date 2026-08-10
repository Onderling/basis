/**
 * settingsPodMedium — the pod-backed, SELF-SEALED inner for the parameter register's settings store.
 *
 * The register's settings `CachingDataSource` starts LOCAL (a device-local island). This builds the
 * pod-backed inner the shell attaches on sign-in (`realAgent` `opts.provisionSettingsMedium` →
 * `cache.attachInner`), so agent/circle params sync on the SAME pod as the rest of a user's data — the
 * cross-app-settings layout `<pod>/basis/settings/shared.json` + `devices/<deviceId>.json`.
 *
 * SEALING (invariant 7 — functionality placed by trust): settings are the OWNER'S OWN data, so they seal
 * to the agent's OWN network-derived sealing key — a seal-to-self `{seal, open}` strategy the CALLER builds
 * from its identity (`settingsSealStrategyForIdentity`, keeping the private key encapsulated). That key is
 * derived from the OWNER ROOT (`deriveAgentSeed`, reproducible from the recovery phrase ALONE), so it is
 * IDENTICAL across a user's devices → agent-scoped settings sealed on one device OPEN on another (true
 * cross-device sync, not a per-device island). Deliberately NOT a circle group key (those are per-circle).
 *
 * PATH MAP: the settings module addresses `mem://basis/settings/…` LOGICAL keys; the sealed pod source
 * addresses pod-relative URIs under `podRoot`. This strips the `mem://` scheme so the sealed
 * `SolidPodSource` writes to `<podRoot>basis/settings/…`, and re-adds it on `list` read-back.
 *
 * Shared (not shell) by design: web wires it first (`circleApp` sign-in), mobile reuses the SAME factory —
 * web ≡ mobile by construction (invariant 2), no routing logic in a shell (invariant 1).
 */
import { createSealedPodDataSource } from '@onderling/pod-client';

const SETTINGS_SCHEME = /^mem:\/\//;
const toPodKey   = (p) => (typeof p === 'string' ? p.replace(SETTINGS_SCHEME, '') : p);
const fromPodKey = (u) => (typeof u === 'string' && !SETTINGS_SCHEME.test(u) ? `mem://${u}` : u);

/**
 * Build the self-sealed, path-mapped pod inner for the settings store.
 *
 * @param {object} a
 * @param {Function} a.fetch                        authenticated pod fetch (a signed-in session's fetch)
 * @param {string}   a.podRoot                      the user's pod root (trailing slash), e.g. discoverPodRoot(session)
 * @param {{seal:Function,open:Function}} a.strategy  the seal-to-self strategy (from settingsSealStrategyForIdentity)
 * @param {object}   [a.podSource]                  a `SolidPodSource`-shaped backend (read/write/delete/list) —
 *   inject an in-memory fake for tests; else the real pod source is built from `fetch`+`podRoot`.
 * @returns {Promise<object|null>}  a DataSource-shaped inner (read/write/delete/list), or null when not
 *   signed-in / no sealing strategy (→ realAgent leaves the settings store LOCAL, honest degrade).
 */
export async function createSettingsPodMedium({ fetch, podRoot, strategy, podSource } = {}) {
  if ((typeof fetch !== 'function' && !podSource) || !podRoot) return null;
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') return null;
  const sealed = createSealedPodDataSource({ podSource, fetch, podUrl: podRoot, strategy });

  return {
    sealed: true,
    read:   (p)       => sealed.read(toPodKey(p)),
    write:  (p, val)  => sealed.write(toPodKey(p), val),
    delete: (p)       => sealed.delete(toPodKey(p)),
    async list(prefix) {
      const uris = await sealed.list(toPodKey(prefix));
      return Array.isArray(uris) ? uris.map(fromPodKey) : uris;
    },
  };
}
