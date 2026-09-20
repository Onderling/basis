/**
 * appVersion — is the build this tab runs the one the site serves? (2026-09-19)
 *
 * A web app is a page: once open it never updates itself, and the host caches `index.html` heuristically, so a tab
 * can run last week's build while the site serves today's — and every fix "does not work" for whoever kept the
 * tab. Measured 2026-09-19: Frits' laptop ran the build from before the fix that made his phone's messages visible.
 * The build bakes its tag (`VITE_APP_VERSION`, stamped by the publish) and the site serves `version.json` beside
 * the app; this compares the two, fetched fresh, and tells the shell when the site is ahead. A dev build has no
 * tag and never nags; offline is not "outdated".
 */

/** @returns {boolean} the served tag is known and not the running one */
export function updateAvailable(running, served) {
  if (typeof running !== 'string' || !running) return false;
  const tag = served?.tag;
  return typeof tag === 'string' && tag !== '' && tag !== running;
}

/**
 * @param {object} a
 * @param {string} a.running       the tag baked into this build ('' in dev)
 * @param {string} a.versionUrl    where the site serves version.json (beside the app)
 * @param {typeof fetch} [a.fetchImpl]
 * @param {(info: {running: string, served: string}) => void} [a.onUpdate]  said once per newer tag
 */
export function createVersionWatch({ running, versionUrl, fetchImpl = globalThis.fetch, onUpdate = null } = {}) {
  let told = null;   // the served tag the listener was last told about
  async function check() {
    let served = null;
    try {
      const r = await fetchImpl(versionUrl, { cache: 'no-store' });
      served = r?.ok ? await r.json() : null;
    } catch { served = null; }
    const update = updateAvailable(running, served);
    if (update && served.tag !== told) {
      told = served.tag;
      try { onUpdate?.({ running, served: served.tag }); } catch { /* the shell's bar is not the product */ }
    }
    return { running: running ?? '', served: typeof served?.tag === 'string' ? served.tag : null, update };
  }
  return { check };
}
