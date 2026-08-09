/**
 * StateManager — runtime registries for tasks, streams, and sessions.
 *
 * Lives on the Agent instance. Shared between protocol handlers.
 *
 * Task registry: tracks outbound and inbound tasks by taskId.
 * Stream registry: tracks open ST/SE streams (streamId → chunk buffer + key).
 * Session registry: tracks bidirectional native sessions (Group D+).
 */
import { Task } from '../protocol/Task.js';

import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

// Parameter register (#36) — task/stream state lifetimes (scope:device, kind:internal).
const TASK_TTL_MS   = param({ key: 'stateManager.taskTtlMs',   scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * 60 * 1_000 });   // 30 min
const STREAM_TTL_MS = param({ key: 'stateManager.streamTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1_000 });   // 10 min

/**
 * Runtime registries for in-flight tasks, streams, and sessions, shared by the
 * protocol handlers on an Agent. Entries carry TTLs (30 min for tasks, 10 min for
 * streams and sessions); task creation sweeps all three registries, and task and
 * stream lookups also expire lazily.
 */
export class StateManager {
  /** @type {Map<string, { task: Task, expiresAt: number }>} */
  #tasks   = new Map();
  /** @type {Map<string, { chunks: Array, sessionKey: Uint8Array|null, taskId: string, peerId: string, expiresAt: number }>} */
  #streams = new Map();
  /** @type {Map<string, { state: string, peerId: string, expiresAt: number }>} */
  #sessions = new Map();

  // ── Task registry ─────────────────────────────────────────────────────────

  /**
   * Store a Task so protocol handlers can find it by taskId.
   * @param {string} taskId
   * @param {Task}   task
   */
  createTask(taskId, task) {
    this.#cleanup();
    this.#tasks.set(taskId, { task, expiresAt: Date.now() + TASK_TTL_MS });
    return task;
  }

  /** @returns {Task|null} */
  getTask(taskId) {
    const entry = this.#tasks.get(taskId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) { this.#tasks.delete(taskId); return null; }
    return entry.task;
  }

  deleteTask(taskId) { this.#tasks.delete(taskId); }

  // ── Stream registry ───────────────────────────────────────────────────────

  /**
   * Open a new stream slot.
   * @param {string} streamId
   * @param {object} opts
   * @param {string}      opts.taskId
   * @param {string}      opts.peerId
   * @param {Uint8Array}  [opts.sessionKey] — nacl.secretbox key; null = use nacl.box
   */
  openStream(streamId, opts) {
    this.#streams.set(streamId, {
      chunks:     [],
      sessionKey: opts.sessionKey ?? null,
      taskId:     opts.taskId,
      peerId:     opts.peerId,
      expiresAt:  Date.now() + STREAM_TTL_MS,
    });
  }

  getStream(streamId) {
    const entry = this.#streams.get(streamId);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) { this.#streams.delete(streamId); return null; }
    return entry;
  }

  closeStream(streamId) { this.#streams.delete(streamId); }

  // ── Session registry ──────────────────────────────────────────────────────

  openSession(sessionId, opts) {
    this.#sessions.set(sessionId, {
      state:     opts.state ?? 'open',
      peerId:    opts.peerId,
      expiresAt: Date.now() + STREAM_TTL_MS,
    });
  }

  getSession(sessionId) { return this.#sessions.get(sessionId) ?? null; }

  closeSession(sessionId) { this.#sessions.delete(sessionId); }

  // ── Private ───────────────────────────────────────────────────────────────

  #cleanup() {
    const now = Date.now();
    for (const [id, e] of this.#tasks)   { if (e.expiresAt < now) this.#tasks.delete(id); }
    for (const [id, e] of this.#streams) { if (e.expiresAt < now) this.#streams.delete(id); }
    for (const [id, e] of this.#sessions){ if (e.expiresAt < now) this.#sessions.delete(id); }
  }
}
