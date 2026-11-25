/**
 * versionedDoc — how this package reads ONE versioned document from a store row (the outbox, the inbound record), so
 * a copy it cannot read is never taken for an empty one.
 *
 * Both documents carry `v: 1` since they were first written. Read as "anything I do not understand is empty", a copy
 * written by a newer build — or torn by a crash — became an empty queue, and the next save wrote that over it. Here:
 * nothing stored → empty and readable; bytes that do not parse, a non-object, a missing or different `v`, or a body
 * that fails the caller's shape check → NOT READABLE, with the reason (`unparseable` · `shape` · `version`). The caller
 * then saves nothing over it, and says so through its `onNotReadable` (the device's one notice; the shell hands in
 * local-store's `reportNotReadable`).
 */

/**
 * @param {unknown} raw   what the store returned: text, `{content}`, or null when nothing is stored
 * @param {object} opts
 * @param {number} opts.v                      the format this build writes and reads
 * @param {(doc: object) => boolean} [opts.valid]  the body's shape
 * @returns {{ doc: object|null, notReadable: null|'unparseable'|'shape'|'version' }}
 */
export function readVersionedDoc(raw, { v, valid = () => true }) {
  const text = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? raw.content ?? null : null);
  if (text == null || text === '') return { doc: null, notReadable: null };
  let parsed;
  try { parsed = typeof text === 'string' ? JSON.parse(text) : text; } catch { return { doc: null, notReadable: 'unparseable' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { doc: null, notReadable: 'shape' };
  if (parsed.v !== v) return { doc: null, notReadable: Object.prototype.hasOwnProperty.call(parsed, 'v') ? 'version' : 'shape' };
  if (!valid(parsed)) return { doc: null, notReadable: 'shape' };
  return { doc: parsed, notReadable: null };
}
