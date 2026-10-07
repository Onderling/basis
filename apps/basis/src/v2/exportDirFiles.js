/**
 * The exports dir on a box's disk, as the export shelf and the export request see it: list · write · read · remove.
 * Written whole or not at all (a crash mid-write leaves a temp file, never a cut-off export under its own name), owner
 * read/write only. Shared by the runner and `bin/export-now.mjs`, so both speak to the same files the same way.
 */
import { readdirSync, mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export function exportDirFiles(exportsDir) {
  return {
    list: async () => { try { return readdirSync(exportsDir); } catch { return []; } },
    write: async (name, text) => {
      mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
      const tmp = path.join(exportsDir, `.${name}.tmp`);
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, path.join(exportsDir, name));
    },
    read: async (name) => readFileSync(path.join(exportsDir, name), 'utf8'),
    remove: async (name) => rmSync(path.join(exportsDir, name), { force: true }),
  };
}
