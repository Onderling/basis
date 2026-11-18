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
  if (typeof op !== 'string' || !op) return null;
  return {
    id: `${OWN_ACTION_KIND}:${rid()}`,
    type: OWN_ACTION_KIND,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    circleId: typeof circleId === 'string' && circleId ? circleId : null,
    silent: true,
    payload: {
      app: typeof app === 'string' && app ? app : null,
      op,
      outcome: outcome == null ? null : String(outcome),
      door: DOORS.includes(door) ? door : 'unknown',
    },
  };
}

/**
 * Is this call one of the person's own acts? Only the owner's (a call with a door person, `ctx.caller`, is that
 * person's, not the owner's); an op that writes always; an op that only reads only when a door says the person asked
 * (`ctx.door`: a slash command, a phrase, the model): a screen reading what it paints is not an act. Read or write is
 * the manifest's own reading (`verbKind`); an op no manifest declares is not recorded. `manifests`: every manifest the
 * app runs (`allManifests()`, handed in by the caller so this module stays below the manifest list).
 * @param {{app: string, op: string, ctx?: object, manifests: object[]}} a
 */
export function ownActIs({ app, op, ctx = {}, manifests = [] }) {
  if (typeof ctx?.caller === 'string' && ctx.caller) return false;
  const m = (Array.isArray(manifests) ? manifests : []).find((x) => x?.app === app);
  const declared = m?.operations?.find((o) => o?.id === op);
  if (!declared) return false;
  const kind = verbKind(m, declared.verb);
  if (kind === 'read') return typeof ctx?.door === 'string' && ctx.door !== '';
  return true;
}

/**
 * Write one own-action entry for a call that is an act (`ownActIs`), with its outcome: `ok`, or `failed` when the
 * result says `ok: false` or the call threw. Best-effort: a log that refuses never breaks the act it records.
 * @param {{deviceLog?: {append: Function}, enabled?: boolean, app: string, op: string, args?: object, ctx?: object,
 *   result?: object, threw?: boolean, manifests?: object[], now?: () => number}} a
 */
export function recordOwnAction({ deviceLog, enabled = true, app, op, args = {}, ctx = {}, result = null, threw = false, manifests = [], now = Date.now }) {
  if (enabled === false || typeof deviceLog?.append !== 'function') return null;
  try {
    if (!ownActIs({ app, op, ctx, manifests })) return null;
    const outcome = threw || result?.ok === false ? 'failed' : 'ok';
    const circleId = circleArg(args);   // the op's own circle argument, by whichever name its manifest gives it
    const entry = makeOwnActionEntry({ app, op, outcome, door: ctx?.door ?? 'unknown', circleId, ts: now() });
    if (entry) deviceLog.append(entry);
    return entry;
  } catch { return null; }
}
