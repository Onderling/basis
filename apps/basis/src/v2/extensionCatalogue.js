/**
 * extensionCatalogue — the extensions a node runs with, composed: each one checked against the compose rules
 * (`checkExtensionManifest`: its nouns under its origin, its words its own) and its declared types joined to the
 * stores' registry (`registerDeclaredTypes`: no shadow, all or nothing). What passes is the node's set of installed
 * extensions; what does not is refused out loud and brings nothing.
 *
 * WHICH manifests reach this — the realm install (fetch by hash, verify, consent) — is not decided here; a boot hands
 * them in. The origin each one carries is the installer's reading of who it is, never the manifest's own `app`.
 */
import { checkExtensionManifest } from '@onderling/app-manifest';
import { registerDeclaredTypes } from '@onderling/item-types';

/**
 * @param {Array<{origin: string, manifest: object}>|null|undefined} entries
 * @param {{registry: object, firstParty: object[], warn?: (msg: string) => void}} a
 * @returns {{installed: Map<string, object>, refused: Array<{origin: string, problems: object[]}>}}   origin → manifest
 */
export function composeExtensions(entries, { registry, firstParty, warn = (m) => console.warn(m) }) {
  const installed = new Map();
  const refused = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const origin = e?.origin;
    const manifest = e?.manifest;
    const checked = checkExtensionManifest(manifest, { origin, firstParty });
    const problems = [...checked.problems];
    if (!problems.length) {
      const r = registerDeclaredTypes(registry, [{ origin, manifest }]);
      problems.push(...r.refused);
    }
    if (problems.length || installed.has(origin) || firstParty.some((m) => m?.app === origin)) {
      refused.push({ origin, problems: problems.length ? problems : [{ reason: 'origin-taken' }] });
      warn(`[extensions] "${origin}" refused: ${JSON.stringify(problems.length ? problems : [{ reason: 'origin-taken' }])}`);
      continue;
    }
    installed.set(origin, manifest);
  }
  return { installed, refused };
}
