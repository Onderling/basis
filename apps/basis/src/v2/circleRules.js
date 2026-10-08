/**
 * basis v2 — circle rules document (shared, boards 3B/3C).
 *
 * A circle's governance, captured as a short document across seven aspects
 * (purpose / admins / agreements / conflict / admission / leaving /
 * responsibility). The create flow fills it via SIX plain-language
 * questions (responsibility folds into "agreements", so it isn't asked
 * separately but stays a field), and the join flow shows the assembled
 * document as an Agree / Decline consent screen. This module is the pure
 * model: field list, the question set, normalisation, build-from-answers,
 * and a completeness check over the required fields.
 *
 * Additive: the standalone editor + consent renderers ship now; threading
 * this into the existing createGroup/joinGroup wizard state machines is a
 * follow-on so those shared wizards stay stable.
 */
import { localStorageObjectVersions } from '@onderling/kring-host/objectVersionsStorage';
import { sealedKeyValue } from './localStoreSeal.js';

/** The seven aspects stored in the rules document. */
export const RULES_FIELDS = [
  'purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility',
];

/**
 * The six questions asked at creation, in order. Each writes one field;
 * `responsibility` is folded into the agreements answer (not asked). Only
 * `purpose` + `agreements` are required so creating a circle stays quick.
 */
export const RULES_QUESTIONS = [
  { key: 'purpose',    required: true  },
  { key: 'admins',     required: false },
  { key: 'agreements', required: true  },
  { key: 'conflict',   required: false },
  { key: 'admission',  required: false },
  { key: 'leaving',    required: false },
];

/** An empty document — every field a string. */
export const DEFAULT_RULES_DOC = Object.fromEntries(RULES_FIELDS.map((k) => [k, '']));

/** Coerce a stored partial into a complete doc (every field a trimmed-tolerant string). */
export function normalizeRulesDoc(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of RULES_FIELDS) out[k] = typeof r[k] === 'string' ? r[k] : '';
  return out;
}

/** Build a doc from `answers` keyed by field (merges onto a normalized base). */
export function buildRulesDoc(answers = {}) {
  return normalizeRulesDoc({ ...DEFAULT_RULES_DOC, ...(answers && typeof answers === 'object' ? answers : {}) });
}

/** True when every REQUIRED question has a non-blank answer. */
export function isRulesComplete(doc) {
  const d = normalizeRulesDoc(doc);
  return RULES_QUESTIONS.filter((q) => q.required).every((q) => d[q.key].trim() !== '');
}

/** True when the whole document is blank (nothing to show a joiner). */
export function isRulesEmpty(doc) {
  const d = normalizeRulesDoc(doc);
  return RULES_FIELDS.every((k) => d[k].trim() === '');
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Storage adapter — γ.2 (Phase 9) introduces a store factory so version  */
/* capture has a single hook point for the rules blob (was inline         */
/* localStorage / AsyncStorage in the launcher up to β).                  */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Per-circle Rules document store.  Mirrors `createCirclePolicyStore`:
 * injectable `{load, save}` adapter so the host wires the storage tier
 * (localStorage on web, AsyncStorage on mobile, pod-io later).
 *
 * γ.2 — optional `versions` adapter snapshots each save into a per-
 * circle history slot.  Additive: legacy callers (no adapter) keep the
 * pre-γ.2 behaviour.
 *
 *   const store = createCircleRulesStore({ load, save });
 *   const doc   = await store.get(circleId);
 *   await store.update(circleId, { purpose: 'updated' });
 */
export function createCircleRulesStore({ load, save, versions } = {}) {
  return {
    async get(circleId) {
      let raw = null;
      try { raw = typeof load === 'function' ? await load(circleId) : null; }
      catch { raw = null; }
      return normalizeRulesDoc(raw);
    },
    async set(circleId, doc) {
      const next = normalizeRulesDoc(doc);
      if (versions && typeof versions.capture === 'function') {
        try { await versions.capture(circleId, next); } catch { /* best-effort */ }
      }
      if (typeof save === 'function') await save(circleId, next);
      return next;
    },
    /** Shallow-merge a field patch onto the current doc (every field a string). */
    async update(circleId, patch) {
      const current = await this.get(circleId);
      const next = normalizeRulesDoc({ ...current, ...(patch && typeof patch === 'object' ? patch : {}) });
      if (versions && typeof versions.capture === 'function') {
        try { await versions.capture(circleId, next); } catch { /* best-effort */ }
      }
      if (typeof save === 'function') await save(circleId, next);
      return next;
    },
    /** γ.2 — newest-first history; `[]` when no adapter or no history. */
    async listVersions(circleId) {
      if (!versions || typeof versions.list !== 'function') return [];
      try { return await versions.list(circleId); } catch { return []; }
    },
    /**
     * Restore the rules doc snapshotted at `ts` (a `ts` from `listVersions`).
     * The adapter only READS history; persisting goes through this store's
     * own `set` path (capture + save), so the restore is itself in history
     * (undoable). Returns the persisted doc, or `null` when no adapter /
     * no such snapshot.
     */
    async restoreVersion(circleId, ts) {
      if (!versions || typeof versions.restore !== 'function') return null;
      let restored = null;
      try { restored = await versions.restore(circleId, ts); } catch { restored = null; }
      if (restored == null) return null;
      return this.set(circleId, restored);
    },
  };
}

/** A device's own circle-rules store, SEALED at rest (the rules and their versions) — what the web shell composes. */
export function localCircleRulesStore(storage = globalThis.localStorage) {
  const sealed = sealedKeyValue(storage, { name: 'the circle rules' });
  return createCircleRulesStore({ ...localStorageRulesIo(sealed), versions: localStorageObjectVersions('rules', sealed) });
}

/** localStorage-backed load/save (web). Key: `cc.circleRules.<circleId>`. */
export function localStorageRulesIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circleRules.${id}`;
  return {
    load: async (id) => {
      try {
        const s = await storage?.getItem(key(id));   // awaited: a sealed storage answers async
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (id, doc) => {
      try { await storage?.setItem(key(id), JSON.stringify(doc)); } catch { /* quota / disabled / no content key yet */ }
    },
  };
}
