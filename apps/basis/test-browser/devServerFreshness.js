/**
 * Is the dev server the browser talks to actually serving THIS working tree?
 *
 * Playwright reuses an existing server (`reuseExistingServer: !CI`), which is the right default: a cold
 * boot of this app takes minutes. The cost is that a `vite` left running by an earlier session keeps its
 * own module graph, and a browser run then measures code nobody has any more. Nothing says so. The page
 * loads, the app works, the story fails somewhere plausible, and the failure looks exactly like a
 * product bug.
 *
 * It cost most of an afternoon on 2026-09-09: a direct message "did not arrive", the same red appeared
 * with the change stashed and again on the trunk, and that agreement was read as proof the defect was
 * pre-existing. All three runs were the same stale bundle. Restarting the server made every step pass.
 * The rule this breaks is already written down — prove the harness before you blame the product — and it
 * broke anyway, because there was nothing to trip over.
 *
 * So: ask the server for a module, and check it answers with what is on disk. Not a hash of the whole
 * file (vite rewrites imports), but the declarations, which it does not touch. A server that cannot
 * produce a function that exists in the source is behind, and the run stops with the reason rather than
 * with a mystery three steps later.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Files worth asking about: recently-touched shared modules the shells import. One that the server has
 * never heard of is the loudest possible signal, and a stale graph usually shows up in the newest file
 * first. Add to this list rather than replacing it — an old entry keeps catching an old failure.
 */
const PROBES = [
  'src/v2/circleLanes.js',
  'src/v2/contactTurnFan.js',
  'src/v2/contactThreadChannel.js',
];

const declarationsOf = (src) => [
  ...src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm),
  ...src.matchAll(/^export\s+const\s+([A-Z_][A-Z0-9_]*)\s*=/gm),
].map((m) => m[1]);

/**
 * @param {string} baseUrl  where the browser will load the app from
 * @throws when the server answers with something older than the working tree
 */
export async function assertDevServerIsFresh(baseUrl) {
  for (const rel of PROBES) {
    const abs = path.resolve(HERE, '..', rel);
    let disk;
    try { disk = fs.readFileSync(abs, 'utf8'); } catch { continue; }   // the file may be gone; not our business
    const want = declarationsOf(disk);
    if (!want.length) continue;

    // `/@fs/<absolute path>` is vite's own way to ask for a file by path, which saves guessing where
    // its root is — and a wrong guess would come back as the SPA's index.html with a 200 on it, which
    // is the one answer that looks like success and is not.
    const url = `${baseUrl}/@fs${abs}`;
    let served = null;
    try {
      const res = await fetch(url);
      const body = res.ok ? await res.text() : null;
      // An HTML answer means the server did not recognise the path, not that the module is old.
      served = (body && !/^\s*<(!doctype|html)/i.test(body)) ? body : null;
    } catch { /* handled below */ }

    if (served == null) {
      throw new Error(
        `[dev-server] ${url} did not answer with a module. The browser cannot be running this working tree.\n`
        + '  Stop the dev server and let Playwright start its own:\n'
        + "    pkill -f 'vite' && rm -rf apps/basis/node_modules/.vite",
      );
    }
    const missing = want.filter((name) => !served.includes(name));
    if (missing.length) {
      throw new Error(
        `[dev-server] the server is serving an OLD ${rel} — it has no ${missing.slice(0, 4).join(', ')}.\n`
        + '  A vite left running by an earlier session keeps its own module graph, so this run would\n'
        + '  measure code that is no longer here, and any failure would look like a product bug.\n'
        + '  Stop it and let Playwright start its own:\n'
        + "    pkill -f 'vite' && rm -rf apps/basis/node_modules/.vite",
      );
    }
  }
}

export default assertDevServerIsFresh;
