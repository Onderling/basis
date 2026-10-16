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
 * @param {{label?: string, moment?: string, order?: 'asc'|'desc', mine?: string[], done?: {field: string, values?: string[]}}} presents
 * @returns {{label: (row: object) => string, when: (row: object) => number, order: 'asc'|'desc', isMine: (row: object, me: string|null) => boolean, isDone: (row: object) => boolean}}
 */
export function presenterFromFacets(presents = {}) {
  const labelKey = typeof presents.label === 'string' ? presents.label : null;
  const momentKey = typeof presents.moment === 'string' ? presents.moment : null;
  const mine = Array.isArray(presents.mine) ? presents.mine.filter((k) => typeof k === 'string') : [];
  const doneKey = typeof presents.done?.field === 'string' ? presents.done.field : null;
  const doneValues = Array.isArray(presents.done?.values) ? new Set(presents.done.values) : null;
  return {
    label: (r) => String((labelKey ? r?.[labelKey] : '') ?? '').trim() || words(r),
    when: (r) => ms(momentKey ? r?.[momentKey] : undefined) || ms(r?.createdAt ?? r?.ts),
    order: presents.order === 'asc' ? 'asc' : 'desc',
    // a field naming one person, or a list of people (ids or `{webid}`)
    isMine: (r, me) => Boolean(me) && mine.some((k) => {
      const v = r?.[k];
      return Array.isArray(v) ? v.some((x) => (x?.webid ?? x) === me) : v === me;
    }),
    // no longer open: the declared field is set (or holds one of the declared values); nothing declared, never done
    isDone: (r) => {
      if (!doneKey) return false;
      const v = r?.[doneKey];
      return doneValues ? doneValues.has(v) : Boolean(v);
    },
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

/**
 * The nouns whose declared facets satisfy `pred` — how a reading picks what it covers ("scheduled": `order: 'asc'`;
 * "open and mine": `mine` + `done`) without naming one. A noun two manifests declare is ambiguous and left out.
 * @param {(presents: object) => boolean} pred
 * @param {{manifests?: object[]}} [o]
 * @returns {string[]}
 */
export function nounsDeclaring(pred, { manifests = allManifests() } = {}) {
  const count = new Map();
  for (const m of manifests ?? []) for (const [noun, d] of Object.entries(m?.nouns ?? {})) if (d?.presents) count.set(noun, [...(count.get(noun) ?? []), d.presents]);
  return [...count].filter(([, ps]) => ps.length === 1 && pred(ps[0])).map(([noun]) => noun);
}
