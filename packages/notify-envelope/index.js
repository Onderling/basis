/**
 * @onderling/notify-envelope — mediates persistent-content writes.
 *
 * Per-write mode picker (envelope-only vs full-payload + queue)
 * backed by pseudo-pod + pod-routing. Owns the pending-pod-upload
 * queue that powers graceful degradation.
 *
 * See:
 *   - `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md` §52.4
 *   - `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md` §4.4
 */

export { createNotifyEnvelope } from './src/NotifyEnvelope.js';
export { pickMode }             from './src/picker.js';
export { createPendingQueue, QUEUE_PREFIX } from './src/pendingQueue.js';
// the generic item-store substrate mirror (tasks + household share it).
export { wireItemMirror, defaultInferAction, stripIdentity } from './src/substrateMirror.js';
