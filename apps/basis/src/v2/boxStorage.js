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
  const io = backendSnapshotIo(sealedLocalBackend(fileStorageBackend(dir)));
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
/** What says this data folder has held a running box (any one of them): a missing vault file beside it is a loss. */
const BOX_STATE_MARKS = Object.freeze(['vault.json', 'chat-vault.json', 'registry', 'agent-vaults', 'device-log', 'device-log.json', 'household-items.json', 'settings.json', 'circle-policy.json', 'bot-threads.json']);

/**
 * A vault file that is MISSING while the data folder holds other state is a failure, not a first start (L1115): a
 * partly restored backup or an unmounted folder would otherwise read as "nothing stored" and mint new keys over a
 * household. A folder with none of the marks is a first start. Pure over `exists`, so a test needs no disk.
 * @param {string} dataDir @param {(p: string) => boolean} exists
 * @returns {string[]} the vault files that are missing beside other state (empty: go on)
 */
export function vaultFilesMissing(dataDir, exists) {
  const held = BOX_STATE_MARKS.some((m) => exists(path.join(dataDir, m)));
  return held ? BOX_VAULT_FILES.filter((f) => !exists(path.join(dataDir, f))) : [];
}

/**
 * After this many failed starts in a row the box STOPS TRYING (L1115): it says so once, with what to do, and stays up
 * without running, so its container does not restart it in a loop. A person fixes the files (or restores) and restarts
 * the container; the next start that comes up clears the count.
 */
export const BOX_START_FAILURES_BEFORE_HOLD = param({ key: 'box.startFailuresBeforeHold', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });

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
    /** One more failed start: `{count, since}`. */
    note(what, now = new Date()) {
      const cur = read();
      const next = { count: (cur?.count ?? 0) + 1, since: cur?.since ?? now.toISOString(), last: what };
      try { writeFileSync(file, JSON.stringify(next), { mode: 0o600 }); } catch { /* said in the log either way */ }
      return next;
    },
    /** The box came up: the run of failures ends. */
    clear() { try { rmSync(file, { force: true }); } catch { /* nothing to clear */ } },
    read,
  };
}
