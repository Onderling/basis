/**
 * The ONE door to the `onderling-feedback` package — loaded lazily, never at boot.
 *
 * Why this module exists: the feedback app is a SIBLING repository reached through a filesystem link
 * (`"onderling-feedback": "link:../../../feedback"`). It is present on a developer machine that has both
 * checkouts and absent on a clean clone and in CI. Three modules used to import it at module scope, which
 * meant the production web build (`vite build`) could not be made from this repository alone — the one code
 * blocker for a web-first go-live, found 2026-09-03. The architecture already fixes the direction of this
 * dependency the other way round ("feedback consumes @onderling/*"); until the package is published and
 * that inversion lands, this is the honest interim: the package is loaded at the feedback DOOR, and a
 * missing package degrades the feedback feature, never the app.
 *
 *   await loadFeedbackPackage()   — at an async door (attach a project, open a thread, switch language);
 *                                   memoised; rejects with a clear message when the package is absent.
 *   getFeedbackPackage()          — the synchronous accessor the factories read; throws if nothing has
 *                                   loaded it yet, so a factory can never silently build against nothing.
 *
 * The specifier is a LITERAL on purpose: Metro (mobile) bundles a literal dynamic import; vite's build is
 * told to leave it external only when it cannot be resolved (see `vite.config.js`), so a build WITH the
 * sibling present bundles it exactly as before.
 */
let loaded = null;
let loading = null;

export function loadFeedbackPackage() {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = import('onderling-feedback/public')
      .then((mod) => { loaded = mod; return mod; })
      .catch((err) => {
        loading = null;
        throw new Error(`feedback package not available: ${err?.message ?? err}`);
      });
  }
  return loading;
}

export function getFeedbackPackage() {
  if (!loaded) throw new Error('feedback package not loaded — await loadFeedbackPackage() at the feedback door first');
  return loaded;
}

export function isFeedbackPackageLoaded() { return loaded !== null; }

/** Test seam: forget the loaded module so a suite can exercise the not-loaded path. */
export function __resetFeedbackPackage() { loaded = null; loading = null; }
