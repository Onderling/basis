/**
 * lint-sealed-at-rest — every local store a shell builds is sealed on the way to disk.
 *
 * What this protects: a person's own words on their own device. Until 2026-09-10 the circle items, the
 * household list, the search index and the agent registry reached IndexedDB, AsyncStorage and disk in
 * plain text. That is fixed by wrapping each backend where it is CONSTRUCTED — which is exactly the kind
 * of fix that decays, because the next store someone adds looks like all the others and nothing fails
 * when its wrapper is missing. It just quietly writes readable content.
 *
 * So the rule is mechanical and cheap to satisfy: in a shell, a local backend factory call
 * (`pickWebBackend` on web, `createAsBackend` on mobile) must sit inside `sealedLocalBackend(...)`.
 *
 * THE ONE EXEMPTION is the agent registry. It is handed to `realAgent` unwrapped ON PURPOSE, because
 * realAgent seals it there — it also owns the pod mirror's strategy, and the two must be the same key.
 * Wrapping it in the shell as well would seal it twice. The exemption is keyed on the store's own name so
 * it cannot silently widen to cover a different store.
 */
import { readFileSync } from 'node:fs';

/** Shell files that construct local backends, and the factory each platform uses. */
const FILES = [
  { path: 'apps/basis/web/v2/circleApp.js',                        factory: 'pickWebBackend' },
  { path: 'apps/basis-mobile/src/core/circlePods.js',              factory: 'createAsBackend' },
  { path: 'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js', factory: 'createAsBackend' },
  { path: 'apps/basis-mobile/src/core/objectVersionsStorageRN.js', factory: 'createAsBackend' },
  { path: 'apps/basis-mobile/App.js',                              factory: 'createAsBackend' },
];

/** Sealed by realAgent instead, so the shell hands it over bare. Matched on the store name. */
const SEALED_ELSEWHERE = /cc-agent-registry/;

const problems = [];
let checked = 0;

for (const { path, factory } of FILES) {
  let src;
  try { src = readFileSync(path, 'utf8'); }
  catch { problems.push({ path, line: 0, text: `file not found — has it moved? update ${import.meta.url.split('/').pop()}` }); continue; }

  src.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('*') || line.startsWith('//')) return;      // a comment naming the factory is fine
    if (!line.includes(`${factory}(`)) return;
    if (line.startsWith('import ') || line.includes('export function') || line.includes('} from ')) return;
    checked += 1;
    if (SEALED_ELSEWHERE.test(line)) return;                        // the registry — sealed in realAgent
    if (line.includes('sealedLocalBackend(')) return;               // the ordinary, correct shape
    problems.push({ path, line: i + 1, text: line.slice(0, 120) });
  });
}

if (problems.length) {
  console.error('✖ sealed-at-rest: a local store is built without a seal — it would write a person\'s content readable:');
  for (const p of problems) console.error(`    ${p.path}:${p.line}  ${p.text}`);
  console.error('');
  console.error('  Wrap it: sealedLocalBackend(<factory>({ … }))   (apps/basis/src/v2/localStoreSeal.js)');
  console.error('  If it is genuinely sealed somewhere else, say so where the exemption is listed in this guard.');
  process.exit(1);
}

console.log(`✓ sealed-at-rest: ${checked} local store construction(s) across both shells, every one sealed.`);
