/**
 * THE SETTINGS SURFACE, PROJECTED FROM THE PARAMETER REGISTER — what both shells paint for the person's settable
 * values (the register's `list-user-params` reply): each param with a translated label and the control its value
 * needs, grouped by where it lives (this device · the person, on every device · a circle). The register stays the one
 * source — its specs carry the default (which says the value's type) and, for a value with a closed set, its
 * `choices`; nothing here lists params. A change goes back through the one `set-param` op as the value the register
 * holds (`valueFor`).
 */

/** The scopes, in the order the screen shows them. */
export const SETTINGS_SCOPE_ORDER = Object.freeze(['device', 'agent', 'circle']);

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
const UNIT_MS = { hours: HOUR_MS, minutes: MINUTE_MS, seconds: SECOND_MS };

/** A param key as a locale key segment: `nearby.ask.defaultTtlMs` → `nearby_ask_defaultTtlMs`. */
const keySegment = (key) => String(key).replace(/[^A-Za-z0-9]+/g, '_');

/** The control a value takes: its closed set → a choice; else by the default's type (a `…Ms` number is a duration). */
function controlOf(p) {
  if (Array.isArray(p.choices) && p.choices.length) {
    return {
      kind: 'choice',
      options: p.choices.map((c) => (c && typeof c === 'object'
        ? { value: c.value, labelKey: c.labelKey ?? `circle.params.opt.${keySegment(c.value)}` }
        : { value: c, labelKey: `circle.params.opt.${keySegment(c)}` })),
    };
  }
  const d = p.default;
  if (typeof d === 'boolean') return { kind: 'switch' };
  if (typeof d === 'number') {
    // a duration in the largest unit its default is whole in (a 0 default reads in minutes)
    if (/Ms$/.test(p.key)) return { kind: 'duration', unit: d !== 0 && d % HOUR_MS === 0 ? 'hours' : d % MINUTE_MS === 0 ? 'minutes' : 'seconds' };
    return { kind: 'number' };
  }
  if (Array.isArray(d)) return { kind: 'list' };
  return { kind: 'text' };
}

/** What the control shows for a value (a duration in its unit, a list as "a, b"). */
function shownOf(control, v) {
  if (control.kind === 'duration') return Number(v) / UNIT_MS[control.unit];
  if (control.kind === 'list') return Array.isArray(v) ? v.join(', ') : String(v ?? '');
  return v;
}

/**
 * A control's input as the value the register holds — or `{error}` (a locale key) when it is not one.
 * @param {{control: {kind: string, unit?: string}}} row
 * @param {*} input   what the control gave (a boolean, a choice's value, or text)
 */
function valueFor(row, input) {
  const { kind, unit } = row?.control ?? {};
  if (kind === 'switch') return input === true;
  if (kind === 'choice' || kind === 'text') return input;
  if (kind === 'list') return String(input ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const n = Number(String(input ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || String(input ?? '').trim() === '') return { error: 'circle.params.bad_number' };
  if (kind === 'duration') return Math.round(n * UNIT_MS[unit]);
  return n;
}

/**
 * The surface: groups by scope, each row `{key, labelKey, control, value, shown, default}`.
 * @param {Array<{key: string, scope: string, value: *, default: *, choices?: Array}>} params   `list-user-params`'s rows
 * @returns {{groups: Array<{scope: string, labelKey: string, rows: object[]}>, valueFor: Function}}
 */
export function settingsProjection(params = []) {
  const rows = (Array.isArray(params) ? params : []).filter((p) => p && typeof p.key === 'string').map((p) => {
    const control = controlOf(p);
    const value = p.value ?? p.default;
    return { key: p.key, labelKey: `circle.params.key.${keySegment(p.key)}`, control, value, shown: shownOf(control, value), default: p.default, scope: p.scope };
  });
  const groups = SETTINGS_SCOPE_ORDER
    .map((scope) => ({ scope, labelKey: `circle.params.scope.${scope}`, rows: rows.filter((r) => r.scope === scope) }))
    .filter((g) => g.rows.length);
  return { groups, valueFor };
}
