/**
 * A circle policy change in WORDS: a feature on or off, an axis set to an option (the settings screen's own labels, as
 * locale keys), the rest counted. Pure: the settings screen's proposal line and "Nieuw voor jou"'s setting row read it.
 */
import { SETTINGS_ENUM_AXES } from './circlePolicy.js';

/**
 * What a policy proposal changes, in words: a feature on or off, an axis set to an option (the settings screen's own
 * labels, as locale keys the shell translates in `params`), and the rest counted.
 * @param {object} patch   the proposal's subject (a `policyPatch`)
 * @returns {Array<{key: string, params: object}>}
 */
export function policyChangeLines(patch = {}) {
  const lines = [];
  let other = 0;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'features' && v && typeof v === 'object') {
      for (const [f, on] of Object.entries(v)) lines.push({ key: on ? 'circle.settings.change_on' : 'circle.settings.change_off', params: { whatKey: `circle.settings.feat.${f}` } });
    } else if (SETTINGS_ENUM_AXES.includes(k) && typeof v === 'string') {
      lines.push({ key: 'circle.settings.change_set', params: { whatKey: `circle.settings.${k}`, toKey: `circle.settings.opt.${v}` } });
    } else other += 1;
  }
  if (other) lines.push({ key: 'circle.settings.change_other', params: { n: other } });
  return lines;
}

/** The change lines as one sentence in the viewer's words (`t` the shell's translator). */
export function policyChangeText(lines = [], t = (k) => k) {
  return lines.map((l) => t(l.key, {
    ...l.params,
    ...(l.params?.whatKey ? { what: t(l.params.whatKey) } : {}),
    ...(l.params?.toKey ? { to: t(l.params.toKey) } : {}),
  })).join(', ');
}

/**
 * The patch between two whole policies (two consecutive `policy-update` versions): each feature that flipped, each
 * other axis whose value differs. What `policyChangeLines` puts in words.
 * @param {object} prev
 * @param {object} next
 * @returns {object}
 */
export function policyPatchBetween(prev = {}, next = {}) {
  const patch = {};
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  for (const k of keys) {
    const a = prev?.[k];
    const b = next?.[k];
    if (k === 'features' && (a || b)) {
      const fs = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
      const changed = Object.fromEntries([...fs].filter((f) => Boolean(a?.[f]) !== Boolean(b?.[f])).map((f) => [f, Boolean(b?.[f])]));
      if (Object.keys(changed).length) patch.features = changed;
    } else if (JSON.stringify(a) !== JSON.stringify(b)) patch[k] = b;
  }
  return patch;
}
