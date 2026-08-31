/**
 * THE TRANSLATOR CONTRACT — one table, asserted against both shells' `t()`.
 *
 * The two shells translate with different machinery and always will: web runs i18next (plurals for any
 * future locale, formatters, nesting — a library nobody should re-implement), and mobile runs a ~40-line
 * hand-rolled `t()` (no i18next in the RN bundle, no async init in the boot path, no dependency on a
 * tree that does not survive a reinstall). Both read the SAME shared locale files. That is a good trade
 * and a standing hazard: nothing made the two agree about what those files MEAN.
 *
 * It had already cost twice by the time this was written (2026-08-31):
 *   • a `count_one` / `count_other` pair rendered correctly on web and as "1 device(s)" on the phone,
 *     because mobile's `t()` had no plural branch at all;
 *   • `defaultValue` — i18next's own escape hatch, and the reason the locale fitness guard SKIPS a call
 *     that carries one — was ignored by mobile, so five calls that read fine in a browser rendered
 *     their raw key on a phone.
 *
 * Neither failed anywhere. A missing translation is not an error; it is a string.
 *
 * So this table is the agreement, not either implementation's behaviour: every case uses keys from the
 * SHARED blocks (the only ones both bundles are guaranteed to hold), and each shell's test feeds it to
 * its own translator. When the two must differ, the difference belongs here as a case, not in a comment.
 *
 * @typedef {{ name: string, key: string, params?: object, lang?: 'en'|'nl', expect: string }} ContractCase
 */

/** @type {ContractCase[]} */
export const TRANSLATOR_CONTRACT = Object.freeze([
  // ── 1 · a dotted key resolves to its text, in each language ──
  { name: 'a dotted key, en', key: 'circle.nearbyScreen.title', lang: 'en', expect: 'Nearby' },
  { name: 'a dotted key, nl', key: 'circle.nearbyScreen.title', lang: 'nl', expect: 'In de buurt' },

  // ── 2 · {{name}} substitution, including a zero and an empty string ──
  { name: 'interpolation, two values', key: 'circle.nearbyScreen.header',
    params: { sharing: 2, total: 5 }, lang: 'en', expect: '2 of 5 share offerings with you' },
  { name: 'interpolation, a value of 0 is a value (not "missing")', key: 'circle.nearbyScreen.header',
    params: { sharing: 0, total: 3 }, lang: 'en', expect: '0 of 3 share offerings with you' },
  { name: 'interpolation, an empty string is a value too', key: 'circle.nearbyScreen.header',
    params: { sharing: '', total: 3 }, lang: 'en', expect: ' of 3 share offerings with you' },
  { name: 'interpolation, nl uses its own sentence', key: 'circle.nearbyScreen.header',
    params: { sharing: 1, total: 4 }, lang: 'nl', expect: '1 van 4 delen aanbod met jou' },

  // ── 3 · a value the caller did not pass leaves its placeholder visible — on BOTH shells ──
  //   Not an endorsement: `{{count}} device(s)` on screen is ugly. It is what i18next does with this
  //   entry as web configures it, so it is what the contract says. The plan had recorded the opposite
  //   from reading the library rather than running it, and mobile was changed to match the reading;
  //   this row failed on its first run and the change was reverted. Improving it means changing WEB
  //   first (i18next has a `missingInterpolationHandler`), and then this row.
  { name: 'a missing interpolation value leaves the placeholder showing, on both shells',
    key: 'circle.nearby.count', lang: 'en', expect: '{{count}} device(s)' },

  // ── 4 · plurals: the `_one` / `_other` pair the shared files are authored with ──
  { name: 'plural: one, en',  key: 'circle.nearby.count', params: { count: 1 }, lang: 'en', expect: '1 device' },
  { name: 'plural: other, en', key: 'circle.nearby.count', params: { count: 2 }, lang: 'en', expect: '2 devices' },
  { name: 'plural: zero takes the OTHER form in en/nl', key: 'circle.nearby.count',
    params: { count: 0 }, lang: 'en', expect: '0 devices' },
  { name: 'plural: one, nl',  key: 'circle.nearby.count', params: { count: 1 }, lang: 'nl', expect: '1 apparaat' },
  { name: 'plural: other, nl', key: 'circle.nearby.count', params: { count: 2 }, lang: 'nl', expect: '2 apparaten' },

  // ── 5 · a key that merely ENDS in _one is not a plural form ──
  //   `circle.feedback.send_one` is a real key ("Send"), not the singular of a `send`. Asking for it
  //   directly must return it; the trap is a future `send` called with a count silently picking it up.
  { name: 'a key ending in _one is a key, not a plural form',
    key: 'circle.feedback.send_one', lang: 'en', expect: 'Send' },

  // ── 6 · a key nobody has translated comes back verbatim, so the gap is visible ──
  { name: 'an unknown key returns itself', key: 'circle.nope.not_a_key', lang: 'en',
    expect: 'circle.nope.not_a_key' },

  // ── 7 · defaultValue — i18next's escape hatch, honoured on both shells ──
  { name: 'defaultValue answers for an unknown key', key: 'circle.nope.still_not_a_key',
    params: { defaultValue: 'a sentence, not a key' }, lang: 'en', expect: 'a sentence, not a key' },
  { name: 'defaultValue does NOT override a key that exists', key: 'circle.nearbyScreen.title',
    params: { defaultValue: 'should not win' }, lang: 'en', expect: 'Nearby' },

  // ── 8 · the third argument overrides the ambient language for one call ──
  //   (the feedback thread renders its chrome in the BOT's language, not the app's)
  { name: 'the per-call language override wins over the ambient one',
    key: 'circle.nearbyScreen.title', lang: 'nl', expect: 'In de buurt' },
]);
