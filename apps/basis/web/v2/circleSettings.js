/**
 * basis v2 — circle settings (web DOM renderer).
 *
 * Controlled render of the five policy axes over a `policy`
 * (`@onderling/circlePolicy`). Feature toggles + radio groups fire
 * `onChange(patch)`; the host merges + re-renders + persists via the
 * policy store. Pure render → unit-testable under happy-dom. Each enum
 * option carries a ⓘ button that toggles a "consequences" panel (board
 * 4A ⓘ,) sourced from `circle.settings.consequence.<opt>`;
 * the ⓘ only appears when a consequence string is actually translated.
 *
 * γ.4 — conflict resolution for the circle policy.  When `incomingPolicy`
 * is non-null (the source plumbing — peer broadcast / pod-sync — is
 * deferred to a later slice; today every existing call site passes
 * none of the γ.4 opts and the renderer behaves exactly as before),
 * the editor runs a 3-way diff against the last captured version
 * (γ.2) and — if conflicts surface — overlays the SAME modal as
 * recipes (with a settings-namespaced heading via the resolver's
 * `title` opt).
 */
import { CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS } from '../../src/v2/circlePolicy.js';
import { renderThemeToggle } from './themeToggle.js';
// Phase 4 §9 — the settings-surface CONTROLS + the `enabledWhen` fold (route × capability).
import { resolveControlEnablement } from '../../src/v2/circleSettingsControls.js';
import { DEFAULT_CIRCLE_ORIGINS } from '../../src/v2/circleSources.js';   // S6.C — composable apps
// the manifest-driven settings form + the per-skill freedom matrix (rulings).
import { buildSettingsForm, buildCapabilityMatrix, FREEDOM_LEVELS, OPT_OUT_CONSEQUENCES } from '@onderling/app-manifest';
import { detectPolicyConflicts, applyPolicyResolution } from '../../src/v2/policyConflict.js';
import { renderRecipeConflictResolver } from './recipeConflictResolver.js';
import { renderPairedDevices } from './pairedDevices.js';
// B · consent-card — REVIEWED recipe apply: load → show the consent card → Agree/Decline (no silent apply).
import { renderRecipeConsentCard } from './recipeConsentCard.js';
// D / consumer-switch — the settings header label is sourced from the
// manifest PAGE projection (`renderWeb(manifest).pages[].labelKey`) via t(),
// not a hardcoded tr('circle.settings.title') call.  Pure selector in shared src.
import { pageLabel } from '../../src/v2/pageProjection.js';

// 5.9a — `view` is the per-circle default-pane axis ('chat' / 'screen' /
// 'cross-stream'); making it editable here lets an admin pick which surface
// a member lands on when they open the circle.  Listed first so it stays
// the most prominent setting.
// Exported so the locale-coverage fitness guard (test/v2/circleLocaleCoverage.test.js)
// asserts every rendered axis + its options resolve — no raw i18n keys reach a surface.
// `sharePosture` sits right after `storagePosture`: both are the circle's
// content-boundary axes (at-rest vs. shared-out). It reuses the SAME generic
// radio/consequence renderer below — no bespoke control (see CIRCLE_POLICY_ENUMS.sharePosture).
export const ENUM_AXES = ['view', 'llmTool', 'storagePosture', 'sharePosture', 'agents', 'revealPolicy', 'pod'];

/**
 * @param {HTMLElement} container
 * @param {object} args
 * @param {object} args.policy
 * @param {Function} args.t
 * @param {Function} [args.onChange]
 * @param {Function} [args.onBack]
 * @param {Function} [args.onSave]
 * @param {string} [args.saveLabel]
 * @param {string} [args.note]
 *
 * γ.4 — additive conflict-resolver opts (see file header).  Existing
 * call sites that pass NONE of these get pre-γ.4 behaviour bit-for-bit.
 * @param {object|null} [args.incomingPolicy]   Incoming policy doc.
 * @param {object} [args.policyStore]           γ.2 store — for listVersions + update.
 * @param {string} [args.circleId]              Required when incomingPolicy is non-null.
 * @param {Function} [args.onIncomingApplied]   (mergedPolicy) => void
 * @param {Function} [args.onIncomingDiscarded] () => void
 */
export function renderCircleSettings(container, {
  policy, t, onChange, onBack, onSave, saveLabel, note,
  // Display theme — surfaced HERE as well as in "Mijn gegevens", where nobody looked for it (2026-07-22
  // demo feedback). Same shared renderer, so the two can't drift; absent deps ⇒ the block is simply omitted.
  themePref, onSetTheme,
  incomingPolicy = null,
  policyStore,
  circleId,
  onIncomingApplied,
  onIncomingDiscarded,
  onGuidedSetup,   // Theme B — open the guided-setup chatbot (pre-fills these fields)
  // B #64 — apply an AUTHORED REMOTE recipe (URL/JSON) as this circle's active policy. Host wires the
  // async load+apply (shared `loadAndApplyRecipe`); the shell only collects the source + shows a status.
  onApplyRecipe,
  // B · consent-card — REVIEW seam (shared `loadRecipeForReview`): (source) => { ok, model, recipe } | { ok:false, message }.
  // When wired, applying a recipe first shows the consent card; onApplyRecipe(source, { declinedKeys, recipe, model })
  // is called only on Agree, with the user's declined optional caps.
  onReviewRecipe,
  // the merged manifest sources; when present, render the manifest-driven settings form
  // the per-skill freedom matrix (rulings). Absent ⇒ those sections don't render (older callers).
  sources = [],
  // OBJ-2 — paired devices (no-pod sync). Host wires these when household sync is available.
  householdSelfAddr = null,
  householdPeers = [],
  onAddHouseholdPeer,
  onRemoveHouseholdPeer,
  // D / consumer-switch — the projected PAGE surface for this settings
  // op (`renderWeb(manifest).pages[]` entry, selected via pageForOp).  When
  // present, the header label is derived from `page.labelKey` via t,
  // making this a genuine runtime consumer of the manifest projection.  Absent
  // (older callers / tests) ⇒ the header falls back to tr('circle.settings.title')
  // bit-for-bit, so nothing regresses.
  settingsPage = null,
  // Phase 4 §9 — the manifest `settings` op controls (transport-mode · relay endpoint ·
  // private-DM) + the device transport state the `enabledWhen` fold reads. Absent (older
  // callers / tests) ⇒ the Connection section doesn't render (nothing regresses). Device-scoped
  // controls dispatch through `onControl(opId, args)`; the circle-policy toggle emits like the rest.
  controls = [],
  transport = null,
  onControl,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-settings');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-settings__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-settings__title';
  // D / consumer-switch — label FROM the manifest projection: the
  // settings op's `surfaces.page.labelKey`, projected by renderWeb, resolved
  // through t. Falls back to the raw page.title, then to the
  // pre-existing tr('circle.settings.title') when no projected page is passed.
  head.textContent = pageLabel(settingsPage, tr, tr('circle.settings.title'));
  container.appendChild(head);

  // Theme B — a chat-guided setup that walks you through the basics, then hands
  // off to these toggles (pre-filled). Opt-in; the manual form below always works.
  if (typeof onGuidedSetup === 'function') {
    const guided = document.createElement('button');
    guided.type = 'button';
    guided.className = 'circle-settings__guided';
    guided.textContent = tr('circle.guided.button');
    guided.addEventListener('click', () => onGuidedSetup());
    container.appendChild(guided);
  }

  // B #64 + consent-card — apply an authored remote recipe. Opt-in; the manual form still works.
  // When `onReviewRecipe` is wired (production), applying a recipe is a REVIEWED action: load → show the
  // consent card (what it would enable + opt-out checkboxes) → on Agree apply, on Decline nothing. A caller
  // that wires ONLY `onApplyRecipe` (no review seam) keeps the older immediate-apply behaviour.
  if (typeof onReviewRecipe === 'function' || typeof onApplyRecipe === 'function') {
    const sec = section(tr('circle.recipeApply.heading'));
    sec.classList.add('circle-settings__recipe');
    const input = document.createElement('textarea');
    input.className = 'circle-settings__recipe-source';
    input.dataset.role = 'recipe-source';
    input.rows = 2;
    input.placeholder = tr('circle.recipeApply.placeholder');
    const status = document.createElement('div');
    status.className = 'circle-settings__recipe-status';
    status.dataset.role = 'recipe-status';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'circle-settings__recipe-apply';
    apply.textContent = tr('circle.recipeApply.apply');
    apply.addEventListener('click', async () => {
      const src = (input.value || '').trim();
      if (!src) return;
      apply.disabled = true;
      status.textContent = '';
      try {
        if (typeof onReviewRecipe === 'function') {
          // REVIEWED path: load + build the review model, then show the consent card. Nothing is applied
          // until the user Agrees; Agree flows through the host's onApplyRecipe with the declined opt-outs.
          const res = await onReviewRecipe(src);
          if (!res || res.ok === false || !res.model) {
            status.textContent = (res && typeof res.message === 'string' && res.message) || tr('circle.recipeApply.error');
          } else {
            renderRecipeConsentCard(res.model, {
              t: tr,
              onDecline: () => { status.textContent = tr('circle.recipeConsent.declined'); },
              onAgree: async ({ declinedKeys }) => {
                apply.disabled = true;
                try {
                  const msg = await onApplyRecipe(src, { declinedKeys, recipe: res.recipe, model: res.model });
                  if (typeof msg === 'string' && msg) status.textContent = msg;
                } catch { status.textContent = tr('circle.recipeApply.error'); }
                finally { apply.disabled = false; }
              },
            });
          }
        } else {
          // Fallback (older callers): immediate apply, no review card.
          const msg = await onApplyRecipe(src);
          if (typeof msg === 'string' && msg) status.textContent = msg;
        }
      } catch { status.textContent = tr('circle.recipeApply.error'); }
      finally { apply.disabled = false; }
    });
    sec.append(input, apply, status);
    container.appendChild(sec);
  }

  // Axis 1 — features (toggles)
  const featSection = section(tr('circle.settings.features'));
  for (const f of CIRCLE_FEATURES) {
    const row = document.createElement('label');
    row.className = 'circle-settings__feature';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!policy?.features?.[f];
    box.dataset.feature = f;
    box.addEventListener('change', () => emit({ features: { [f]: box.checked } }));
    const span = document.createElement('span');
    span.textContent = tr(`circle.settings.feat.${f}`);
    row.append(box, span);
    featSection.appendChild(row);
  }
  container.appendChild(featSection);

  // S6.C deep — Apps: which whole apps this circle composes into the bot's tools +
  // slash-suggest. Unset (all checked) = all 5; unchecking narrows the catalog.
  const appsSection = section(tr('circle.settings.apps'));
  const enabledApps = Array.isArray(policy?.apps) && policy.apps.length ? new Set(policy.apps) : null;
  for (const app of DEFAULT_CIRCLE_ORIGINS) {
    const row = document.createElement('label');
    row.className = 'circle-settings__app';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = enabledApps ? enabledApps.has(app) : true;   // unset → all composed
    box.dataset.app = app;
    box.addEventListener('change', () => {
      const apps = [...appsSection.querySelectorAll('input[data-app]')]
        .filter((b) => b.checked).map((b) => b.dataset.app);
      emit({ apps });
    });
    const span = document.createElement('span');
    span.textContent = tr(`circle.settings.app.${app}`);
    row.append(box, span);
    appsSection.appendChild(row);
  }
  container.appendChild(appsSection);

  // Axes 2-5 — single-choice radio groups
  for (const axis of ENUM_AXES) {
    const sec = section(tr(`circle.settings.${axis}`));
    sec.classList.add('circle-settings__axis');
    sec.dataset.axis = axis;
    for (const opt of CIRCLE_POLICY_ENUMS[axis]) {
      const row = document.createElement('div');
      row.className = 'circle-settings__opt-row';

      const label = document.createElement('label');
      label.className = 'circle-settings__opt';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = axis;
      radio.value = opt;
      radio.checked = policy?.[axis] === opt;
      radio.addEventListener('change', () => { if (radio.checked) emit({ [axis]: opt }); });
      const span = document.createElement('span');
      span.textContent = tr(`circle.settings.opt.${opt}`);
      label.append(radio, span);
      row.appendChild(label);

      addConsequence(row, tr, opt);
      sec.appendChild(row);
    }
    container.appendChild(sec);
  }

  // Consensus toggle (a circlePolicy boolean — gates co-admin approval).
  const consSec = section(tr('circle.settings.consensus'));
  consSec.classList.add('circle-settings__consensus');
  const consRow = document.createElement('label');
  consRow.className = 'circle-settings__consensus-toggle';
  const consBox = document.createElement('input');
  consBox.type = 'checkbox';
  consBox.checked = !!policy?.consensusRequired;
  consBox.dataset.field = 'consensusRequired';
  consBox.addEventListener('change', () => emit({ consensusRequired: consBox.checked }));
  const consSpan = document.createElement('span');
  consSpan.textContent = tr('circle.settings.consensus_label');
  consRow.append(consBox, consSpan);
  consSec.appendChild(consRow);
  container.appendChild(consSec);

  // Phase 4 §9 — the Connection & transport controls (manifest-declared). Rendered only when
  // the host wires them; the `enabledWhen` fold greys out incompatible options (route × capability).
  if (Array.isArray(controls) && controls.length) {
    renderConnectionControls(container, { controls, policy, transport, tr, emit, onControl });
  }

  // manifest-driven per-app SETTINGS form. Values live in policy.settings keyed
  // "<app>.<key>"; emit writes them back. Only apps that declare circle-scope settings render a block.
  if (Array.isArray(sources) && sources.length) {
    const forms = sources
      .map((s) => ({ app: s?.manifest?.app, fields: buildSettingsForm(s?.manifest, { scope: 'circle', values: settingValuesForApp(policy, s?.manifest?.app) }) }))
      .filter((f) => f.app && f.fields.length);
    renderSettingsSection(container, { forms, tr, emit });

    // the per-skill FREEDOM matrix over the (verb×noun) capabilities of the enabled
    // apps, merged with the admin freedom template (policy.capabilities). This is what the gate enforces.
    const enabledApps = Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null;
    const matrix = buildCapabilityMatrix(sources, { enabledApps, template: policy?.capabilities || {} });
    renderCapabilitiesSection(container, { matrix, tr, emit });
  }

  // OBJ-2 — paired devices (no-pod sync). Shown only when the host wires it (household
  // sync available for this circle): this device's address + add/remove peers by address.
  if (householdSelfAddr && typeof onAddHouseholdPeer === 'function') {
    const pairedSec = section(tr('circle.pairedDevices.title'));
    pairedSec.classList.add('circle-settings__paired');
    const mount = document.createElement('div');
    renderPairedDevices(mount, {
      selfAddr: householdSelfAddr,
      peers:    householdPeers,
      t:        tr,
      onAdd:    onAddHouseholdPeer,
      onRemove: onRemoveHouseholdPeer,
    });
    pairedSec.appendChild(mount);
    container.appendChild(pairedSec);
  }

  if (note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'circle-settings__note';
    noteEl.textContent = note;
    container.appendChild(noteEl);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-settings__save';
  save.textContent = saveLabel || tr('circle.settings.save');
  save.addEventListener('click', () => { if (typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  // Per-DEVICE display preference — after the save button on purpose: it is not part of the policy document
  // and applies instantly, so it must not read as something the Save button commits.
  appendThemeSection(container, { tr, themePref, onSetTheme });

  // γ.4 — conflict resolver.  Opt-in via `incomingPolicy`.  When set, we
  // fetch the latest captured version (γ.2 versions adapter) through
  // `policyStore` + `circleId`, run the 3-way diff, and — if anything
  // diverges — overlay the SAME modal used by the recipe editor with a
  // settings-namespaced heading.  Detection is async because
  // `policyStore.listVersions(...)` may need IO.
  if (incomingPolicy != null) {
    maybeRenderPolicyConflict(container, {
      policy, incomingPolicy, policyStore, circleId, tr,
      onIncomingApplied, onIncomingDiscarded,
    });
  }
  return container;
}

/**
 * γ.4 — fetch last captured version, detect, maybe modal.  Apply path
 * persists via `policyStore.update` (which already runs version capture
 * + the deep-merge); cancel just drops the overlay.
 */
async function maybeRenderPolicyConflict(container, {
  policy, incomingPolicy, policyStore, circleId, tr,
  onIncomingApplied, onIncomingDiscarded,
}) {
  let base = null;
  try {
    if (policyStore && typeof policyStore.listVersions === 'function' && circleId) {
      const versions = await policyStore.listVersions(circleId);
      const head = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
      base = head && typeof head === 'object' && head.value != null ? head.value : null;
    }
  } catch { /* best-effort */ }

  const report = detectPolicyConflicts(policy, incomingPolicy, base);
  if (report.identical
      || (report.blockConflicts.length === 0 && report.metaConflicts.length === 0)) {
    const merged = applyPolicyResolution(policy, incomingPolicy, {});
    await persistMergedPolicy({ policyStore, circleId, merged });
    if (typeof onIncomingApplied === 'function') onIncomingApplied(merged);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'circle-settings__conflict-overlay';
  container.appendChild(overlay);

  renderRecipeConflictResolver(overlay, {
    conflicts: report,
    local: policy,
    incoming: incomingPolicy,
    t: tr,
    title: 'circle.settings.conflict.title',
    onResolve: async (decisions) => {
      try {
        const merged = applyPolicyResolution(policy, incomingPolicy, decisions);
        await persistMergedPolicy({ policyStore, circleId, merged });
        if (typeof onIncomingApplied === 'function') onIncomingApplied(merged);
      } finally {
        overlay.remove();
      }
    },
    onCancel: () => {
      overlay.remove();
      if (typeof onIncomingDiscarded === 'function') onIncomingDiscarded();
    },
  });
}

async function persistMergedPolicy({ policyStore, circleId, merged }) {
  if (!policyStore || typeof policyStore.update !== 'function' || !circleId) return;
  try { await policyStore.update(circleId, merged); } catch { /* best-effort */ }
}

/**
 * Append a ⓘ toggle + collapsed consequence panel to an option row, but
 * only when `circle.settings.consequence.<opt>` resolves to real copy
 * (t() echoes the key on a miss → no ⓘ for options without guidance).
 */
function addConsequence(row, tr, opt) {
  const key = `circle.settings.consequence.${opt}`;
  const text = tr(key);
  if (!text || text === key) return;

  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'circle-settings__info';
  info.dataset.opt = opt;
  info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-label', tr('circle.settings.consequence_aria'));
  info.textContent = 'ⓘ';

  const panel = document.createElement('div');
  panel.className = 'circle-settings__consequence';
  panel.dataset.opt = opt;
  panel.hidden = true;
  panel.textContent = text;

  info.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    info.setAttribute('aria-expanded', String(!panel.hidden));
  });

  row.append(info, panel);
}

function section(title) {
  const sec = document.createElement('section');
  sec.className = 'circle-settings__section';
  const h = document.createElement('h3');
  h.className = 'circle-settings__section-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

/**
 * Phase 4 §9 — render the manifest `settings` controls (transport-mode · relay endpoint ·
 * private-DM) under one "Connection & transport" section. The `enabledWhen` fold
 * (`resolveControlEnablement`, reusing C9's data-policy) decides which controls/options grey
 * out per the §7 route × capability matrix — pod-only greys the private-DM toggle; a relay-less
 * route greys the relay/both transport options. Device-scoped controls dispatch through
 * `onControl(opId, args)`; the circle-policy toggle emits like the rest of the panel.
 */
function renderConnectionControls(container, { controls, policy, transport, tr, emit, onControl }) {
  const enable = resolveControlEnablement(controls, { policy, transport });
  const dispatch = typeof onControl === 'function' ? onControl : () => {};
  const sec = section(tr('circle.settings.connection'));
  sec.classList.add('circle-settings__connection');

  for (const ctl of controls) {
    const state = enable[ctl.id] || { enabled: true };
    const row = document.createElement('div');
    row.className = 'circle-settings__control';
    row.dataset.control = ctl.id;
    if (!state.enabled) row.dataset.disabled = 'true';

    if (ctl.kind === 'choice') {
      const lab = document.createElement('div');
      lab.className = 'circle-settings__control-label';
      lab.textContent = tr(ctl.labelKey);
      row.appendChild(lab);
      const current = transport && transport.mode ? transport.mode : (ctl.of && ctl.of[0]);
      for (const opt of (ctl.of || [])) {
        const optState = (state.options && state.options[opt]) || { enabled: true };
        const orow = document.createElement('label');
        orow.className = 'circle-settings__control-opt';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `ctl-${ctl.id}`;
        radio.value = opt;
        radio.checked = current === opt;
        radio.disabled = !state.enabled || !optState.enabled;
        if (radio.disabled) orow.dataset.disabled = 'true';
        radio.addEventListener('change', () => { if (radio.checked) dispatch(ctl.opId, { [ctl.arg]: opt }); });
        const span = document.createElement('span');
        span.textContent = ctl.optLabelPrefix ? tr(`${ctl.optLabelPrefix}.${opt}`) : opt;
        orow.append(radio, span);
        row.appendChild(orow);
      }
    } else if (ctl.kind === 'text') {
      const lab = document.createElement('label');
      lab.className = 'circle-settings__control-label';
      lab.textContent = tr(ctl.labelKey);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'circle-settings__control-input';
      input.dataset.role = 'control-input';
      input.placeholder = tr('circle.settings.relayEndpoint_placeholder');
      input.value = (transport && typeof transport.relayUrl === 'string') ? transport.relayUrl : '';
      input.disabled = !state.enabled;
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'circle-settings__control-apply';
      apply.textContent = tr('circle.settings.relayEndpoint_apply');
      apply.disabled = !state.enabled;
      apply.addEventListener('click', () => dispatch(ctl.opId, { [ctl.arg]: input.value.trim() }));
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'circle-settings__control-clear';
      clear.textContent = tr('circle.settings.relayEndpoint_clear');
      clear.disabled = !state.enabled;
      clear.addEventListener('click', () => { input.value = ''; dispatch(ctl.opId, { clear: true }); });
      row.append(lab, input, apply, clear);
    } else {   // toggle → a circle-policy field (emit), route-gated by enabledWhen.
      const wrap = document.createElement('label');
      wrap.className = 'circle-settings__control-toggle';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.field = ctl.policyField;
      box.checked = !!(policy && policy[ctl.policyField]);
      box.disabled = !state.enabled;
      box.addEventListener('change', () => emit({ [ctl.policyField]: box.checked }));
      const span = document.createElement('span');
      span.textContent = tr(ctl.labelKey);
      wrap.append(box, span);
      row.appendChild(wrap);
      // When route-disabled, surface WHY (the §7 rule) instead of a silent grey checkbox.
      if (!state.enabled && ctl.disabledHintKey) {
        const why = document.createElement('div');
        why.className = 'circle-settings__control-why';
        why.textContent = tr(ctl.disabledHintKey);
        row.appendChild(why);
      }
    }

    if (ctl.hintKey) {
      const hint = document.createElement('div');
      hint.className = 'circle-settings__control-hint';
      hint.textContent = tr(ctl.hintKey);
      row.appendChild(hint);
    }
    sec.appendChild(row);
  }
  container.appendChild(sec);
}

/** The `policy.settings` values for one app: entries keyed "<app>.<key>" → `{ key: value }`. */
function settingValuesForApp(policy, app) {
  const out = {};
  const all = (policy && typeof policy.settings === 'object' && policy.settings) || {};
  const prefix = `${app}.`;
  for (const [k, v] of Object.entries(all)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}

/** render the manifest-driven per-app settings form; emit `{settings:{"<app>.<key>":v}}`. */
function renderSettingsSection(container, { forms, tr, emit }) {
  if (!forms.length) return;
  const sec = section(tr('circle.settings.appSettings'));
  sec.classList.add('circle-settings__app-settings');
  for (const { app, fields } of forms) {
    const appHead = document.createElement('h4');
    appHead.className = 'circle-settings__subhead';
    appHead.textContent = tr(`circle.settings.app.${app}`, { defaultValue: app });
    sec.appendChild(appHead);
    for (const f of fields) {
      const key = `${app}.${f.key}`;
      const row = document.createElement('label');
      row.className = 'circle-settings__setting';
      row.dataset.setting = key;
      const span = document.createElement('span');
      span.textContent = f.label + (f.required ? ' *' : '');
      let input;
      if (f.control === 'toggle') {
        input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!f.value;
        input.addEventListener('change', () => emit({ settings: { [key]: input.checked } }));
      } else if (f.control === 'choice') {
        input = document.createElement('select');
        for (const c of (f.choices || [])) { const o = document.createElement('option'); o.value = c; o.textContent = c; o.selected = f.value === c; input.appendChild(o); }
        input.addEventListener('change', () => emit({ settings: { [key]: input.value } }));
      } else if (f.control === 'number') {
        input = document.createElement('input'); input.type = 'number'; input.value = f.value ?? '';
        input.addEventListener('change', () => emit({ settings: { [key]: input.value === '' ? undefined : Number(input.value) } }));
      } else {   // text | member
        input = document.createElement('input'); input.type = 'text'; input.value = f.value ?? '';
        input.addEventListener('change', () => emit({ settings: { [key]: input.value } }));
      }
      input.dataset.role = 'setting-input';
      if (f.hint) input.title = f.hint;
      row.append(span, input);
      sec.appendChild(row);
    }
  }
  container.appendChild(sec);
}

/**
 * the per-skill FREEDOM matrix. Per capability: an `enabled` toggle, a
 * required/optional freedom select (locked to optional on a privacy-floor row), and an opt-out
 * consequence select (greyed/hidden/limited). Each change emits the FULL row under its key so the
 * stored template is self-contained.
 */
function renderCapabilitiesSection(container, { matrix, tr, emit }) {
  if (!matrix.length) return;
  const sec = section(tr('circle.settings.capabilities'));
  sec.classList.add('circle-settings__capabilities');

  const byApp = new Map();
  for (const row of matrix) { if (!byApp.has(row.app)) byApp.set(row.app, []); byApp.get(row.app).push(row); }

  for (const [app, rows] of byApp) {
    const appHead = document.createElement('h4');
    appHead.className = 'circle-settings__subhead';
    appHead.textContent = tr(`circle.settings.app.${app}`, { defaultValue: app });
    sec.appendChild(appHead);

    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'circle-settings__cap-row';
      el.dataset.cap = row.key;
      const base = () => ({ enabled: row.enabled, freedom: row.freedom, consequence: row.consequence, privacyFloor: row.privacyFloor });

      const enWrap = document.createElement('label');
      const en = document.createElement('input');
      en.type = 'checkbox'; en.checked = row.enabled; en.dataset.role = 'enabled';
      en.addEventListener('change', () => emit({ capabilities: { [row.key]: { ...base(), enabled: en.checked } } }));
      const enSpan = document.createElement('span');
      enSpan.textContent = `${tr(`circle.settings.verb.${row.atom}`, { defaultValue: row.atom })} · ${row.noun}`;
      enWrap.append(en, enSpan);
      el.appendChild(enWrap);

      const freeSel = document.createElement('select');
      freeSel.dataset.role = 'freedom';
      freeSel.disabled = row.privacyFloor || !row.enabled;   // floor → always optional; disabled cap → n/a
      for (const lvl of FREEDOM_LEVELS) { const o = document.createElement('option'); o.value = lvl; o.textContent = tr(`circle.settings.freedom.${lvl}`); o.selected = row.freedom === lvl; freeSel.appendChild(o); }
      freeSel.addEventListener('change', () => emit({ capabilities: { [row.key]: { ...base(), freedom: freeSel.value } } }));
      el.appendChild(freeSel);

      const consSel = document.createElement('select');
      consSel.dataset.role = 'consequence';
      consSel.disabled = !row.enabled || row.freedom === 'required';   // consequence only bites when opt-outable
      for (const c of OPT_OUT_CONSEQUENCES) { const o = document.createElement('option'); o.value = c; o.textContent = tr(`circle.settings.consequence_opt.${c}`); o.selected = row.consequence === c; consSel.appendChild(o); }
      consSel.addEventListener('change', () => emit({ capabilities: { [row.key]: { ...base(), consequence: consSel.value } } }));
      el.appendChild(consSel);

      if (row.privacyFloor) {
        const floor = document.createElement('span');
        floor.className = 'circle-settings__cap-floor';
        floor.textContent = tr('circle.settings.privacyFloor');
        el.appendChild(floor);
      }
      sec.appendChild(el);
    }
  }
  container.appendChild(sec);
}

/**
 * Display theme (systeem / licht / donker) — a per-DEVICE preference, so it sits apart from the circle's
 * policy fields above and is never part of the saved policy document. Rendered through the shared
 * `renderThemeToggle`, identical to the one in "Mijn gegevens".
 */
function appendThemeSection(container, { tr, themePref, onSetTheme }) {
  if (typeof onSetTheme !== 'function') return;
  const sec = document.createElement('section');
  sec.className = 'circle-settings__section circle-settings__section--theme';
  const h = document.createElement('h3');
  h.className = 'circle-settings__section-title';
  h.textContent = tr('circle.mydata.theme');
  sec.appendChild(h);
  const hint = document.createElement('p');
  hint.className = 'circle-settings__hint';
  hint.textContent = tr('circle.settings.theme_hint');
  sec.appendChild(hint);
  renderThemeToggle(sec, { themePref, onSetTheme, t: tr });
  container.appendChild(sec);
}
