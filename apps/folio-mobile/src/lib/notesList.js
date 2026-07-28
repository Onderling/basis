/**
 * notesList — pure helpers for listing files in the engine's localRoot.
 *
 * Walks `<localRoot>` (recursively) using the engine's `fs` adapter,
 * skipping dotted entries (`.folio/`, `.onderling/`).  Returns a flat
 * array of `{ relPath, name, mtime, size }` sorted by mtime DESC.
 *
 * Living under `lib/` (not `screens/`) so unit tests can exercise it
 * without rendering a screen.
 */

/**
 * @typedef {object} ListedFile
 * @property {string} relPath
 * @property {string} name
 * @property {string} absPath
 * @property {number} mtime
 * @property {number} size
 */

/**
 * @param {object} args
 * @param {object} args.fs              An FsAdapter (engine.fs)
 * @param {string} args.localRoot       Absolute root (file:// URI on RN)
 * @param {(rel: string) => boolean} [args.filter]
 *   Optional filter — return true to include.  Default: skip
 *   `.`-prefixed top-level dirs (`.folio`, `.onderling`) and any path
 *   segment starting with `.`.
 * @returns {Promise<ListedFile[]>}
 */
export async function listLocalFiles({ fs, localRoot, filter = defaultFilter }) {
  if (!fs)        throw new Error('listLocalFiles: fs required');
  if (!localRoot) throw new Error('listLocalFiles: localRoot required');

  /** @type {ListedFile[]} */
  const out = [];

  /**
   * @param {string} dirAbs
   * @param {string} prefixRel  POSIX relative path of `dirAbs` (no
   *                            leading slash; `''` for the root itself)
   */
  async function walk(dirAbs, prefixRel) {
    let entries;
    try {
      entries = await fs.readdir(dirAbs);
    } catch (err) {
      if (err?.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      // The adapter returns string filenames by default; in node mode
      // it's the same.  We do a stat to disambiguate file vs dir.
      const name = typeof entry === 'string' ? entry : entry.name;
      if (!name) continue;
      const childRel = prefixRel ? `${prefixRel}/${name}` : name;
      if (!filter(childRel)) continue;
      const childAbs = joinAbs(dirAbs, name);
      let st;
      try {
        st = await fs.stat(childAbs);
      } catch (err) {
        if (err?.code === 'ENOENT') continue;
        throw err;
      }
      if (typeof st.isDirectory === 'function' ? st.isDirectory() : st.isDir) {
        await walk(childAbs, childRel);
      } else {
        out.push({
          relPath: childRel,
          name,
          absPath: childAbs,
          mtime:   typeof st.mtimeMs === 'number' ? st.mtimeMs : 0,
          size:    typeof st.size    === 'number' ? st.size    : 0,
        });
      }
    }
  }

  await walk(localRoot, '');
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export function defaultFilter(relPath) {
  for (const seg of relPath.split('/')) {
    if (seg.startsWith('.')) return false;
  }
  return true;
}

function joinAbs(dir, name) {
  // Adapter expects POSIX-ish paths; both Node and expo-file-system
  // accept '/' separators.
  if (dir.endsWith('/')) return `${dir}${name}`;
  return `${dir}/${name}`;
}
