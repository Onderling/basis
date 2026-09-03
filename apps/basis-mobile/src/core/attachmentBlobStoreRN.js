/**
 * The attachment blob store, mobile side — the filesystem, deliberately NOT AsyncStorage.
 *
 * Web's twin (`apps/basis/src/v2/attachmentBlobStore.js`) explains the rule: a snapshot holds pointers,
 * never bytes. Mobile has a second reason to keep the payload out of AsyncStorage entirely, and it is
 * worth stating because it rules out the obvious fix. AsyncStorage on Android is SQLite, and a value is
 * read back through a cursor window of roughly 2 MB. Giving each file its OWN key does not help: one
 * 4 MB photo is still one oversized row, unreadable, and its failure is silent — the loader catches and
 * returns empty. The database also defaults to 6 MB in total. So bytes go to the filesystem, where a
 * photo is an ordinary file, and AsyncStorage keeps only the thread's small snapshot.
 *
 * `expo-file-system` is already a dependency (`fileSave.js` writes base64 blobs with it), so this adds
 * no native surface — only a narrow, swappable module, the same shape web's has:
 *   put(id, dataB64) · get(id)
 */
import * as FileSystem from 'expo-file-system';

const DIR_NAME = 'attachments';

/** `<documentDirectory>/attachments/` — created on first use, ignored if it already exists. */
function dirFor(fs) {
  const base = fs.documentDirectory;
  return base ? `${base}${DIR_NAME}/` : null;
}

/**
 * A file id is a key, not a path. Separators go first, so nothing can point outside the directory; then
 * any run of dots collapses, so no name is `.`/`..` or leans on them. The result is always a flat name.
 */
function safeName(id) {
  return String(id ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .slice(0, 120);
}

/**
 * The mobile attachment blob store.
 *
 * @param {object} [a]
 * @param {object} [a.fs]  injected for tests; defaults to expo-file-system
 * @returns {{put: Function, get: Function}} — never throws at the caller; a failure costs the bytes,
 *   never the message.
 */
export function createAttachmentBlobStoreRN({ fs = FileSystem } = {}) {
  const dir = dirFor(fs);
  if (!dir) return { put: async () => {}, get: async () => null };
  let ready = null;
  const ensureDir = () => (ready ??= fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {}));
  const pathFor = (id) => `${dir}${safeName(id)}`;
  const encoding = fs.EncodingType?.Base64 ?? 'base64';

  return {
    async put(id, dataB64) {
      if (!id || typeof dataB64 !== 'string' || !dataB64) return;
      try {
        await ensureDir();
        await fs.writeAsStringAsync(pathFor(id), dataB64, { encoding });
      } catch { /* the turn persists regardless; the card renders from its description */ }
    },
    async get(id) {
      if (!id) return null;
      try {
        const info = await fs.getInfoAsync(pathFor(id));
        if (!info?.exists) return null;
        return await fs.readAsStringAsync(pathFor(id), { encoding });
      } catch { return null; }
    },
  };
}
