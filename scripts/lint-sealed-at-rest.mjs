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
 * The same rule covers the per-circle KEY vault, and that one is why this guard is not paranoia. The
 * vault at `cc-circle-pod` holds two private keys per circle. It is built in the SHELLS, so
 * `realAgent`'s `sealedVault()` never reached it, and its rows sat readable on the disk right next to
 * the content they decrypt — found 2026-09-10, by a test that read the raw store instead of the store.
 * A vault constructor in a shell must sit inside `sealedLocalVault(...)`.
 *
 * THE ONE EXEMPTION is the agent registry. It is handed to `realAgent` unwrapped ON PURPOSE, because
 * realAgent seals it there — it also owns the pod mirror's strategy, and the two must be the same key.
 * Wrapping it in the shell as well would seal it twice. The exemption is keyed on the store's own name so
 * it cannot silently widen to cover a different store.
 */
import { readFileSync } from 'node:fs';

/** Shell files that construct local stores, the factory each uses, and the wrapper that must hold it. */
const FILES = [
  { path: 'apps/basis/web/v2/circleApp.js',                        factory: 'pickWebBackend',   wrapper: 'sealedLocalBackend' },
  { path: 'apps/basis-mobile/src/core/circlePods.js',              factory: 'createAsBackend',  wrapper: 'sealedLocalBackend' },
  { path: 'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js', factory: 'createAsBackend',  wrapper: 'sealedLocalBackend' },
  { path: 'apps/basis-mobile/src/core/objectVersionsStorageRN.js', factory: 'createAsBackend',  wrapper: 'sealedLocalBackend' },
  { path: 'apps/basis-mobile/App.js',                              factory: 'createAsBackend',  wrapper: 'sealedLocalBackend' },
  // The per-circle KEY vault — two private keys per circle. See the header.
  { path: 'apps/basis/web/v2/circleApp.js',                        factory: 'new VaultIndexedDB',    wrapper: 'sealedLocalVault' },
  { path: 'apps/basis-mobile/src/core/circlePods.js',              factory: 'new VaultAsyncStorage', wrapper: 'sealedLocalVault' },
];

/** Sealed by realAgent instead, so the shell hands it over bare. Matched on the store name. */
const SEALED_ELSEWHERE = /cc-agent-registry/;

const problems = [];
let checked = 0;

for (const { path, factory, wrapper } of FILES) {
  let src;
  try { src = readFileSync(path, 'utf8'); }
  catch { problems.push({ path, line: 0, text: `file not found — has it moved? update ${import.meta.url.split('/').pop()}` }); continue; }

  const lines = src.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('*') || line.startsWith('//')) return;      // a comment naming the factory is fine
    if (!line.includes(`${factory}(`)) return;
    if (line.startsWith('import ') || line.includes('export function') || line.includes('} from ')) return;
    checked += 1;
    if (SEALED_ELSEWHERE.test(line)) return;                        // the registry — sealed in realAgent
    // A construction is often wrapped across LINES — the vault ones open the wrapper, then an IIFE, then
    // the constructor. So look at the small window above as well as the line itself. Three lines is the
    // width of the real shapes here and narrow enough that an unrelated call cannot vouch for one.
    const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (window.includes(`${wrapper}(`)) return;                     // the ordinary, correct shape
    problems.push({ path, line: i + 1, text: line.slice(0, 120) });
  });
}

if (problems.length) {
  console.error('✖ sealed-at-rest: a local store is built without a seal — it would write a person\'s content readable:');
  for (const p of problems) console.error(`    ${p.path}:${p.line}  ${p.text}`);
  console.error('');
  console.error('  Wrap it: sealedLocalBackend(<backend>) or sealedLocalVault(<vault>)   (apps/basis/src/v2/localStoreSeal.js)');
  console.error('  If it is genuinely sealed somewhere else, say so where the exemption is listed in this guard.');
  process.exit(1);
}

console.log(`✓ sealed-at-rest: ${checked} local store + key-vault construction(s) across both shells, every one sealed.`);
