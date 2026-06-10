/**
 * canopy-chat v2 — circle settings (web DOM renderer, board 4A).
 *
 * Controlled render of the five policy axes over a `policy`
 * (`@canopy/circlePolicy`). Feature toggles + radio groups fire
 * `onChange(patch)`; the host merges + re-renders + persists via the
 * policy store. Pure render → unit-testable under happy-dom. Each enum
 * option carries a ⓘ button that toggles a "consequences" panel (board
 * 4A ⓘ, slice 1.2b) sourced from `circle.settings.consequence.<opt>`;
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
import { detectPolicyConflicts, applyPolicyResolution } from '../../src/v2/policyConflict.js';
import { renderRecipeConflictResolver } from './recipeConflictResolver.js';

// 5.9a — `view` is the per-circle default-pane axis ('chat' / 'screen' /
// 'cross-stream'); making it editable here lets an admin pick which surface
// a member lands on when they open the circle.  Listed first so it stays
// the most prominent setting.
const ENUM_AXES = ['view', 'llmTool', 'storagePosture', 'agents', 'revealPolicy', 'pod'];

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
  incomingPolicy = null,
  policyStore,
  circleId,
  onIncomingApplied,
  onIncomingDiscarded,
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
  head.textContent = tr('circle.settings.title');
  container.appendChild(head);

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
