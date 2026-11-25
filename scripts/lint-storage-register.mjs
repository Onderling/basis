#!/usr/bin/env node
/**
 * lint-storage-register — every name a shell or the box stores under comes from the one register, and the register
 * holds no name nothing opens.
 *
 * `apps/basis/src/v2/storageRegister.js` is the table the lists that must know every name are derived from: what a
 * freshly enrolled device forgets, what a start-over removes, and (in the alpha build) the move to one prefix. A name
 * written by hand at its call site is a name those lists do not know: nothing fails, and the device keeps it for ever.
 * Two rules, over the shipped shell and box files:
 *   1. a name written by hand reaching a storage call is red — a literal (or a template that starts with literal text,
 *      or an UPPER_CASE const of the same file holding one) passed to getItem / setItem / removeItem, pickWebBackend,
 *      sealedNamedBackend, makeBrowserVault, `dbName:`, or a `scope:` / `prefix:` on a line that builds a backend or a
 *      vault. Take it from the
 *      register: storageName('<id>');
 *   2. a register row nothing opens is red: its id is never passed to storageName(...) in the shipped files, and it is
 *      not in OPENED_ELSEWHERE below with the place that opens it and why.
   3. how a row sits on the disk is ruled on the row (`seal`): `'sealed'`, or a reason under one head (`not content:` ·
 *      `not sealable:` · `unwritten:` · `debt: L<n>`). A RAW write (`.setItem(` on localStorage, AsyncStorage or a
 *      handed storage, not through a sealed store) must name a row, by `storageName('<id>')` on the line or through a
 *      const (of any shell file) holding one, and that row must not be `'sealed'`. A file whose writes go through a
 *      storage AND a key its caller hands it is listed in WRITES_FOR_ITS_CALLER with the row(s) and who seals.
 *      This rule replaces lint-sealed-key-value and its baseline: the decision now sits on the row, once.
 * NOT_STORAGE lists the few hand-written names rule 1 sees that are not a device-level storage name (a key inside a
 * vault the box owns, a pod path), each with its reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps/basis/web', 'apps/basis/src', 'apps/basis/bin', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];
const REGISTER = 'apps/basis/src/v2/storageRegister.js';

/** Rows opened somewhere rule 2 cannot see by id: the place, and why. */
export const OPENED_ELSEWHERE = Object.freeze({
  rootKeyDb: 'by its package: @onderling/vault RootKeyStoreWebCrypto opens it under its own default name',
  pseudoPodDb: 'by its package: @onderling/pseudo-pod IndexedDbBackend opens it under its own default name',
  podClientDb: 'by its package: @onderling/pod-client IndexedDBTombstones opens it under its own default name',
  sealingIdentity: 'by its package: @onderling/pod-client sealing/memberIdentity keeps it under its own default name',
  wakeNudges: 'by its package: @onderling/react-native/push createWakeNudges (agentBundle.js) keeps it',
  basisDb: 'by nothing today (an earlier build\'s database); listed so the start-over removes it',
  helpCircleStore: "by the per-circle name (circleStorageName) for the help circle, whose id is the literal 'cc-help'",
  helpCircleCache: "by the per-circle cache name (circleStorageName) for the help circle, whose id is the literal 'cc-help'",
  vaultOwnerRootKey: "a key inside the device vault ('owner-root', ownerRootRestore.js / personaRuntime.js); the vault adds the prefix",
  vaultContentKey: "a key inside the device vault ('content-at-rest-key', contentAtRest.js); the vault adds the prefix",
  vaultDelegationSeed: "a key inside the device vault ('device-delegation-seed', personaVault.js); the vault adds the prefix",
  vaultCustodyMode: "a key inside the device vault ('custody-mode', ownerRootCustody.js); the vault adds the prefix",
  tasksWeb: 'left by an earlier build (the web no longer persists tasks under it); kept so a start-over still removes it',
  nearbyMineSeenWeb: 'left by an earlier build (nothing reads it now); kept so an enrol and a start-over still remove it',
  nearbyMineSeenPhone: 'left by an earlier build (nothing reads it now); kept so an enrol still removes it',
});

/** Hand-written names rule 1 sees that are not a device-level storage name. */
/** Files whose raw writes go through a storage and a key their CALLER hands them: the rows, and who seals. */
export const WRITES_FOR_ITS_CALLER = Object.freeze({
  'apps/basis/src/household/persist.js': 'the persist adapter of every household-shaped store; sealedPersist wraps it in buildHouseholdDataSource when a strategy is given (lint-sealed-at-rest holds the shells to one)',
  'apps/basis/src/v2/circleRules.js': "circleRules ('sealed'): localCircleRulesStore hands the IO sealedKeyValue; the IO has no default storage",
  'apps/basis/src/v2/addressFallback.js': "fallbackOffer ('sealed'): both shells hand fallbackOfferStateIo sealedKeyValue",
  'apps/basis/src/v2/enrolForgets.js': "vaultOwnerRoot ('not sealable'): the plain marker vault (forget-pending beside restore-pending)",
  'apps/basis/src/v2/onboardingFlags.js': "the first-run flags ('not content'): helpCircleProvisioned, onboardingDone, mnemonicAck, keyCardSnoozedUntil, firstOpenSeen, introCardSeen",
  'apps/basis/src/v2/screenClient.js': "screenClient ('not sealable'): a screen's own storage",
  'apps/basis/src/v2/themePref.js': "theme ('not content')",
  'apps/basis/src/web/localStoragePeerBackend.js': "peerGraph ('sealed'): both shells hand the peer backend sealedKeyValue (strict)",
  'apps/basis-mobile/src/core/mappingsStoreRN.js': "mappings ('not sealable'): read before the content key",
});

export const SEAL_HEADS = Object.freeze(['not content:', 'not sealable:', 'unwritten:', 'debt:']);
const RAW_WRITE = /\.setItem\s*(\?\.)?\s*\(/;
const VIA_SEAL = /\b(?:kv|sealed)\??\.setItem\b|\bsealedIn\([^)]*\)\.setItem/;
const NAMED = /setItem\s*(?:\?\.)?\s*\(\s*`?\$?\{?storageName\('(\w+)'\)/;
const BY_CONST = /setItem\s*(?:\?\.)?\s*\(\s*`?\$?\{?([A-Za-z_][A-Za-z0-9_]*)/;
const CONST_DEF = /\b(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)\s*=>\s*)?`?\$?\{?storageName\('(\w+)'\)/g;

/** Rule 3 over a set of files `{rel: text}`: the problems. */
export function sealProblems(STORAGE, texts) {
  const problems = [];
  for (const [id, r] of Object.entries(STORAGE)) {
    const seal = r.seal;
    if (seal === 'sealed') continue;
    if (typeof seal !== 'string' || !SEAL_HEADS.some((h) => seal.startsWith(h)) || seal.length < 16) {
      problems.push(`${REGISTER}: row '${id}' has no seal ruling — 'sealed', or a reason under ${SEAL_HEADS.join(' · ')}`);
    } else if (seal.startsWith('debt:') && !/^debt: L\d+/.test(seal)) {
      problems.push(`${REGISTER}: row '${id}' is debt without its ledger row ('debt: L<n> …')`);
    }
  }
  // a const resolves in its own file, or in another file that EXPORTS it when this file imports that name
  const exported = new Map();
  for (const text of Object.values(texts)) {
    for (const m of text.matchAll(CONST_DEF)) if (m[0].startsWith('export')) exported.set(m[1], m[2]);
  }
  const callerFilesSeen = new Set();
  for (const [rel, text] of Object.entries(texts)) {
    const own = new Map([...text.matchAll(CONST_DEF)].map((m) => [m[1], m[2]]));
    const imported = (name) => new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text);
    const resolve = (name) => (name ? (own.get(name) ?? (imported(name) ? exported.get(name) : undefined)) : undefined);
    text.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l) || !RAW_WRITE.test(l) || VIA_SEAL.test(l)) return;
      if (WRITES_FOR_ITS_CALLER[rel]) { callerFilesSeen.add(rel); return; }   // the caller's storage decides
      const id = (l.match(NAMED) ?? [])[1] ?? resolve((l.match(BY_CONST) ?? [])[1]);
      if (!id) {
        problems.push(`${rel}:${i + 1} writes raw under a key that names no register row — take the key from the register, or seal the write`);
        return;
      }
      if (STORAGE[id]?.seal === 'sealed') problems.push(`${rel}:${i + 1} writes the row '${id}' raw, and the row is ruled 'sealed' — write it through sealedKeyValue`);
    });
  }
  for (const rel of Object.keys(WRITES_FOR_ITS_CALLER)) {
    if (!callerFilesSeen.has(rel)) problems.push(`WRITES_FOR_ITS_CALLER names '${rel}', which has no raw write by a handed key — remove the entry`);
  }
  return problems;
}

export const NOT_STORAGE = Object.freeze({
  'tools.on': "a key inside the box's own vault (toolboxes.js), not a name on a device's storage",
});

export function shellFiles(root = ROOT) {
  const out = [];
  const walk = (rel) => {
    let st; try { st = statSync(path.join(root, rel)); } catch { return; }
    if (st.isFile()) { if (/\.(m?js|jsx)$/.test(rel) && !/\.test\.|\.spec\./.test(rel)) out.push(rel); return; }
    for (const n of readdirSync(path.join(root, rel))) {
      if (n === 'node_modules' || n.startsWith('.') || n === 'test' || n === 'dist') continue;
      walk(`${rel}/${n}`);
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

const CALL = /\b(?:getItem|setItem|removeItem|pickWebBackend|sealedNamedBackend|makeBrowserVault)\s*\??\.?\s*\(\s*(?:(['"`])((?:(?!\1).)+)\1|([A-Z_][A-Z0-9_]*)\b)|\b(?:scope|dbName|prefix)\s*:\s*(?:(['"`])((?:(?!\4).)+)\4|([A-Z_][A-Z0-9_]*)\b)/g;

const STORE_BUILDER = /\b(?:createAsBackend|sealedLocalBackend|sealedNamedBackend|pickWebBackend|Vault[A-Za-z]*|createLocalStoragePeerBackend|buildHouseholdDataSource)\b/;

/** The hand-written storage names in one file's text: `[{ name, line }]`. */
export function handNamesIn(text) {
  const consts = new Map([...text.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`])((?:(?!\2).)+)\2/g)].map((m) => [m[1], m[3]]));
  const out = [];
  text.split('\n').forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    for (const m of l.matchAll(CALL)) {
      // `scope:` / `prefix:` are storage names only where a backend or a vault is built on the same line
      if ((m[4] || m[6]) && /\b(?:scope|prefix)\s*:/.test(m[0]) && !STORE_BUILDER.test(l)) continue;
      const name = m[2] ?? m[5] ?? consts.get(m[3] ?? m[6]);
      if (!name) continue;
      if (!/^[A-Za-z]/.test(name)) continue;             // starts with an interpolation (a name passed through) or a path
      out.push({ name, line: i + 1 });
    }
  });
  return out;
}

export async function check(root = ROOT) {
  const { STORAGE } = await import(pathToFileURL(path.join(root, REGISTER)).href);
  const problems = [];
  let all = '';
  for (const rel of shellFiles(root)) {
    if (rel === REGISTER) continue;
    const text = readFileSync(path.join(root, rel), 'utf8');
    all += text;
    for (const { name, line } of handNamesIn(text)) {
      if (NOT_STORAGE[name]) continue;
      problems.push(`${rel}:${line} names '${name}' by hand — take it from the register: storageName('<id>') (${REGISTER})`);
    }
  }
  // 1b: a key BUILT by hand from a prefix row's name (`cc.circlePolicy.${id}` in a key helper), wherever it is written
  const prefixes = Object.entries(STORAGE).filter(([, r]) => r.kind === 'prefix').map(([id, r]) => [id, r.name]);
  for (const rel of shellFiles(root)) {
    if (rel === REGISTER) continue;
    readFileSync(path.join(root, rel), 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      for (const [id, name] of prefixes) {
        if (l.includes('`' + name + '${')) problems.push(`${rel}:${i + 1} builds a '${name}' key by hand — use \`\${storageName('${id}')}\${…}\``);
      }
    });
  }
  for (const [id] of Object.entries(STORAGE)) {
    if (all.includes(`storageName('${id}')`)) continue;
    if (OPENED_ELSEWHERE[id]) continue;
    problems.push(`${REGISTER}: row '${id}' is opened by nothing — remove it, or say in OPENED_ELSEWHERE where it is opened`);
  }
  const texts = {};
  for (const rel of shellFiles(root)) if (rel !== REGISTER && !rel.endsWith('/localStoreSeal.js')) texts[rel] = readFileSync(path.join(root, rel), 'utf8');
  problems.push(...sealProblems(STORAGE, texts));
  for (const id of Object.keys(OPENED_ELSEWHERE)) {
    if (!STORAGE[id]) problems.push(`OPENED_ELSEWHERE names '${id}', which is not a register row — remove the entry`);
    else if (all.includes(`storageName('${id}')`)) problems.push(`OPENED_ELSEWHERE names '${id}', which is now opened by id — remove the entry`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = await check();
  if (problems.length) {
    console.error(`✖ storage-register: a storage name outside the register, or a row nothing opens:\n${problems.map((p) => `    ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ storage-register: every storage name from the register; every row opened (${Object.keys(OPENED_ELSEWHERE).length} elsewhere, each said where)`);
}
