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
import { buildHouseholdDataSource } from '@onderling-app/household';
import { backendSnapshotIo, fileKeyValueStorage } from './eventLogPersistence.js';
import { sealedLocalBackend, shellContentSeal } from './localStoreSeal.js';

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
  const kv = fileKeyValueStorage(filePath);
  const strategy = () => {
    const s = shellContentSeal();
    if (!s) throw new Error(`sealedFileKeyValue: refusing to write ${path.basename(filePath)} unsealed — no content key yet`);
    return s;
  };
  return {
    async getItem(key) {
      const v = await kv.getItem(key);
      if (v == null) return null;
      const s = shellContentSeal();
      return s ? s.open(v) : v;
    },
    async setItem(key, value) { await kv.setItem(key, strategy().seal(String(value))); },
    async removeItem(key) { await kv.removeItem(key); },
  };
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
  };
}
