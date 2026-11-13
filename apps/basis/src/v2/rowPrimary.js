/**
 * A Vandaag row's ONE action — what a tap on the card's button does. Declared by the row's noun in its manifest
 * (`nouns[noun].presents.primary`: `complete` · `edit` · `open`), so basis never knows a noun by name and a bot's own
 * noun gets its button the moment it declares one:
 *   • complete — the op that completes it (the noun's `complete` capability, bespoke or generic), through the waist,
 *     with the row's id and its circle (an own row: the own scope); a row already done has none;
 *   • edit     — an own row opens the "+" sheet on itself; a circle's row opens its circle;
 *   • open     — a circle's row opens its circle; an own row opens the "+" sheet.
 * The second action stays where it is (the existing more / long-press). One model both shells paint.
 */
import { resolveCapability, encodeGenericOpId } from '@onderling/app-manifest';
import { allManifests } from './manifestSources.js';
import { presenterFromFacets } from './declaredPresenters.js';
import { OWN_DEVICES_SCOPE } from './grantsManifest.js';

/**
 * @param {{id: string, own?: boolean, circleId?: string|null}} row
 * @param {string} noun
 * @param {{manifests?: object[]}} [o]
 * @returns {{kind: 'op', app: string, opId: string, args: object, labelKey: string}
 *   | {kind: 'edit-own', labelKey: string} | {kind: 'open-circle', circleId: string, labelKey: string} | null}
 */
export function primaryActionFor(row, noun, { manifests = allManifests() } = {}) {
  if (!row?.id || !noun) return null;
  const m = (manifests ?? []).find((x) => x?.nouns?.[noun]?.presents?.primary);
  const presents = m?.nouns?.[noun]?.presents;
  const kind = presents?.primary ?? null;
  if (!kind) return null;
  const openCircle = row.circleId ? { kind: 'open-circle', circleId: row.circleId, labelKey: 'circle.vandaag.act_open' } : null;
  const editOwn = row.own ? { kind: 'edit-own', labelKey: 'circle.vandaag.act_edit' } : null;
  if (kind === 'edit') return editOwn ?? openCircle;
  if (kind === 'open') return openCircle ?? editOwn;
  if (kind === 'complete') {
    if (presenterFromFacets(presents).isDone(row)) return null;
    const cap = resolveCapability(m, 'complete', noun);
    const opId = cap.kind === 'op' ? cap.opId : cap.kind === 'generic' ? encodeGenericOpId(m.app, 'complete', noun) : null;
    if (!opId) return null;
    // the row's id goes in the op's own id parameter (bespoke ops name it; a generic atom takes `id`)
    const op = (m.operations ?? []).find((o) => o?.id === opId);
    const idParam = (op?.params ?? []).find((p) => p?.required && /(^id$|Id$)/.test(p?.name ?? ''))?.name ?? 'id';
    return { kind: 'op', app: m.app, opId, args: { [idParam]: row.id, circleId: row.circleId ?? OWN_DEVICES_SCOPE }, labelKey: 'circle.vandaag.act_done' };
  }
  return null;
}

/**
 * A block act that takes a line the person types (a list's add act: `{kind: 'op', app, opId, args, textArg}`), as the
 * dispatch both shells hand their `onAction`: the typed line, trimmed, under `textArg`. An empty line, or an act that
 * names no `textArg`, dispatches nothing (null). One rule both shells call, so neither builds op args itself.
 *
 * @param {{kind: string, app: string, opId: string, args?: object, textArg?: string}|null} act
 * @param {string} text
 * @returns {{kind: 'row-op', op: {app: string, opId: string, args: object}}|null}
 */
export function typedRowOp(act, text) {
  const line = typeof text === 'string' ? text.trim() : '';
  if (!line || act?.kind !== 'op' || typeof act.textArg !== 'string' || !act.textArg) return null;
  return { kind: 'row-op', op: { app: act.app, opId: act.opId, args: { ...(act.args ?? {}), [act.textArg]: line } } };
}
