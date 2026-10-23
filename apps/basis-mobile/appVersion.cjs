/**
 * The phone's version, from the tag of the tree being built — through the build, never typed (L354).
 *
 * - A clean tree whose HEAD is exactly a tag: that tag (`git describe --tags --exact-match`).
 * - A clean tree past a release: that release with its distance and commit (`v0.1.72-alpha-80-gf6480e13a`), never the
 *   bare tag — a build must not claim a release it is not. A test APK and its logs then say which code they run.
 * - A dirty tree, no release tag behind it, or no git at all: none — the screen then says "dev".
 * - `APP_VERSION` (a build pipeline's, e.g. the signed-APK one when it exists): counted only when it names a tag that
 *   points at HEAD of a clean tree; a pipeline cannot type a version either.
 *
 * Read by `app.config.js` into `extra.appVersion`. Nothing native (versionName, signing, Gradle) is touched.
 */
const { execFileSync } = require('node:child_process');

const realGit = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * @param {{env?: Record<string,string|undefined>, git?: (args: string[]) => string}} [o]
 * @returns {string|null}
 */
function resolveAppVersion({ env = process.env, git = realGit } = {}) {
  try {
    if (String(git(['status', '--porcelain'])).trim()) return null;   // a dirty tree is not the tagged tree
    const wanted = typeof env.APP_VERSION === 'string' && env.APP_VERSION.trim() ? env.APP_VERSION.trim() : null;
    if (wanted) {
      const atHead = String(git(['tag', '--points-at', 'HEAD'])).split('\n').map((s) => s.trim()).filter(Boolean);
      return atHead.includes(wanted) ? wanted : null;
    }
    try {
      const tag = String(git(['describe', '--tags', '--exact-match', 'HEAD'])).trim();
      if (tag) return tag;
    } catch { /* not exactly a tag: say how far past the last release this build is */ }
    const after = String(git(['describe', '--tags', '--match', 'v[0-9]*', '--long', 'HEAD'])).trim();
    return /-\d+-g[0-9a-f]+$/.test(after) ? after : null;   // never a bare tag: that would claim the release
  } catch {
    return null;   // no release tag behind the tree, or no git at all
  }
}

module.exports = { resolveAppVersion };
