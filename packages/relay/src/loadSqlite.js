/**
 * loadSqlite — the `better-sqlite3` constructor, loaded from THIS package.
 *
 * The relay declares `better-sqlite3`, and an image that installs the relay's tree places it beside the package
 * (`packages/relay/node_modules/`), not at the workspace root. A caller outside the package (the image entrypoint
 * in `deploy/relay/`) cannot resolve it; this module can, so the stores' constructor is always taken from here.
 * Throws when the native module is not installed — a relay asked to persist must not start without it.
 * @returns {Promise<Function>}
 */
export async function loadSqlite() {
  const mod = await import('better-sqlite3');
  return mod.default ?? mod;
}
