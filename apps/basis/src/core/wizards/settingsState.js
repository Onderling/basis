/**
 * settings — state helpers lifted from
 * src/web/wizards/settingsWizard.js (2026-05-24).
 *
 * Settings is a panel of mostly-independent controls (locale +
 * transport-mode + stoop handle/displayName/holiday-mode) — there
 * isn't much step-machine here, but the LOAD + SAVE substrate
 * calls + the language/transport option catalogues ARE portable.
 *
 * Mobile parity: RN's settings screen reuses these helpers so the
 * substrate-call patterns + UX taxonomies stay in lockstep.
 */

/** Language options exposed in the General section. */
export const LANG_OPTIONS = Object.freeze([
  { code: 'en', name: 'English'     },
  { code: 'nl', name: 'Nederlands'  },
]);

/** Transport-mode options exposed in the General section. */
export const TRANSPORT_MODES = Object.freeze(['nkn', 'relay', 'both']);

/** Initial panel state — both reads start as null (loading). */
export function initialState() {
  return {
    profile:    null,    // {handle, displayName, ...} from stoop
    holiday:    null,    // boolean or null
    loading:    true,
    loadError:  null,
  };
}

/**
 * Load profile + holiday-mode in sequence, swallowing per-skill
 * errors (so a missing holiday-mode skill doesn't block the
 * profile section).  Mutates state in place; returns the mutated
 * state.
 */
export async function loadSettings({ state, callSkill }) {
  try {
    const p = await callSkill('stoop', 'getStoopProfile', {});
    state.profile = p ?? null;
  } catch { /* swallow */ }
  try {
    const h = await callSkill('stoop', 'getHolidayMode', {});
    state.holiday = h?.holidayMode === true;
  } catch { /* swallow */ }
  state.loading = false;
  return state;
}

/**
 * Save the user's handle.  Trims; returns {ok: true} or {ok: false,
 * error}.  No-op on empty input (returns {ok: false, error:
 * 'empty'} so callers don't accidentally clear the handle).
 */
export async function saveHandle({ callSkill, handle }) {
  const v = String(handle ?? '').trim();
  if (!v) return { ok: false, error: 'empty' };
  try {
    await callSkill('stoop', 'setMyHandle', { handle: v });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Save the user's display name (trims + no-empty semantics same as saveHandle). */
export async function saveDisplayName({ callSkill, displayName }) {
  const v = String(displayName ?? '').trim();
  if (!v) return { ok: false, error: 'empty' };
  try {
    await callSkill('stoop', 'setMyDisplayName', { displayName: v });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Toggle holiday mode.  Returns {ok, holidayMode} or {ok:false, error}. */
export async function setHolidayMode({ callSkill, on }) {
  try {
    const r = await callSkill('stoop', 'setHolidayMode', { on: !!on });
    return { ok: true, holidayMode: r?.holidayMode ?? !!on };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
