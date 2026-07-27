/**
 * FITNESS GUARD — the shared RN library layer stays native-free outside the
 * sanctioned ports/adapters boundary.
 *
 * WHY: invariants #1/#2/#5 — logic lives once in shared code, web ≡ mobile
 * (→ iOS ≡ Android at the surface), and the native seam is isolated.  The
 * recurring failure in this repo is drift; per CLAUDE.md "prefer a fitness
 * function to a manual check", this test makes that drift FAIL CI.
 *
 * WHAT IT SCANS: every `.js`/`.jsx` under `packages/react-native/src/`.
 * It flags a file that (a) imports a third-party NATIVE module (`expo-*`,
 * `react-native-<lib>`, `@react-native-*`) via `import`/`require`/dynamic
 * `import()`, or (b) branches on `Platform.OS` / `Platform.Version` —
 * UNLESS the file is inside the sanctioned native boundary below.
 *
 * SANCTIONED BOUNDARY (allow-list) = the ports/ package + the existing
 * capability-wrapper modules that already isolate a native lib.  Native code
 * belongs HERE and nowhere else in `src/`.  Adding a native import or a
 * `Platform.OS` branch to shared logic/dispatch/hub/UI-orchestration code (any
 * file NOT on this list) fails the guard — extract it behind a port instead.
 *
 * Note: bare `import … from 'react-native'` (the RN FRAMEWORK — View, Text,
 * StyleSheet, AppState, NativeModules) is NOT flagged; only third-party native
 * libraries and `Platform.OS`/`Platform.Version` USAGE are.
 *
 * Tuning: the allow-list is calibrated to today's tree so the guard passes NOW
 * and catches FUTURE drift.  When you deliberately add a new capability wrapper
 * that isolates a native lib, add it here in the same change (and say why).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '../../src');

/**
 * Sanctioned native boundary — paths are POSIX, relative to `src/`.
 * A `/`-terminated entry allows the whole directory subtree; otherwise it is
 * an exact file match.
 */
const ALLOW = [
  // The ports-and-adapters boundary itself.
  'ports/',
  // Push capability wrappers (isolate expo-notifications).
  'transport/pushAdapters/',
  'push/setupPush.js',
  'push/presentLocal.js',
  // Native transports (BLE / mDNS / NKN-WebRTC bridges).
  'transport/BleTransport.js',
  'transport/MdnsTransport.js',
  'transport/NknTransport.js',
  'transport/rendezvousRtcLib.js',
  // Capability adapters that already isolate their native lib.
  'qr/',                       // react-native-qrcode-svg
  'picker/',                   // expo-image-picker / -manipulator / -document-picker / -file-system
  'storage/',                  // @react-native-async-storage / expo-file-system adapters
  'identity/KeychainVault.js', // react-native-keychain
  'identity/VaultAsyncStorage.js', // @react-native-async-storage
  'permissions.js',            // Android runtime permissions (Platform.OS/Version)
  'platform/',                 // polyfills + platform selection
  'mnemonic/',                 // clipboard/native leaf
  'deepLinks/',                // deep-link native leaf
  // The netinfo half of the network-change source. Isolated in its own file precisely BECAUSE it imports a
  // native module: it sits behind the `./netinfo` subpath export so a shell that has not installed the
  // (optional) dependency never resolves it, and the AppState half in `networkChangeSource.js` stays clean.
  'netinfoSource.js',          // @react-native-community/netinfo
];

function isAllowed(rel) {
  return ALLOW.some((entry) =>
    entry.endsWith('/') ? rel.startsWith(entry) : rel === entry,
  );
}

/** Strip block + line comments so JSDoc/prose mentions don't false-positive. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// import|require|import() of a THIRD-PARTY native lib specifier.
const NATIVE_IMPORT = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"](expo-[^'"]+|react-native-[^'"]+|@react-native[^'"]*)['"]/;
// Platform.OS / Platform.Version branch.
const PLATFORM_BRANCH = /\bPlatform\.(?:OS|Version)\b/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('native-boundary fitness guard (packages/react-native/src)', () => {
  it('no shared module touches native outside the sanctioned ports/adapters boundary', () => {
    const violations = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
      if (isAllowed(rel)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      const reasons = [];
      const imp = code.match(NATIVE_IMPORT);
      if (imp) reasons.push(`native import ${JSON.stringify(imp[1])}`);
      if (PLATFORM_BRANCH.test(code)) reasons.push('Platform.OS/Version branch');
      if (reasons.length) violations.push(`${rel} — ${reasons.join('; ')}`);
    }

    expect(
      violations,
      violations.length
        ? `Native code leaked into shared RN modules. Move it behind a port ` +
          `(@onderling/react-native/ports) or, if this is a legitimate new ` +
          `capability wrapper, add it to the ALLOW list in this test:\n  ` +
          violations.join('\n  ')
        : undefined,
    ).toEqual([]);
  });

  it('the allow-list has no dead entries (every entry matches something on disk)', () => {
    const rels = walk(SRC_ROOT).map((f) =>
      path.relative(SRC_ROOT, f).split(path.sep).join('/'),
    );
    const dead = ALLOW.filter((entry) =>
      entry.endsWith('/')
        ? !rels.some((r) => r.startsWith(entry))
        : !rels.includes(entry),
    );
    expect(dead, `Stale ALLOW entries (no matching file): ${dead.join(', ')}`).toEqual([]);
  });
});
