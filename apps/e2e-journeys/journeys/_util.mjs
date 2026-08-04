// Shared helpers for the e2e journey modules.
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A tiny result collector: check(name, cond, detail) → pushes {name, ok, detail}. */
export function checker() {
  const results = [];
  return {
    results,
    check(name, cond, detail = '') {
      results.push({ name, ok: !!cond, detail });
      return !!cond;
    },
  };
}

// ── The twin-reachability rule (the homes plan, Part IV) ─────────────────────────────────────────────
// A twin journey must derive its entry points FROM THE MANIFEST, never invoke an op the manifest does
// not declare — otherwise the twin can prove something works that no user can reach (the inert-seam
// problem, one level up). `declaredOp` is the gate: it loads the app's manifest, asserts the op is
// declared, and only then hands the id back for invocation.
//
// Named consumer (DONE = reached): the mute journey (wave-1 batch 3) is the first caller; every new
// journey adopts it. Existing journeys migrate as they are touched — the conservation rule applies.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const _manifestCache = new Map();

/** Collect declared op ids from the common manifest shapes (ops array/object · builtins · flows). */
function _opIds(manifest) {
  const ids = new Set();
  const add = (v) => { if (typeof v === 'string' && v) ids.add(v); };
  const walk = (ops) => {
    if (!ops) return;
    if (Array.isArray(ops)) for (const o of ops) add(o?.id ?? o?.opId ?? (typeof o === 'string' ? o : null));
    else if (typeof ops === 'object') for (const [k, v] of Object.entries(ops)) { add(v?.id ?? v?.opId ?? k); }
  };
  walk(manifest?.operations); walk(manifest?.ops); walk(manifest?.builtins); walk(manifest?.flows);
  return ids;
}

/**
 * Assert `opId` is DECLARED by `<app>`'s manifest; returns the id for invocation.
 * @param {string} app   app dir name under apps/ (e.g. 'basis', 'tasks-v0')
 * @param {string} opId
 */
export async function declaredOp(app, opId) {
  if (!_manifestCache.has(app)) {
    const file = path.resolve(new URL('.', import.meta.url).pathname, `../../${app}/manifest.js`);
    const mod = await import(pathToFileURL(file).href);
    _manifestCache.set(app, mod.default ?? mod[Object.keys(mod).find((k) => /manifest/i.test(k))] ?? mod);
  }
  const manifest = _manifestCache.get(app);
  const ids = _opIds(manifest);
  if (!ids.has(opId)) {
    throw new Error(
      `twin-reachability: "${opId}" is not declared by apps/${app}/manifest.js — `
      + `a journey may only enter through a declared surface (${ids.size} ops declared). `
      + `If the op is real but undeclared, THAT is the finding: declare it or do not test it.`,
    );
  }
  return opId;
}
