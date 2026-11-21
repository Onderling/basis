/**
 * boxStorage — where the box keeps what the painting shells keep in IndexedDB / AsyncStorage, sealed the same way.
 *
 * The box (`bin/device-runner.mjs`) has no browser storage: its stores are files under the data dir. The item stores
 * were sealed at rest from the start (`sealedPersist`), but three files were not — the device log (every lane's
 * record, and from the bot's threads on, the conversations), the circle policy, and the contact DM state were
 * written as plain JSON. Web seals its device log through `sealedLocalBackend`; the box hydrated its own copy before
 * the agent booted, with no key to open a sealed one, so it could only have been plain. Now the box composes it the
 * way web does: a backend, sealed by the shell's content key, handed to the agent, which hydrates it the moment the
 * key exists (web ≡ box, by one construction).
 *
 * What stays legible, as on every shell: the KEYS (file names here — a segment number, a policy's circle id). The
 * words never are.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildHouseholdDataSource } from '../household/persist.js';
import { backendSnapshotIo, fileKeyValueStorage } from './eventLogPersistence.js';
import { sealedLocalBackend, sealedKeyValue, shellContentSeal } from './localStoreSeal.js';
import { sealedPolicyHeadStore } from './policyUpdateLane.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/**
 * A `StorageBackend` over a directory: one file per key (the key, URI-encoded, is the file name), each write
 * atomic (temp file + rename), mode 0600. The shape `createSealingBackend` wraps: `get → {bytes, etag, _v}|null`,
 * `put(key, bytes, etag, _v)`, `delete`, `list(prefix)`.
 * @param {string} dir
 */
export function fileStorageBackend(dir) {
  const fileOf = (key) => path.join(dir, encodeURIComponent(key));
  const ensure = () => { try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* it usually exists */ } };
  return {
    async get(key) {
      let raw;
      try { raw = readFileSync(fileOf(key), 'utf8'); } catch (err) { if (err?.code === 'ENOENT') return null; throw err; }
      const rec = JSON.parse(raw);
      const bytes = rec.b64 != null ? new Uint8Array(Buffer.from(rec.b64, 'base64')) : rec.bytes;
      return { bytes, ...(rec.etag != null ? { etag: rec.etag } : {}), ...(rec._v != null ? { _v: rec._v } : {}) };
    },
    async put(key, bytes, etag, _v) {
      ensure();
      const rec = bytes instanceof Uint8Array ? { b64: Buffer.from(bytes).toString('base64') } : { bytes };
      if (etag != null) rec.etag = etag;
      if (_v != null) rec._v = _v;
      const file = fileOf(key);
      writeFileSync(`${file}.tmp`, JSON.stringify(rec), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
    async delete(key) { rmSync(fileOf(key), { force: true }); },
    async list(prefix = '') {
      let names;
      try { names = readdirSync(dir); } catch (err) { if (err?.code === 'ENOENT') return []; throw err; }
      return names.filter((n) => !n.endsWith('.tmp')).map((n) => decodeURIComponent(n)).filter((k) => k.startsWith(prefix));
    },
  };
}

/**
 * The box's device-log storage: a directory, sealed by the shell's content key — the same composition web uses
 * (`backendSnapshotIo(sealedLocalBackend(…))`). Hand it to the agent as `deviceLogIo`; do not hydrate it yourself.
 * @param {string} dir
 */
export function boxDeviceLogIo(dir, { legacyFile = null } = {}) {
  // the refusal marks by the folder; the name sealed into each row is the device log's own, as on web and phone, so a
  // data folder restored elsewhere still opens
  const io = backendSnapshotIo(sealedLocalBackend(fileStorageBackend(dir), { scope: dir, name: 'cc-device-log' }));
  if (!legacyFile) return io;
  // THE ONE-TIME IMPORT of the plain `device-log.json` a box kept before this: the device log is the record its
  // lanes and memberships ride, and a box that came up without it would return to its circles as if it had never
  // been in them. Read once when the sealed store is empty, written back SEALED at once (a quiet box may not append
  // for hours), and only then removed — a crash in between leaves the plain file to import again.
  return {
    async load() {
      const sealed = await io.load();
      if (sealed != null) return sealed;
      let legacy;
      try { legacy = JSON.parse(readFileSync(legacyFile, 'utf8')); } catch { return null; }
      if (!Array.isArray(legacy)) return null;
      await io.save(legacy);
      rmSync(legacyFile, { force: true });
      return legacy;
    },
    save: (events) => io.save(events),
  };
}

/**
 * A key-value file whose VALUES are sealed by the shell's content key (keys stay legible). Reads open a sealed value
 * and pass a plain one through (no migration, as everywhere). A write before the key exists is refused rather than
 * stored in the clear — nothing on the box writes these before boot.
 * @param {string} filePath
 */
export function sealedFileKeyValue(filePath) {
  return sealedKeyValue(fileKeyValueStorage(filePath), { name: path.basename(filePath) });
}

/**
 * The box's stores that are not item stores, composed ONCE — `bin/device-runner.mjs` uses exactly this, and so does
 * the at-rest test, so the test crosses the shell's own composition rather than a copy of it.
 * @param {string} dataDir
 */
export function boxStores(dataDir) {
  const paths = {
    deviceLog:    path.join(dataDir, 'device-log'),          // a directory: the manifest and its segments
    contactDm:    path.join(dataDir, 'contact-dm.json'),
    circlePolicy: path.join(dataDir, 'circle-policy.json'),
    botThreads:   path.join(dataDir, 'bot-threads.json'),
    botAdmission: path.join(dataDir, 'bot-admission.json'),
    botCircles:   path.join(dataDir, 'bot-circles.json'),
    ownDevices:   path.join(dataDir, 'own-devices.json'),
  };
  return {
    paths,
    // Handed to the agent, which hydrates it once the content key exists — never hydrated here.
    deviceLogIo:    boxDeviceLogIo(paths.deviceLog, { legacyFile: path.join(dataDir, 'device-log.json') }),
    circlePolicyKv: sealedFileKeyValue(paths.circlePolicy),
    // the policy heads in the same file, through the shells' own store: strict, resealed at the start (web ≡ phone)
    policyHeadStore: sealedPolicyHeadStore(fileKeyValueStorage(paths.circlePolicy)),
    // Built after the agent booted (the key exists), like every other content store.
    contactDmSource: () => buildHouseholdDataSource({ path: paths.contactDm }, { strategy: shellContentSeal() }),
    // The door's thread rows (memory mode, language, a pending ask) — the turns themselves are on the device log.
    botThreadsSource: () => buildHouseholdDataSource({ path: paths.botThreads }, { strategy: shellContentSeal() }),
    // Who may start talking to the door: the open cohort and the hashes of spent codes (never a code).
    botAdmissionSource: () => buildHouseholdDataSource({ path: paths.botAdmission }, { strategy: shellContentSeal() }),
    // The circles a household bot joined on its admin's word (`/kring`): their ids and names, when, on whose word.
    botCirclesSource: () => buildHouseholdDataSource({ path: paths.botCircles }, { strategy: shellContentSeal() }),
    // The host's own typed items (the own-devices store): the bot's planned work and that of the people it is the
    // device for — never a circle's.
    ownDevicesSource: () => buildHouseholdDataSource({ path: paths.ownDevices }, { strategy: shellContentSeal() }),
  };
}

/** The box's two vault files: the owner root's side and the chat side (the content key, the delegation record). */
export const BOX_VAULT_FILES = Object.freeze(['vault.json', 'chat-vault.json']);
/** Written LAST in a start that came up (`device-runner: up`): the one proof that this data folder ran a box before. */
export const BOX_STARTED_FILE = 'box-started';

/**
 * A vault file that is MISSING in a data folder that ran a box before (its `box-started`, written last at a start that
 * came up) is a loss, not a first start (L1115): a partly restored backup would otherwise read as "nothing stored" and
 * mint new keys over a household. Without the mark it is a first start, also one that was cut short half-way (it goes
 * on). NOT caught: an unmounted data folder (an empty mount point carries no mark and reads as a first start). Pure over
 * `exists` and `list`, so a test needs no disk.
 *
 * A folder WITHOUT the mark also ran a box when its registry holds a row: every box that ran before the mark existed
 * has none, and its first start after the upgrade would otherwise mint a missing vault (the very loss). The registry
 * row is the sign because a start writes it AFTER both vault files (the boot order: the vaults are made while the
 * agent's keys are minted, the agent's own registry record when the agent is composed, then `box-started`). So a
 * start cut short before the registry row left no sign (it goes on), and one cut short after it already wrote both
 * vault files (nothing is missing: it goes on). Not the device log: a first start that came up may not have written
 * it yet.
 * @param {string} dataDir @param {(p: string) => boolean} exists
 * @param {(dir: string) => string[]} [list]  a folder's entry names ([] when there is none)
 * @returns {string[]} the vault files that are missing in a folder that ran a box (empty: go on)
 */
export function vaultFilesMissing(dataDir, exists, list = () => []) {
  if (!folderRanABox(dataDir, exists, list)) return [];
  return BOX_VAULT_FILES.filter((f) => !exists(path.join(dataDir, f)));
}

/** The box's registry folder (the agent registry, one file per row). */
export const BOX_REGISTRY_DIR = 'registry';

/** Whether this data folder ran a box before: its mark, or (a box from before the mark) a registry that holds a row. */
function folderRanABox(dataDir, exists, list) {
  if (exists(path.join(dataDir, BOX_STARTED_FILE))) return true;
  let rows = [];
  try { rows = list(path.join(dataDir, BOX_REGISTRY_DIR)) ?? []; } catch { rows = []; }
  return rows.some((n) => typeof n === 'string' && n.endsWith('.json'));
}

/** The mark a start that came up leaves (idempotent). */
export function markBoxStarted(dataDir) {
  try { writeFileSync(path.join(dataDir, BOX_STARTED_FILE), new Date().toISOString(), { mode: 0o600 }); } catch { /* the next start writes it */ }
}

/**
 * A box that cannot read its keys at a start backs off before it exits for the container's restart, so a cause that
 * passes by itself (a slow mount, a storage hiccup) is retried in minutes, then hours, never in a tight loop (L1115).
 * Only a key that fails to DECRYPT, after this many failed starts within the window, HOLDS the box until a person acts:
 * that cause cannot pass by itself.
 */
export const BOX_START_FAILURES_BEFORE_HOLD = param({ key: 'box.startFailuresBeforeHold', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
/** Failures further apart than this start a new run (the count begins again). */
export const BOX_START_FAILURE_WINDOW_MS = param({ key: 'box.startFailureWindowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 6 * 60 * 60_000 });
/** The longest back-off before a failed start exits. */
export const BOX_START_BACKOFF_MAX_MS = param({ key: 'box.startBackoffMaxMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2 * 60 * 60_000 });

/** How long the Nth failed start in a run waits before it exits: 1, 2, 4 … minutes, at most `BOX_START_BACKOFF_MAX_MS`. */
export function startBackoffMs(count) {
  return Math.min(Number(BOX_START_BACKOFF_MAX_MS), 60_000 * 2 ** Math.max(0, Number(count) - 1));
}

/** Whether a start's failure cannot pass by itself: a key that is there but fails to decrypt (not a storage error, not a missing file). */
export function failureIsPermanent(err) {
  for (let e = err, i = 0; e && i < 6; e = e.cause, i += 1) {
    if (/decrypt|secretbox|authenticat|bad tag|wrong key/i.test(String(e?.message ?? ''))) return true;
  }
  return false;
}

/**
 * THE STARTS IN A ROW THAT COULD NOT READ THE BOX'S KEYS (L1115): the container restarts a box that stops, so one line
 * per start would scroll past unseen. A small file counts them, with the first one's time, and every failed start
 * says the count; a start that comes up clears it.
 * @param {string} dataDir
 */
export function startFailures(dataDir) {
  const file = path.join(dataDir, 'start-failures.json');
  const read = () => { try { const v = JSON.parse(readFileSync(file, 'utf8')); return v && typeof v.count === 'number' ? v : null; } catch { return null; } };
  return {
    /** One more failed start: `{count, since}`. A failure further from the last than the window starts a new run. */
    note(what, now = new Date()) {
      const prev = read();
      const fresh = !prev || !prev.at || (now.getTime() - Date.parse(prev.at)) > Number(BOX_START_FAILURE_WINDOW_MS);
      const cur = fresh ? null : prev;
      const next = { count: (cur?.count ?? 0) + 1, since: cur?.since ?? now.toISOString(), last: what, at: now.toISOString() };
      try { writeFileSync(file, JSON.stringify(next), { mode: 0o600 }); } catch { /* said in the log either way */ }
      return next;
    },
    /** The box came up: the run of failures ends. */
    clear() { try { rmSync(file, { force: true }); } catch { /* nothing to clear */ } },
    read,
  };
}
