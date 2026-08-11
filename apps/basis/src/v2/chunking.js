/**
 * chunking — the shared chunk discipline for peer transfers: how many items ride one message, and the
 * splitter that applies it. Extracted from the retired negotiated chat catch-up protocol when the
 * frontier replay (its replacement) turned out to need exactly these two things and nothing else.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** Items per transfer chunk — one message's worth on the peer wire. */
export const DEFAULT_CHUNK_SIZE = param({ key: 'catchup.chunkSize', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });

/**
 * Split a flat items array into chunks of `chunkSize`.
 * @param {Array} items
 * @param {number} [chunkSize]
 * @returns {Array<Array>}
 */
export function chunkItems(items, chunkSize = DEFAULT_CHUNK_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : DEFAULT_CHUNK_SIZE;
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
