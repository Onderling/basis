/**
 * basis — form spec generator.
 *
 * Given a manifest op's `params` array + the args already bound by
 * the parser, decide:
 *
 *   1. Which params still need a value (already-bound params
 *      become "prefilled" + read-only inputs; missing required
 *      params become required inputs).
 *   2. WHICH rendering strategy to use:
 *        - 'sequential'  — 1 simple-kind required missing
 *        - 'inline'      — 2-3 simple-kind required missing
 *        - 'mini-page'   — 4+ OR any complex kind (date/file/image/webid)
 *      Apps may override later via `surfaces.chat.formStyle`
 *      (not in v0.3; deferred).
 *
 * The returned FormSpec is platform-neutral data; the DOM / RN
 * adapter consumes it and produces inputs.
 *
 * Phase v0.3 per `/Project Files/basis/coding-plan.md`.
 */

import { parseRelativeDate, parseDateAndTime } from './parseDate.js';

const SIMPLE_KINDS = new Set(['string', 'number', 'boolean', 'enum']);

/**
 * @typedef {object} FormField
 * @property {string}                              name
 * @property {'string'|'number'|'boolean'|'enum'|'date'|'webid'|'file'|'image'} kind
 * @property {boolean}                             required
 * @property {*}                                   [value]      prefilled value (read-only if from parser)
 * @property {boolean}                             [readOnly]   true when the parser already bound this
 * @property {string[]}                            [choices]    enum: list of allowed values
 * @property {string} [label] derived from labelKey or name
 * @property {string} [labelKey] i18n key, passed through
 * @property {string}                              [placeholder]
 * @property {string}                              [hint]
 */

/**
 * @typedef {object} FormSpec
 * @property {string}              opId
 * @property {string}              appOrigin
 * @property {string|null}         threadId
 * @property {FormField[]}         fields
 * @property {string[]}            missing       names of required fields not yet bound
 * @property {'sequential'|'inline'|'mini-page'} strategy
 * @property {string}              [submitLabel]  optional override; localiser typically provides this
 */

/**
 * Build a FormSpec from a router's `needsForm` route + the
 * underlying op.
 *
 * @param {object}                params
 * @param {object[]}              params.opParams        op.params verbatim
 * @param {string[]}              params.missing         router-computed missing-required list
 * @param {object}                params.prefilledArgs   args bound by the parser
 * @param {string}                params.opId
 * @param {string}                params.appOrigin
 * @param {string|null}           [params.threadId]
 * @returns {FormSpec}
 */
export function buildFormSpec({
  opParams, missing, prefilledArgs, opId, appOrigin, threadId,
}) {
  if (!Array.isArray(opParams)) {
    throw new TypeError('buildFormSpec: opParams must be an array');
  }

  const fields = opParams.map((p) => {
    const name = p.name;
    const hasPrefill = prefilledArgs && Object.prototype.hasOwnProperty.call(prefilledArgs, name);
    const value = hasPrefill ? prefilledArgs[name] : undefined;

    /** @type {FormField} */
    const field = {
      name,
      kind:     p.kind,
      required: !!p.required,
    };
    if (value !== undefined) {
      field.value = value;
      field.readOnly = true;       // parser-bound; user can still edit by re-typing the slash
    }
    if (Array.isArray(p.of) || typeof p.of === 'string') {
      field.choices = Array.isArray(p.of) ? p.of : undefined;
    }
    if (p.labelKey) {
      field.labelKey = p.labelKey;
    }
    // a choice the person must make: no option preselected (a required pick then holds the form until they do)
    if (p.pick === true) field.pick = true;
    if (typeof p.placeholder === 'string') field.placeholder = p.placeholder;
    if (typeof p.hint        === 'string') field.hint        = p.hint;

    // (v0.7) — propagate pickerSource so the DOM/RN adapter can
    // render a click-to-pick list instead of a text input.
    if (p.pickerSource && typeof p.pickerSource === 'object') {
      field.pickerSource = {
        listOp: p.pickerSource.listOp,
        ...(p.pickerSource.filter ? { filter: p.pickerSource.filter } : {}),
        ...(p.pickerSource.appOrigin ? { appOrigin: p.pickerSource.appOrigin } : {}),
      };
    }

    // Mark editable readOnly→false when this field is in `missing` (it
    // explicitly needs user input).
    if (Array.isArray(missing) && missing.includes(name)) {
      field.readOnly = false;
    }
    return field;
  });

  const strategy = pickStrategy(opParams, missing);

  return {
    opId,
    appOrigin,
    threadId: threadId ?? null,
    fields,
    missing: Array.isArray(missing) ? [...missing] : [],
    strategy,
  };
}

/**
 * Strategy decision rule (v0.3 default; apps may override via in
 * a future phase — not in this slice).
 *
 *   missing param count → strategy
 *     0 (shouldn't happen if router emitted needsForm) → 'inline'
 *     1 simple-kind                                     → 'sequential'
 *     2-3 simple-kind                                   → 'inline'
 *     4+ OR any complex kind                            → 'mini-page'
 *
 * @param {object[]} opParams
 * @param {string[]} missing
 * @returns {'sequential'|'inline'|'mini-page'}
 */
export function pickStrategy(opParams, missing) {
  const missingSet  = new Set(missing ?? []);
  const missingDefs = (opParams ?? []).filter((p) => missingSet.has(p.name));
  const anyComplex  = missingDefs.some((p) => !SIMPLE_KINDS.has(p.kind));

  if (anyComplex)             return 'mini-page';
  if (missingDefs.length === 0) return 'inline';
  if (missingDefs.length === 1) return 'sequential';
  if (missingDefs.length <= 3) return 'inline';
  return 'mini-page';
}

/**
 * Validate that a submitted form's args are well-shaped for the op.
 * Returns either { ok: true, args } or { ok: false, errors }.
 *
 * v0.3.0 implements only structural checks: required fields present,
 * enum values in their choice list, number-kind values parseable.
 * Type coercion happens here (strings from input fields become
 * numbers / booleans where the op expects them).
 *
 * @param {FormSpec} spec
 * @param {Object<string, unknown>} formValues
 * @returns {{ok: true, args: object} | {ok: false, errors: Array<{field: string, message: string}>}}
 */
export function validateAndCoerce(spec, formValues) {
  const errors = [];
  const args   = {};
  for (const field of spec.fields) {
    const raw = formValues?.[field.name];
    const hasRaw = raw !== undefined && raw !== null && raw !== '';

    if (!hasRaw) {
      // Carry over prefilled values; complain about missing required.
      if (field.value !== undefined) {
        args[field.name] = field.value;
        continue;
      }
      if (field.required) {
        errors.push({ field: field.name, message: 'required' });
      }
      continue;
    }

    switch (field.kind) {
      case 'number': {
        const n = Number(raw);
        if (Number.isNaN(n)) {
          errors.push({ field: field.name, message: `not a number: ${raw}` });
        } else {
          args[field.name] = n;
        }
        break;
      }
      case 'boolean': {
        args[field.name] = raw === true || raw === 'true' || raw === 'on' || raw === '1';
        break;
      }
      case 'enum': {
        if (Array.isArray(field.choices) && !field.choices.includes(String(raw))) {
          errors.push({ field: field.name, message: `not one of ${field.choices.join('|')}` });
        } else {
          args[field.name] = String(raw);
        }
        break;
      }
      case 'date': {
        // v0.7.-followup 2026-05-23 — use the time-preserving
        // variant so 'tomorrow 3pm' / '23 may 15:00' / ISO datetime
        // all round-trip with their time component (instead of
        // collapsing to midnight UTC).
        const iso = parseDateAndTime(String(raw));
        if (iso === null) {
          errors.push({
            field: field.name,
            message: `not a valid date: ${raw} (try '2026-05-23 14:00', 'tomorrow 3pm', 'fri 15:00', 'friday')`,
          });
        } else {
          args[field.name] = iso;
        }
        break;
      }
      case 'webid': {
        // v0.3.2 — basic shape check.  Real contact-picker via the
        // resolveContact convention lands in v0.4 (per OQ-4 user
        // resolution).  Until then accept anything looking like a
        // URL or 'webid:' / 'did:' prefix; warn otherwise.
        const s = String(raw);
        if (!/^(https?:\/\/|webid:|did:)/i.test(s) && !s.includes('@')) {
          errors.push({
            field: field.name,
            message: `not a valid webid (expected a URL, did:, or webid: prefix)`,
          });
        } else {
          args[field.name] = s;
        }
        break;
      }
      default: {
        // string, file, image — pass through verbatim.  File/image
        // handling lands when an app actually uses them.
        args[field.name] = raw;
        break;
      }
    }
  }
  return errors.length === 0
    ? { ok: true,  args }
    : { ok: false, errors };
}
