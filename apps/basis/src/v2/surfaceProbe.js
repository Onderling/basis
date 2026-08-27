/**
 * surfaceProbe — "what can a person do here, right now", as data.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * A walk needs a surface it can READ. Until now the only machine-drivable surfaces were the DOM (a
 * browser spec clicking `.circle-view__back`) and a hand-assembled node composition that re-derived
 * the shell's wiring and drifted from it. The first is brittle and cannot answer "what am I offered?";
 * the second measures itself — a harness that rebuilds the app cannot tell you the app is broken.
 *
 * Frits, 2026-08-27, after a day where two of my diagnoses turned out to be my harness rather than the
 * product: *"we do have manifests, logs etc"* — the affordances a person sees are ALREADY computed
 * from the manifests. They only needed publishing. So this adds no second source of truth: it calls
 * the same projector the screens call and applies the same capability gate the buttons apply, and
 * returns the result instead of painting it.
 *
 * That is the whole idea of the thin waist made testable. Every surface compiles to `{opId, args}`;
 * this projects the OTHER direction — from the manifests to the list of `{opId, args}` a person is
 * being offered — so a headless walk picks an affordance the way a person does, rather than knowing
 * an op id a screen may not actually offer.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────────────────────────
 * It does not dispatch, own state, or decide anything. A caller pairs it with the shell's existing
 * dispatch seam. And it is not a second renderer: if a button is missing here it is missing on screen,
 * which is exactly the property that makes "the member card offers no actions" a finding rather than
 * a harness artifact.
 */

import { renderWeb, renderAttachments, affordanceTreatment, canonicalAtom } from '@onderling/app-manifest';
import { itemRowButtons } from '@onderling/app-manifest';
import { circleActions } from './actionProjection.js';

/**
 * The gate the shells apply to every affordance, in one place so the probe cannot answer differently
 * from the button. Mirrors `embedButtonsForReply` (replyEmbeds.js) — same helpers, same order.
 *
 * @returns {'allow'|'grey'|'hide'}
 */
function treatmentFor(capabilityMatrix, { appOrigin, verb, noun }) {
  const t = affordanceTreatment(capabilityMatrix, {
    app: appOrigin, atom: verb ? canonicalAtom(verb) : null, noun: noun ?? null,
  });
  return t === 'hide' ? 'hide' : t === 'grey' ? 'grey' : 'allow';
}

/**
 * Every top-level PAGE a manifest projects — the navigation a person has.
 * Uses `renderWeb`'s NavModel, so a page that is not projected is not reachable, and this says so.
 */
function pagesOf(manifest, renderer) {
  const nav = renderer(manifest) ?? {};
  return Array.isArray(nav.pages) ? nav.pages : [];
}

/**
 * The GLOBAL affordances of an app — the ops a person can invoke without first selecting an item.
 * `appliesTo` is what separates the two: an op that declares it is a ROW action (it needs an item to
 * apply to), and one that does not is a standing affordance. Same rule `itemRowButtons` uses, read
 * from the other side, so the two can never disagree about which is which.
 */
function globalActionsOf(manifest, appOrigin, capabilityMatrix) {
  const out = [];
  for (const op of manifest?.operations ?? []) {
    const ui = op?.surfaces?.ui;
    if (!ui) continue;
    if (op.appliesTo) continue;                       // a row action — reported per row instead
    const treatment = treatmentFor(capabilityMatrix, { appOrigin, verb: op.verb, noun: null });
    if (treatment === 'hide') continue;
    out.push({
      appOrigin,
      opId:    op.id,
      label:   ui.label ?? op.id,
      control: ui.control ?? null,
      ...(op.params?.some((p) => p?.required) ? { needsArgs: true } : {}),
      ...(ui.confirm ? { confirms: ui.confirm.severity ?? true } : {}),
      ...(treatment === 'grey' ? { disabled: true } : {}),
    });
  }
  return out;
}

/**
 * Project the surface a person is looking at into data.
 *
 * @param {object} o
 * @param {Record<string, object>} [o.manifestsByOrigin] `{appOrigin → manifest}` — the composed set the
 *   shell already holds (`circleManifestsByOrigin`).
 * @param {Array} [o.capabilityMatrix] the member's effective capabilities; affordances are gated by it
 *   exactly as the screens gate them. Empty ⇒ nothing is greyed or hidden.
 * @param {Array<object>} [o.items] the rows in front of the person, if any. Each is reported with the
 *   row actions its type actually earns.
 * @param {object} [o.where] free-form location — `{circleId, screen}` — echoed back so a walk log says
 *   where it was standing when it read this.
 * @param {object} [o.navManifest] the manifest carrying the circle's `actions` roster (basis). Given it,
 *   the ⋯ menu is reported too — the navigation a person has, as opposed to the ops they can invoke.
 * @param {*} [o.policy] the circle policy, so a `requires`-gated action is reported only where it shows.
 * @param {string[]|null} [o.wiredActionIds] the action ids the HOST actually wired a callback for. An
 *   action that is projected but unwired is not on screen, so it is not reported — over-reporting is the
 *   one error this seam must never make, since a walk would then call an affordance nobody has.
 * @param {string} [o.platform]
 * @param {Function} [o.renderer] the projector; `renderMobile` is `renderWeb`, so this seam serves both.
 * @returns {{where: object, apps: string[], pages: object[], actions: object[], nav: object[],
 *            attach: object[], rows: object[]}}
 */
export function probeSurface({
  manifestsByOrigin = {},
  capabilityMatrix = [],
  items = [],
  where = {},
  navManifest = null,
  policy = null,
  wiredActionIds = null,
  platform = 'web',
  renderer = renderWeb,
} = {}) {
  const apps = Object.keys(manifestsByOrigin ?? {}).sort();
  const pages = [];
  const actions = [];
  for (const appOrigin of apps) {
    const manifest = manifestsByOrigin[appOrigin];
    for (const p of pagesOf(manifest, renderer)) pages.push({ appOrigin, ...p });
    actions.push(...globalActionsOf(manifest, appOrigin, capabilityMatrix));
  }

  const rows = [];
  for (const item of items ?? []) {
    const rowActions = [];
    for (const appOrigin of apps) {
      for (const b of itemRowButtons(manifestsByOrigin[appOrigin], item)) {
        const verb = manifestsByOrigin[appOrigin]?.operations?.find((o) => o?.id === b.opId)?.verb;
        const treatment = treatmentFor(capabilityMatrix, { appOrigin, verb, noun: item?.type });
        if (treatment === 'hide') continue;
        rowActions.push({ appOrigin, opId: b.opId, label: b.label, ...(treatment === 'grey' ? { disabled: true } : {}) });
      }
    }
    rows.push({
      id:    item?.id ?? null,
      type:  item?.type ?? null,
      label: item?.label ?? item?.text ?? null,
      actions: rowActions,
    });
  }

  // The composer's ATTACH menu — Card · File · Appointment, projected by `renderAttachments` from the
  // same manifests. It belongs here because it is an affordance a person taps and the walk found it
  // dead-ending: both entries answered "I couldn't turn that into an action", and the probe had no way
  // to say what they even were. Each entry names the op behind it, so a walk can check that the op
  // exists and what it needs rather than guessing from a label.
  const attach = [];
  for (const appOrigin of apps) {
    let menu = [];
    try { menu = renderAttachments(manifestsByOrigin[appOrigin])?.attachMenu ?? []; } catch { menu = []; }
    for (const entry of menu) {
      const op = (manifestsByOrigin[appOrigin]?.operations ?? []).find((o) => o?.id === entry.opId) ?? null;
      attach.push({
        appOrigin,
        ...entry,
        // What a tap will need before it can do anything — the walk's "why did this dead-end?".
        ...(op?.params?.some((pr) => pr?.required) ? { needsArgs: op.params.filter((pr) => pr?.required).map((pr) => pr.name) } : {}),
        ...(op ? {} : { missingOp: true }),
      });
    }
  }

  // The ⋯ roster: projected from the manifest, gated by policy/platform, then narrowed to what the
  // host actually wired. Both halves are required for the report to match the screen — `collectMoreActions`
  // in the web shell applies exactly this pair, and mobile projects the same roster.
  const wired = Array.isArray(wiredActionIds) ? new Set(wiredActionIds) : null;
  const nav = navManifest
    ? circleActions(navManifest, { policy, platform, renderer })
        .filter((a) => (wired ? wired.has(a.id) : true))
        .map((a) => ({ id: a.id, labelKey: a.labelKey ?? null, target: a.target ?? null }))
    : [];

  return { where: { ...where }, apps, pages, actions, nav, attach, rows };
}

export default probeSurface;
