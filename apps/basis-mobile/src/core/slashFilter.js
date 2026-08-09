/**
 * Pure slash-suggest filter lifted from
 * apps/basis/web/main.js's `refreshSuggest` (2026-05-24).
 *
 * Zero DOM — pure value transform over the catalog's commandMenu.
 * The RN SlashFAB (and the web slash auto-suggest, if it ever
 * adopts this) call this to derive `matches[]` from user input.
 *
 * Suggest semantics (matches the web UX):
 *   - Empty input or no `/` prefix → no matches.
 *   - User has already typed a space (e.g. `/post hello`) → no
 *     matches; they're in args mode, suggest dropdown closes.
 *   - Otherwise → case-insensitive prefix match against
 *     catalog.commandMenu[].command; up to `limit` results
 *     (default 12, matches the web).
 *
 * Tested in test/core/slashFilter.test.js.
 */

/** Default limit on returned matches (matches web auto-suggest). */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — slash-suggest result cap (scope:device, kind:internal).
export const DEFAULT_SUGGEST_LIMIT = param({ key: 'basisMobile.slashSuggestLimit', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 12 });

/**
 * @param {object}   args
 * @param {string}   args.input            current text in the slash input
 * @param {object}   args.catalog          merged-manifest catalog from composeManifests()
 * @param {number}   [args.limit=12]       cap on returned matches
 * @returns {Array<{command: string, appOrigin: string, opId: string, hint?: string}>}
 */
export function filterSlashSuggestions({ input, catalog, limit = DEFAULT_SUGGEST_LIMIT }) {
  const v = String(input ?? '');
  if (!v.startsWith('/')) return [];
  if (v.includes(' '))    return [];          // args mode — close
  const needle = v.toLowerCase();
  const pool   = catalog?.commandMenu ?? [];
  const out    = [];
  for (const m of pool) {
    if (typeof m?.command === 'string' && m.command.toLowerCase().startsWith(needle)) {
      out.push(m);
      if (out.length >= limit) break;
    }
  }
  return out;
}
