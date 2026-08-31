/**
 * The ADVANCED surface — the default place every op has (the "default places for any new
 * opId" rule, decided 2026-08-11): an op with no bespoke screen anywhere is still VISIBLE
 * and REACHABLE here, by construction. Two halves, one shared projection both shells paint:
 *
 *   • the SURFACE-LESS OPS — the complement of the coverage matrix's screen column (the
 *     same `renderCoverage` the coverage snapshot and /health read, so this list and the
 *     snapshot can never disagree). A row without required params runs directly through
 *     the waist; a row with them points at its chat route (the slash form) — the chat
 *     surface is the arg-taking executor every op already has by construction.
 *   • the USER PARAMS — the register's settable values (`list-user-params`), each editable
 *     through the ONE kind-gated `set-param` op.
 *
 * Pure projections; the shells only paint and dispatch.
 */
import { renderCoverage } from '@onderling/app-manifest';

/**
 * The surface-less op rows.
 *
 * @param {object} a
 * @param {object[]} a.manifests  the composed manifests (appId + operations[])
 * @returns {Array<{app:string, op:string, verb:string, description:string,
 *                  slash:?string, requiredParams:string[], runnable:boolean}>}
 */
export function advancedOpRows({ manifests = [] } = {}) {
  const list = manifests.filter((m) => m && Array.isArray(m.operations));
  const cov = renderCoverage(list);
  const opIndex = new Map();
  for (const m of list) {
    const app = m.appId ?? m.app ?? m.id ?? '';
    for (const op of m.operations) opIndex.set(`${app}:${op.id}`, op);
  }
  // SURFACE-LESS means "no screen this op DECLARES", not "no screen the coverage report guesses at".
  //
  // The report's `screen` column is true when an op declares `surfaces.ui`/`page` OR its verb is
  // creative (`add`/`register`), because `renderWeb` auto-projects a compose form for those. That is a
  // fair estimate for a REPORT and the wrong rule for a NET: twelve basis ops are tagged `verb: 'add'`
  // while creating nothing — `signin`, `mute`, `rotate-identity`, `test-peer` — so the matrix credited
  // them with a screen that does not exist, and this list, whose whole promise is "every op with no
  // bespoke screen is reachable here", skipped exactly the ops that had nowhere else to be.
  // Measured 2026-08-31: 12 of basis's 15 screen-claims were inferred from the verb alone.
  //
  // A net may not assume coverage it cannot verify. Declared surfaces are checkable; a verb is a guess.
  // (The mis-tagged verbs are a separate defect — they also make `renderWeb` project nonsense compose
  // forms — recorded on the work list rather than fixed here.)
  //
  // `surfaces.attach` counts as a door for the same reason `ui` and `page` do: it is DECLARED, and
  // `renderAttachments` projects it into the composer's "+" menu on both shells, where a tap compiles
  // to the same `{opId, args}` a slash command does. The three embed ops reach people that way, so
  // repeating them here would pad the list of last resort with ops that are not stranded.
  return cov.rows
    .filter((r) => {
      const s = opIndex.get(`${r.app}:${r.op}`)?.surfaces;
      return !s?.ui && !s?.page && !s?.attach;
    })
    .map((r) => {
      const op = opIndex.get(`${r.app}:${r.op}`);
      const params = Array.isArray(op?.params) ? op.params : [];
      const required = params.filter((p) => p?.required).map((p) => p.name);
      const slash = op?.surfaces?.slash?.command ?? null;
      return {
        app: r.app,
        op: r.op,
        verb: r.verb ?? '',
        description: typeof op?.description === 'string' ? op.description
          : typeof op?.surfaces?.chat?.hint === 'string' ? op.surfaces.chat.hint : '',
        slash,
        params,
        requiredParams: required,
        // Runnable directly = nothing the user must supply. Everything else gets a FORM of its own, built
        // from these params on every shell (web: the docked page panel; mobile: a sheet) — the slash
        // template stays as a hint, never the only door: a device with no circle has no chat to type in.
        runnable: required.length === 0,
        /** How a shell lets the person run it: `run` (no input) · `form` (its params, as a page). */
        via: required.length === 0 ? 'run' : 'form',
      };
    });
}

/**
 * The editable-params rows, from the register's own reply (`list-user-params`).
 * Pure reshape — keeps the shells off the reply's internals.
 *
 * @param {{ok?: boolean, params?: Array}} reply
 * @returns {Array<{key:string, scope:string, value:any, default:any}>}
 */
export function advancedParamRows(reply) {
  const params = Array.isArray(reply?.params) ? reply.params : [];
  return params.map((p) => ({
    key: p.key, scope: p.scope ?? '', value: p.value, default: p.default,
  }));
}
