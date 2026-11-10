/**
 * The in-app BANNER: the second surface over "Nieuw voor jou"'s rows (`forYouRows`, unfolded). While the app is open, a
 * row that is NEW since the last reading, of a kind the person lets banner, for a persona ticked in the switcher, and
 * not on the screen they are already looking at, shows for a moment at the top; tap = open it. A burst of more than one
 * shows as one banner with a count. Nothing is stored and nothing is sent: it reads what Today reads.
 *
 * Which kinds banner is a table in the parameter register (`notify.policy.<kind>` = banner · list · off), the person's
 * to change: the defaults ring for what is addressed to them (a direct message, being removed) and keep the rest to
 * the row on Today. "off" drops the kind from the banner; the row on Today stays (that is where unread things live).
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long a banner stays (ms) before it goes by itself. */
export const NOTIFY_BANNER_MS = param({ key: 'notify.bannerMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5000 });

export const NOTIFY_POLICIES = Object.freeze(['banner', 'list', 'off']);
/** The default per row kind (`notificationRows`' kinds). */
export const NOTIFY_POLICY_DEFAULTS = Object.freeze({ dm: 'banner', removed: 'banner', item: 'list', line: 'list', joined: 'list', setting: 'list', assigned: 'banner', ask: 'list' });
export const notifyPolicyKey = (kind) => `notify.policy.${kind}`;
/** The register rows for the table (the settings screen paints them; `paramsService` declares them). */
export const NOTIFY_POLICY_PARAMS = Object.freeze(Object.entries(NOTIFY_POLICY_DEFAULTS).map(([kind, def]) => ({
  key: notifyPolicyKey(kind), scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.USER, default: def, choices: NOTIFY_POLICIES,
})));

export const BANNER_KEYS = Object.freeze({ many: 'circle.forYou.banner_many' });

/**
 * A kind's rung on the person's ladder: banner (a banner and a row) > list (a row on Today only) > off (neither; the
 * circle tile's badge and the unread in the circle stay, that is where unread lives). The register's value, else the
 * kind's default, else list.
 */
export function policyFor(kind, policyOf = null) {
  const v = typeof policyOf === 'function' ? policyOf(kind) : null;
  return NOTIFY_POLICIES.includes(v) ? v : (NOTIFY_POLICY_DEFAULTS[kind] ?? 'list');
}

/**
 * One reading: which rows are new since the last one, and the banner they make (or none).
 *
 * @param {object} a
 * @param {object[]} a.rows            `forYouRows(…, { fold: false })`: one row per thing, newest first
 * @param {Set<string>|null} a.known   the row ids of the last reading; null = the first reading (it only seeds: what
 *                                     was there when the app opened is Today's, never a banner)
 * @param {number} [a.since]          when the app opened: what ARRIVED before it is Today's, never a banner (a source
 *                                     read late, the direct messages loading after the first reading, stays quiet)
 * @param {string[]|null} [a.selvesOn] the personas ticked in the switcher; null = one persona, every row is its
 * @param {(open: {kind: string, id: string}) => boolean} [a.onSource]  is the person looking at this source now
 * @param {(kind: string) => string} [a.policyOf]  the register's value for `notify.policy.<kind>`
 * @param {(key: string, vars?: object) => string} a.t
 * @returns {{ banner: {text: string, count: number, open: object|null, rows: object[]}|null, known: Set<string> }}
 */
export function bannerFor({ rows = [], known = null, since = 0, selvesOn = null, onSource = null, policyOf = null, t } = {}) {
  const ids = new Set((Array.isArray(rows) ? rows : []).map((r) => r?.id).filter(Boolean));
  if (known == null) return { banner: null, known: ids };
  const policy = (kind) => policyFor(kind, policyOf);
  const ticked = Array.isArray(selvesOn) && selvesOn.length ? new Set(selvesOn) : null;
  const fresh = rows.filter((r) => r?.id && !known.has(r.id)
    && !(Number.isFinite(r.at) && r.at < since)
    && policy(r.kind) === 'banner'
    && (!ticked || ticked.has(r.self?.id ?? 'default'))
    && !(typeof onSource === 'function' && r.open && onSource(r.open)));
  if (!fresh.length) return { banner: null, known: ids };
  if (fresh.length === 1) return { banner: { text: fresh[0].text, count: 1, open: fresh[0].open ?? null, rows: fresh }, known: ids };
  return { banner: { text: t(BANNER_KEYS.many, { count: fresh.length }), count: fresh.length, open: null, rows: fresh }, known: ids };
}

/**
 * The banner's life in a shell: `poke()` after anything that may have brought news (a log append, a turn stored, a
 * switcher change); it reads the rows, keeps the known ids, shows a banner through the shell's `show`, and hides it
 * after `NOTIFY_BANNER_MS` or on `dismiss()`. A newer banner replaces the one showing (newest wins). The shell only
 * paints (`show(banner)` / `hide()`) and opens (`banner.open`, or Today for a burst).
 *
 * @param {object} a
 * @param {() => object[]|Promise<object[]>} a.readRows   `forYouRows(hostOps, { fold: false })`
 * @param {() => string[]|null} [a.selvesOn]
 * @param {(open: object) => boolean} [a.onSource]
 * @param {(kind: string) => string} [a.policyOf]
 * @param {(key: string, vars?: object) => string} a.t
 * @param {(banner: object) => void} a.show
 * @param {() => void} a.hide
 * @param {number} [a.durationMs]
 * @param {(fn: Function, ms: number) => any} [a.setTimer]
 * @param {(h: any) => void} [a.clearTimer]
 */
export function createBannerDriver({ readRows, selvesOn = null, onSource = null, policyOf = null, t, show, hide,
  durationMs = NOTIFY_BANNER_MS, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  const since = now();
  let known = null;
  let timer = null;
  let running = Promise.resolve();
  const dismiss = () => { if (timer) clearTimer(timer); timer = null; hide?.(); };
  const once = async () => {
    let rows = [];
    try { rows = (await readRows()) ?? []; } catch { return; }
    const r = bannerFor({ rows, known, since, selvesOn: typeof selvesOn === 'function' ? selvesOn() : selvesOn, onSource, policyOf, t });
    known = r.known;
    if (!r.banner) return;
    if (timer) clearTimer(timer);
    show(r.banner);
    timer = setTimer(dismiss, durationMs);
  };
  return {
    // readings run one after another, so two pokes in a burst never show the same row twice
    poke: () => { running = running.then(once, once); return running; },
    dismiss,
  };
}
