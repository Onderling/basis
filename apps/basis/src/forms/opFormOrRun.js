/**
 * A declared op reached with part of its args known (a scanned code names the address; the person names the circle):
 * what is left to ask, or nothing — then it runs. A required param the caller did not fill is asked in a form; one whose
 * picker offers exactly ONE choice is no question and is filled with it. Both shells call this and paint only what it
 * returns — the form, or nothing (the op runs through their waist).
 */
import { buildFormSpec } from './buildFormSpec.js';
import { onlyChoice } from './pickerChoices.js';
import { catalogueManifests } from '../v2/manifestSources.js';

/** The declared op, from the manifests this app composes. */
export function declaredOp(app, opId, manifests = catalogueManifests()) {
  return (manifests.find((m) => m?.app === app)?.operations ?? []).find((o) => o?.id === opId) ?? null;
}

/**
 * @param {{app: string, id: string}} target
 * @param {object} prefilled  what is known
 * @param {(decl: object) => Promise<Array<{id: string, label: string}>>} fetchChoices  the shell's picker fetcher
 * @returns {Promise<{run: {app: string, opId: string, args: object}}|{form: object, choices: Record<string, Array<{id: string, label: string}>>}|{error: string, param?: string}>}
 */
export async function opFormOrRun(target, prefilled = {}, fetchChoices, { manifests } = {}) {
  const op = declaredOp(target?.app, target?.id, manifests);
  if (!op) return { error: 'unknown-op' };
  const params = Array.isArray(op.params) ? op.params : [];
  const args = { ...prefilled };
  const choices = {};
  for (const p of params) {
    if (!p?.required || (args[p.name] !== undefined && args[p.name] !== '')) continue;
    if (p.pickerSource && typeof fetchChoices === 'function') {
      const list = await Promise.resolve(fetchChoices(p.pickerSource)).catch(() => []);
      const one = onlyChoice(list);
      if (one) { args[p.name] = one; continue; }
      // nothing to pick from is no form: said (the op could never be filled in)
      if (!Array.isArray(list) || !list.length) return { error: 'nothing-to-pick', param: p.name };
      choices[p.name] = list;
    }
  }
  const missing = params.filter((p) => p?.required && (args[p.name] === undefined || args[p.name] === '')).map((p) => p.name);
  if (!missing.length) return { run: { app: target.app, opId: op.id, args } };
  return { form: buildFormSpec({ opParams: params, missing, prefilledArgs: args, opId: op.id, appOrigin: target.app }), choices };
}
