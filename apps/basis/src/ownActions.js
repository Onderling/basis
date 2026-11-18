/**
 * The person's own acts, on this device's log — a record for them alone of which op they ran, through which door, in
 * which circle, and when. Never the arguments, the words or another person: an op id and where it came from is the
 * whole entry (the same whitelist discipline as the agent trail, `makeAgentTrailEntry`).
 *
 * Where it is written: once per act at the outer waist (the agent's `callSkill` as the shells and doors reach it), for
 * the owner only (a call with no `ctx.caller`). The agent trail stays the record of OTHERS acting; it keeps skipping
 * the owner, so nothing is written twice. Where it goes: this device's log only (`own-action` is a local kind), and the
 * person's own storage when they mirror their history there. It is never fanned to a circle, a contact or the
 * person's other devices.
 *
 * Two settings, both the person's: whether it is written at all (on by default), and for how many weeks it is kept
 * (13 by default; 0 keeps everything).
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { verbKind, circleArg } from '@onderling/app-manifest';

export const OWN_ACTION_KIND = 'own-action';

export const OWN_RECORD_KEY = 'ownActions.record';
export const OWN_KEEP_WEEKS_KEY = 'ownActions.keepWeeks';
/** Whether this device writes the person's own acts at all (off writes nothing from then on). */
export const OWN_RECORD = param({ key: OWN_RECORD_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: true });
/** How many weeks the person's own acts stay on this device; 0 keeps everything. */
export const OWN_KEEP_WEEKS = param({ key: OWN_KEEP_WEEKS_KEY, scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: 13 });

/** Where an act came from. `unknown` when the caller cannot say (each such caller is named where it is wired). */
export const DOORS = Object.freeze(['tap', 'slash', 'phrase', 'model', 'bot', 'clock', 'agent', 'unknown']);

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Longest a person may ask for, in weeks (ten years); past it, 0 says "keep everything". */
const MAX_WEEKS = 520;

/** The `own` retention window (ms) for a keep-weeks value: 0 keeps everything; a bad value keeps the default. */
export function ownRetentionMs(weeks) {
  const n = Number(weeks);
  if (n === 0) return Number.MAX_SAFE_INTEGER;
  return Number.isFinite(n) && n > 0 && n <= MAX_WEEKS ? Math.round(n * WEEK_MS) : Number(OWN_KEEP_WEEKS) * WEEK_MS;
}

const rid = () => {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * One own-action entry: the whitelisted keys only, whatever else the caller holds.
 * @param {{app?: string, op?: string, outcome?: string|null, door?: string, circleId?: string|null, ts?: number}} a
 * @returns {object|null} null without an op
 */
export function makeOwnActionEntry({ app = null, op, outcome = null, door = 'unknown', circleId = null, ts = Date.now() } = {}) {
  // an op names every entry but a line the "+" placed nowhere (`no_act`: there was no op)
  if ((typeof op !== 'string' || !op) && outcome !== 'no_act') return null;
  return {
    id: `${OWN_ACTION_KIND}:${rid()}`,
    type: OWN_ACTION_KIND,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    circleId: typeof circleId === 'string' && circleId ? circleId : null,
    silent: true,
    payload: {
      app: typeof app === 'string' && app ? app : null,
      op: typeof op === 'string' && op ? op : null,
      outcome: outcome == null ? null : String(outcome),
      door: DOORS.includes(door) ? door : 'unknown',
    },
  };
}

/**
 * The part of a turn's context that goes down to the waist: the door the person came through, and nothing else (a
 * shell's turn scope carries message ids, history and the like, which the waist must not read as a call's context).
 * `undefined` when there is no door, so the call is made exactly as before.
 * @param {object} [ctx]
 * @returns {{door: string}|undefined}
 */
export function doorOnly(ctx) {
  const door = ctx && typeof ctx === 'object' ? ctx.door : null;
  return typeof door === 'string' && door ? { door } : undefined;
}

/** The doors a person comes through: a call naming one of these is theirs; `unknown` is no door. */
const PERSON_DOORS = new Set(DOORS.filter((d) => d !== 'unknown'));

/**
 * Is this call one of the person's own acts? Only a call that NAMES a person door (`ctx.door`: tap, slash, phrase,
 * model, clock …): a call no door names is background work (an address announce, a sync, a key fan-out), however much
 * it writes (Fable 2026-11-18: a missed person path shows as absence, not as noise). Only the owner's (a call with a
 * door person, `ctx.caller`, is that person's); a read only when a door other than a tap asked for it (a tap reading
 * what a screen paints is not an act); an op no manifest declares never. Read or write is the manifest's own reading
 * (`verbKind`). `manifests`: every manifest the
 * app runs (`allManifests()`, handed in by the caller so this module stays below the manifest list).
 * @param {{app: string, op: string, ctx?: object, manifests: object[]}} a
 */
export function ownActIs({ app, op, ctx = {}, manifests = [] }) {
  if (typeof ctx?.caller === 'string' && ctx.caller) return false;
  if (!PERSON_DOORS.has(ctx?.door)) return false;
  const m = (Array.isArray(manifests) ? manifests : []).find((x) => x?.app === app);
  const declared = m?.operations?.find((o) => o?.id === op);
  if (!declared) return false;
  const kind = verbKind(m, declared.verb);
  if (kind === 'read') return ctx.door !== 'tap';
  return true;
}

/**
 * The codes a waist op answers with when it says NO on purpose (who may, or as whom), not because something broke: the
 * op's own "not yours" (`forbidden`) and "you have no self in this circle" (`no-self`, `not-a-self-here`).
 */
const REFUSAL_CODES = new Set(['forbidden', 'no-self', 'not-a-self-here']);

/**
 * How a call ended, for the record: `refused` when it was turned down on purpose (a result carrying the admission
 * `refusal` shape, one of the waist's refusal codes, or the kernel gate's `PolicyDeniedError`), `failed` when something
 * broke (`ok: false` otherwise, or it threw), else `ok`.
 * @param {object|null} result
 * @param {unknown} [error]   what the call threw, if it did
 */
export function ownOutcome(result, error = null) {
  if (error != null) return error?.name === 'PolicyDeniedError' ? 'refused' : 'failed';
  if (result?.ok !== false) return 'ok';
  if (result.refusal && typeof result.refusal === 'object') return 'refused';
  return REFUSAL_CODES.has(result.code) ? 'refused' : 'failed';
}

/**
 * Write one own-action entry for a call that is an act (`ownActIs`), with its outcome (`ownOutcome`): `ok`, `refused`
 * or `failed`. Best-effort: a log that refuses never breaks the act it records.
 * @param {{deviceLog?: {append: Function}, enabled?: boolean, app: string, op: string, args?: object, ctx?: object,
 *   result?: object, threw?: boolean, error?: unknown, manifests?: object[], now?: () => number}} a
 */
export function recordOwnAction({ deviceLog, enabled = true, app, op, args = {}, ctx = {}, result = null, threw = false, error = null, manifests = [], now = Date.now }) {
  if (enabled === false || typeof deviceLog?.append !== 'function') return null;
  try {
    if (!ownActIs({ app, op, ctx, manifests })) return null;
    const outcome = ownOutcome(result, threw ? (error ?? new Error('threw')) : null);
    const circleId = circleArg(args);   // the op's own circle argument, by whichever name its manifest gives it
    const entry = makeOwnActionEntry({ app, op, outcome, door: ctx?.door ?? 'unknown', circleId, ts: now() });
    if (entry) deviceLog.append(entry);
    return entry;
  } catch { return null; }
}

/**
 * The person's own acts as rows, oldest first: a projection over the device log (never a second store). What the My
 * data row exports, and what a walk reads.
 * @param {{query: Function}} log
 * @returns {{ts: number, circleId: string|null, app: string|null, op: string, outcome: string|null, door: string}[]}
 */
export function ownActionRows(log) {
  let entries = [];
  try { entries = log?.query?.() ?? []; } catch { entries = []; }
  return entries
    .filter((e) => e?.type === OWN_ACTION_KIND && e.payload)
    .map((e) => ({ ts: e.ts, circleId: e.circleId ?? null, app: e.payload.app, op: e.payload.op, outcome: e.payload.outcome, door: e.payload.door }))
    .sort((a, b) => a.ts - b.ts);
}

export const OWN_ACTIONS_EXPORT_FORMAT = 'onderling-own-actions';
export const OWN_ACTIONS_EXPORT_VERSION = 1;

/**
 * The person's own record as ONE file they save (My data's Export): the rows (`ownActionRows`) and nothing else, with
 * a format and a version so a later version can still read it. Never the words: the rows carry none.
 * @param {object[]} rows @param {{now?: () => number}} [o]
 * @returns {string} JSON
 */
export function ownActionsExport(rows, { now = Date.now } = {}) {
  return JSON.stringify({
    format: OWN_ACTIONS_EXPORT_FORMAT, version: OWN_ACTIONS_EXPORT_VERSION, exportedAt: now(),
    rows: Array.isArray(rows) ? rows : [],
  }, null, 2);
}

/**
 * The words of the record's row under My data, for both shells: how much is kept (one and more read apart), and, when
 * the switch is off, that nothing is being recorded (what is kept stays, with its count and its Export).
 * @param {{on?: boolean, count?: number, t: Function}} o
 * @returns {{count: string, off: string|null}}
 */
export function ownActionsLines({ on = true, count = 0, t } = {}) {
  const n = Number(count) || 0;
  const countLine = n === 0 ? t('circle.mydata.own_actions_none')
    : n === 1 ? t('circle.mydata.own_actions_count_one') : t('circle.mydata.own_actions_count_n', { count: n });
  return { count: countLine, off: on === false ? t('circle.mydata.own_actions_off') : null };
}

/**
 * What no op shows, noted by the door that knows it (the "+", `plusDoor.js`): a proposal the person turned down
 * (`declined`, naming the act it proposed) and a line placed nowhere (`no_act`, no op). Only these two: an act that ran
 * is the waist's to record (`recordOwnAction`). Like every own act it needs a person door, follows the switch, and is
 * best-effort.
 * @param {{deviceLog?: {append: Function}, enabled?: boolean, app?: string|null, op?: string|null,
 *   outcome: 'declined'|'no_act', door: string, circleId?: string|null, now?: () => number}} a
 * @returns {object|null} the entry written, or null
 */
export function noteOwnOutcome({ deviceLog, enabled = true, app = null, op = null, outcome, door, circleId = null, now = Date.now } = {}) {
  if (enabled === false || typeof deviceLog?.append !== 'function') return null;
  if (!PERSON_DOORS.has(door)) return null;
  if (outcome !== 'declined' && outcome !== 'no_act') return null;
  if (outcome === 'declined' && (typeof op !== 'string' || !op)) return null;
  try {
    const entry = makeOwnActionEntry({ app, op: outcome === 'no_act' ? null : op, outcome, door, circleId, ts: now() });
    if (entry) deviceLog.append(entry);
    return entry;
  } catch { return null; }
}
