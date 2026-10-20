/**
 * Mobile file-save adapter for Bundle F.
 *
 * Wraps `expo-file-system` to write base64-encoded blobs to the
 * app's `documentDirectory`.  Used by `buttonSpecials.downloadFile`
 * when a list-item carries an inline `embed.snapshot.dataB64`.
 *
 * V1 caveats:
 *   - Saves to `documentDirectory` only (app-internal; user can
 *     access via a separate Files-app step on Android).  Share-sheet
 *     integration via `expo-sharing` is a follow-up.
 *   - Returns the saved URI so the caller can show it in the bot
 *     bubble (matches web's "saved as <name>" UX).
 *   - No name collision handling — overwrites silently.  Names
 *     include a timestamp suffix to make collisions unlikely.
 *
 * Why a dedicated module?  Keeps the expo-file-system import
 * narrow + makes the save semantics swappable when share-sheet
 * lands (caller stays the same).
 */
import * as FileSystem from 'expo-file-system';

/**
 * Sanitise + stamp a filename so saves don't collide.  Replaces
 * filesystem-unsafe chars with `_`; appends a `-YYYY-MM-DDTHH-MM-SS`
 * stamp before the extension.
 */
function stampedName(originalName) {
  const name = String(originalName ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}-${stamp}`;
  return `${name.slice(0, dot)}-${stamp}${name.slice(dot)}`;
}

/**
 * Save a base64 blob to the app's documentDirectory.
 *
 * @param {object} args
 * @param {string} args.dataB64    base64 (no `data:...;base64,` prefix)
 * @param {string} args.name       human-readable filename hint
 * @returns {Promise<{ok: true, uri: string, name: string} | {ok: false, error: string}>}
 */
export async function saveBase64File({ dataB64, name }) {
  if (!dataB64 || typeof dataB64 !== 'string') {
    return { ok: false, error: 'no data to save' };
  }
  if (!FileSystem?.documentDirectory) {
    return { ok: false, error: 'documentDirectory unavailable' };
  }
  const finalName = stampedName(name ?? 'download');
  const uri       = `${FileSystem.documentDirectory}${finalName}`;
  try {
    await FileSystem.writeAsStringAsync(uri, dataB64, {
      encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
    });
    return { ok: true, uri, name: finalName };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Save a file WHERE THE PERSON CHOOSES: Android's folder picker (the Storage Access Framework), then the file made
 * there with its name and type, then the bytes. The twin of web's Download link — the app-private directory above is
 * no answer for a file a person wants to keep or open, they cannot reach it. A closed picker is `not-chosen`; a
 * platform without the picker is `no-picker` (said, never thrown).
 *
 * @param {{dataB64: string, name?: string, mime?: string}} file
 * @param {{fs?: object}} [opts]  `fs`: expo-file-system (injectable for tests)
 * @returns {Promise<{ok: true, uri: string, name: string} | {ok: false, error: string}>}
 */
export async function saveFileToChosenPlace({ dataB64, name, mime } = {}, { fs = FileSystem } = {}) {
  if (!dataB64 || typeof dataB64 !== 'string') return { ok: false, error: 'no-data' };
  const saf = fs?.StorageAccessFramework;
  if (typeof saf?.requestDirectoryPermissionsAsync !== 'function' || typeof saf?.createFileAsync !== 'function') return { ok: false, error: 'no-picker' };
  const type = typeof mime === 'string' && mime ? mime : 'application/octet-stream';
  // the picker adds the extension its type names; a name keeps its own only when the type is unknown
  const raw = String(name ?? 'file').replace(/[\\/:*?"<>|]/g, '_');
  const dot = raw.lastIndexOf('.');
  const finalName = type !== 'application/octet-stream' && dot > 0 ? raw.slice(0, dot) : raw;
  try {
    const perm = await saf.requestDirectoryPermissionsAsync();
    if (!perm?.granted || !perm.directoryUri) return { ok: false, error: 'not-chosen' };
    const uri = await saf.createFileAsync(perm.directoryUri, finalName, type);
    await fs.writeAsStringAsync(uri, dataB64, { encoding: fs.EncodingType?.Base64 ?? 'base64' });
    return { ok: true, uri, name: finalName };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** The words for what a save answered: kept (and where), or why not; the person closing the picker says nothing. */
export function fileSaveWords(r) {
  if (r?.ok) return { key: 'circle.fileShare.saved', params: { name: r.name ?? '' } };
  if (r?.error === 'not-chosen') return null;
  return { key: 'circle.fileShare.save_failed', params: { error: r?.error ?? '' } };
}
