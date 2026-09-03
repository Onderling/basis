/**
 * In-memory `expo-file-system` stub for vitest-node.
 *
 * Same reason as the async-storage stub beside it: the real package's entry is not parseable by vite in
 * node (it reaches RN/TS-only syntax), so a module that merely IMPORTS it fails to collect — even when
 * the test injects its own `fs`. Aliasing the specifier here lets `attachmentBlobStoreRN.js` be loaded
 * and unit-tested against an injected fake, which is what its tests actually do.
 *
 * Deliberately minimal: the surface the attachment blob store uses, backed by a Map.
 */
const files = new Map();

export const documentDirectory = 'file:///stub-docs/';
export const EncodingType = { Base64: 'base64', UTF8: 'utf8' };

export async function makeDirectoryAsync() { /* directories are implicit in a Map */ }
export async function writeAsStringAsync(path, value) { files.set(String(path), String(value)); }
export async function readAsStringAsync(path) {
  const v = files.get(String(path));
  if (v === undefined) throw new Error(`ENOENT: ${path}`);
  return v;
}
export async function getInfoAsync(path) { return { exists: files.has(String(path)), uri: String(path) }; }
export async function deleteAsync(path) { files.delete(String(path)); }

/** Test seam: forget everything between suites. */
export function __reset() { files.clear(); }

export default {
  documentDirectory, EncodingType, makeDirectoryAsync,
  writeAsStringAsync, readAsStringAsync, getInfoAsync, deleteAsync, __reset,
};
