/**
 * LiveSyncSkill — one-way sync from a source adapter to a target adapter.
 *
 * Locked Q-F.3 (2026-04-29):
 *   - One-way only in v1: source → target.  Migration use case
 *     (e.g. Google Docs → pod move).  The target is a destination, not a
 *     co-equal source.  Bidirectional sync is a v2 design conversation.
 *   - Per-record onConflict(local, remote) callback (matches A7's
 *     `'conflict'` event shape).  Streaming: fires once per conflict;
 *     caller resolves and sync continues.
 *   - Idempotent: re-running an already-synced event is a no-op.
 *   - State persisted via an injected Vault.
 *
 * ┌─ Source adapter shape (caller-supplied) ───────────────────────────────┐
 * │ async listChanges({ cursor, limit }) → { events: SyncEvent[], nextCursor } │
 * │ async fetchPayload(eventId) → bytes | object                           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Target adapter shape ─────────────────────────────────────────────────┐
 * │ async write(uri, content, opts) → { uri, etag?, lastModified? }        │
 * │ async read(uri)  → { content, etag?, lastModified? } | null            │
 * │ async exists(uri) → boolean                                            │
 * │ async delete?(uri) → void          // optional, for tombstone support  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * SyncEvent shape:
 *   {
 *     id:          string         // stable identifier — same id from same source = same event
 *     sourceUri:   string         // where the record came from
 *     targetUri:   string         // where it should go
 *     contentType: string
 *     payload?:    bytes|object   // optional, omit if it must be fetched separately
 *     deleted?:    boolean        // tombstone-like — propagate as a delete on target
 *     mtime:       number         // unix-ms; used for conflict resolution
 *   }
 *
 * Lifecycle:
 *   const sync = new LiveSyncSkill({ name, source, target, vault, onConflict, pollIntervalMs });
 *   sync.start();              // begins polling / listening
 *   await sync.runOnce();      // one-shot cycle
 *   sync.stop();
 *
 * Example sketch (Google Docs → Solid pod, see projects/03-import-bridge):
 *   const sync = new LiveSyncSkill({
 *     name: 'gdocs-import',
 *     source: gdocsAdapter,            // wraps OAuthVault + Drive API
 *     target: podAdapter,              // wraps PodClient
 *     vault: agent.identity.vault,
 *     onConflict: async (local, remote) => 'remote',  // pod wins
 *     pollIntervalMs: 5 * 60_000,
 *   });
 *   sync.start();
 */

const STATE_KEY_PREFIX = 'livesync:';
import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';
// Parameter register (#36) — applied-ids dedup cap (scope:device, kind:internal).
const APPLIED_IDS_CAP  = param({ key: 'liveSync.appliedIdsCap', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10_000 });

/**
 * One-way sync engine applying change events from a source adapter to a target
 * adapter. Idempotent per event id (applied ids are persisted, capped at 10k),
 * resolves write conflicts through the optional onConflict callback, stores
 * cursor state in an injected Vault, and polls on an interval between explicit
 * runOnce() cycles.
 */
export class LiveSyncSkill {
  #name;
  #source;
  #target;
  #vault;
  #onChange;
  #onConflict;
  #pollIntervalMs;
  #pollTimer = null;
  #running = false;
  #lastError = null;
  #stats = {
    eventsApplied: 0,
    eventsSkipped: 0,
    conflicts:     0,
    lastSyncedAt:  null,
  };
  #runOncePromise = null;

  /**
   * @param {object}   opts
   * @param {string}   opts.name              — stable identifier; namespaces state
   * @param {object}   opts.source            — adapter (see file head JSDoc)
   * @param {object}   opts.target            — adapter
   * @param {import('@onderling/vault').Vault} opts.vault — for state persistence
   * @param {(event) => Promise<void>} [opts.onChange]   — fired AFTER each successful apply (observability hook)
   * @param {(local, remote) => Promise<'local'|'remote'|object>} [opts.onConflict]
   * @param {number}   [opts.pollIntervalMs=60_000]
   */
  constructor({ name, source, target, vault, onChange, onConflict, pollIntervalMs = 60_000 } = {}) {
    if (!name)   throw new Error('LiveSyncSkill: name is required');
    if (!source) throw new Error('LiveSyncSkill: source is required');
    if (!target) throw new Error('LiveSyncSkill: target is required');
    if (!vault)  throw new Error('LiveSyncSkill: vault is required');

    this.#name           = name;
    this.#source         = source;
    this.#target         = target;
    this.#vault          = vault;
    this.#onChange       = onChange ?? (async () => {});
    this.#onConflict     = onConflict ?? null;
    this.#pollIntervalMs = pollIntervalMs;
  }

  get name()      { return this.#name; }
  get isRunning() { return this.#running; }
  get stats()     { return { ...this.#stats }; }
  get lastError() { return this.#lastError; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this.#running) return;
    this.#running = true;

    const tick = async () => {
      if (!this.#running) return;
      try {
        await this.runOnce();
      } catch (err) {
        this.#lastError = err;
      }
      if (this.#running) {
        this.#pollTimer = setTimeout(tick, this.#pollIntervalMs);
      }
    };

    void tick();
  }

  stop() {
    this.#running = false;
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    this.#pollTimer = null;
  }

  // ── One sync cycle ────────────────────────────────────────────────────────

  /**
   * Pulls a batch of changes from the source, applies each to the target.
   * Returns `{ applied, skipped, conflicts }`.  Safe to call concurrently
   * with `start()` — uses a lightweight in-flight guard so overlapping
   * calls coalesce.
   */
  async runOnce() {
    if (this.#runOncePromise) return this.#runOncePromise;
    this.#runOncePromise = this.#runOnceInner().finally(() => {
      this.#runOncePromise = null;
    });
    return this.#runOncePromise;
  }

  async #runOnceInner() {
    const state    = await this.#loadState();
    const cursor   = state.cursor ?? null;
    const seen     = new Set(state.appliedIds ?? []);   // for idempotency
    const { events = [], nextCursor } = await this.#source.listChanges({ cursor });

    let applied = 0, skipped = 0, conflicts = 0;

    for (const ev of events) {
      if (seen.has(ev.id)) {
        skipped++;
        continue;
      }
      try {
        await this.#applyEvent(ev);
        seen.add(ev.id);
        applied++;
        try {
          await this.#onChange({ ...ev, applied: true });
        } catch {
          // Observability hook errors are swallowed — they must not break sync.
        }
      } catch (err) {
        if (err?.code === 'LIVESYNC_CONFLICT_UNRESOLVED') conflicts++;
        // Don't break the loop on a single failure — continue with the rest.
        this.#lastError = err;
      }
    }

    // Persist updated cursor + applied ids (cap appliedIds to last 10k for sanity).
    const trimmed = [...seen].slice(-APPLIED_IDS_CAP);
    await this.#saveState({ cursor: nextCursor ?? cursor, appliedIds: trimmed });

    this.#stats.eventsApplied += applied;
    this.#stats.eventsSkipped += skipped;
    this.#stats.conflicts     += conflicts;
    this.#stats.lastSyncedAt   = Date.now();

    return { applied, skipped, conflicts };
  }

  async #applyEvent(ev) {
    if (ev.deleted) {
      // Tombstone propagation: write a delete to the target if it supports it.
      if (typeof this.#target.delete === 'function') {
        await this.#target.delete(ev.targetUri);
      }
      return;
    }

    const payload = ev.payload ?? await this.#source.fetchPayload(ev.id);

    const exists = typeof this.#target.exists === 'function'
      ? await this.#target.exists(ev.targetUri)
      : false;
    const remote = exists ? await this.#target.read(ev.targetUri) : null;

    if (remote) {
      // Conflict if the target's etag/lastModified differs from what we
      // last wrote (which we track by remembering ev.id in appliedIds).
      // Since we're 1-way and idempotent, the only time `remote` exists
      // and `ev.id` is NEW is "the user wrote to the pod independently".
      const localTuple  = {
        id:        ev.id,
        sourceUri: ev.sourceUri,
        content:   payload,
        mtime:     ev.mtime,
      };
      const remoteTuple = {
        uri:          ev.targetUri,
        content:      remote.content,
        etag:         remote.etag,
        lastModified: remote.lastModified,
      };

      if (this.#onConflict) {
        let resolution;
        try {
          resolution = await this.#onConflict(localTuple, remoteTuple);
        } catch (err) {
          throw Object.assign(
            new Error(`LiveSyncSkill: onConflict threw: ${err.message}`),
            { code: 'LIVESYNC_CONFLICT_HANDLER_THREW', cause: err },
          );
        }
        if (resolution === 'remote') return;                              // skip
        if (resolution === 'local') {
          await this.#target.write(ev.targetUri, payload, {
            contentType: ev.contentType,
            force:       true,
          });
          return;
        }
        if (resolution && typeof resolution === 'object' && 'content' in resolution) {
          await this.#target.write(ev.targetUri, resolution.content, {
            contentType: resolution.contentType ?? ev.contentType,
            force:       true,
          });
          return;
        }
        throw Object.assign(
          new Error('LiveSyncSkill: onConflict returned unrecognized resolution'),
          { code: 'LIVESYNC_CONFLICT_BAD_RESOLUTION' },
        );
      }
      throw Object.assign(
        new Error(`LiveSyncSkill: target ${ev.targetUri} already exists and no onConflict handler is registered`),
        { code: 'LIVESYNC_CONFLICT_UNRESOLVED' },
      );
    }

    await this.#target.write(ev.targetUri, payload, { contentType: ev.contentType });
  }

  // ── State persistence ─────────────────────────────────────────────────────

  async #loadState() {
    const raw = await this.#vault.get(this.#stateKey());
    return raw ? JSON.parse(raw) : { cursor: null, appliedIds: [] };
  }

  async #saveState(state) {
    await this.#vault.set(this.#stateKey(), JSON.stringify(state));
  }

  #stateKey() {
    return `${STATE_KEY_PREFIX}${this.#name}`;
  }
}
