/**
 * How a merged view shows a row — built from what the row's noun DECLARES in its manifest (`nouns[noun].presents`:
 * label · moment · order · mine; plain field keys), so basis never knows a noun by name and a bot's own noun shows the
 * moment it declares its facets. The hard-coded table (`ITEM_PRESENTERS`) is only the fallback for a canonical noun no
 * manifest declares yet. A facet naming a field a row does not have reads empty, never throws: the label then falls
 * back to the row's words, the moment to when it was made.
 */
import { ITEM_PRESENTERS } from './itemPresenters.js';
import { allManifests } from './manifestSources.js';

const words = (r) => String(r?.title ?? r?.text ?? r?.label ?? r?.name ?? '').trim();
const ms = (v) => { const n = typeof v === 'number' ? v : Date.parse(v ?? ''); return Number.isFinite(n) ? n : 0; };

/**
 * A presenter from declared facets.
 * @param {{label?: string, moment?: string, order?: 'asc'|'desc', mine?: string[]}} presents
 * @returns {{label: (row: object) => string, when: (row: object) => number, order: 'asc'|'desc', isMine: (row: object, me: string|null) => boolean}}
 */
export function presenterFromFacets(presents = {}) {
  const labelKey = typeof presents.label === 'string' ? presents.label : null;
  const momentKey = typeof presents.moment === 'string' ? presents.moment : null;
  const mine = Array.isArray(presents.mine) ? presents.mine.filter((k) => typeof k === 'string') : [];
  return {
    label: (r) => String((labelKey ? r?.[labelKey] : '') ?? '').trim() || words(r),
    when: (r) => ms(momentKey ? r?.[momentKey] : undefined) || ms(r?.createdAt ?? r?.ts),
    order: presents.order === 'asc' ? 'asc' : 'desc',
    // a field naming one person, or a list of people (ids or `{webid}`)
    isMine: (r, me) => Boolean(me) && mine.some((k) => {
      const v = r?.[k];
      return Array.isArray(v) ? v.some((x) => (x?.webid ?? x) === me) : v === me;
    }),
  };
}

/**
 * The presenter for a noun: its declaring manifest's facets, else the fallback table, else null. Two manifests
 * declaring facets for one noun is ambiguous and refused (null) — never resolved by catalogue order.
 * @param {string} noun
 * @param {{manifests?: object[]}} [o]
 */
export function presenterFor(noun, { manifests = allManifests() } = {}) {
  const declared = (manifests ?? []).map((m) => m?.nouns?.[noun]?.presents).filter(Boolean);
  if (declared.length > 1) return null;
  if (declared.length === 1) return presenterFromFacets(declared[0]);
  return ITEM_PRESENTERS[noun] ?? null;
}
