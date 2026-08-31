/**
 * basis v2 — circle rules editor (web DOM renderer).
 *
 * The six governance questions as a single editable form over a rules
 * document; required questions (purpose + agreements) gate Save. A
 * "preview" action shows the assembled document as a joiner would consent
 * to it. Controlled render: the host passes `doc` + handlers + `t`, merges
 * `onChange` patches, re-renders, and persists on `onSave`.
 *
 * γ.4 — conflict resolution for rules.  When `incomingRules` is non-null
 * (the source plumbing — peer broadcast / pod-sync — is deferred to a
 * later slice; today every existing call site passes none of the γ.4
 * opts and the editor behaves exactly as before), the editor runs a
 * 3-way diff against the last captured version (γ.2) and — if conflicts
 * surface — overlays the SAME modal as recipes (with a rules-namespaced
 * heading via the resolver's `title` opt).
 */
import { RULES_QUESTIONS, isRulesComplete } from '../../src/v2/circleRules.js';
import { detectRulesConflicts, applyRulesResolution, decisionsForMerges } from '../../src/v2/rulesConflict.js';
import { renderRecipeConflictResolver } from './recipeConflictResolver.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

// 5.5d — `onPreview` removed: the join wizard now inlines the consent
// rendering from the same doc, so a separate preview-as-joiner button
// on the editor is redundant (admin previews by joining a test invite).
/**
 * @param {HTMLElement} container
 * @param {object} args
 * @param {object} args.doc
 * @param {Function} args.t
 * @param {Function} [args.onChange]
 * @param {Function} [args.onBack]
 * @param {Function} [args.onSave]
 *
 * γ.4 — additive conflict-resolver opts (see file header).  Existing
 * call sites that pass NONE of the γ.4 opts get pre-γ.4 behaviour
 * bit-for-bit.
 * @param {object|null} [args.incomingRules]    Incoming rules doc.
 * @param {object} [args.rulesStore]            γ.2 store — for listVersions + set.
 * @param {string} [args.circleId]              Required when incomingRules is non-null.
 * @param {Function} [args.onIncomingApplied]   (mergedDoc) => void
 * @param {Function} [args.onIncomingDiscarded] () => void
 */
export function renderRulesEditor(container, {
  doc = {}, t, onChange, onBack, onSave,
  incomingRules = null,
  rulesStore,
  circleId,
  onIncomingApplied,
  onIncomingDiscarded,
} = {}) {
  const tr = translatorOr(t, 'circleRulesEditor.js');
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-rules');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-rules__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-rules__title';
  head.textContent = tr('circle.rules.title');
  container.appendChild(head);

  for (const q of RULES_QUESTIONS) {
    const field = document.createElement('label');
    field.className = 'circle-rules__field';
    field.dataset.field = q.key;
    if (q.required) field.dataset.required = 'true';

    const label = document.createElement('span');
    label.className = 'circle-rules__q';
    label.textContent = tr(`circle.rules.q.${q.key}`) + (q.required ? ' *' : '');
    field.appendChild(label);

    const area = document.createElement('textarea');
    area.className = 'circle-rules__input';
    area.dataset.field = q.key;
    area.value = doc[q.key] ?? '';
    area.addEventListener('input', () => emit({ [q.key]: area.value }));
    field.appendChild(area);

    container.appendChild(field);
  }

  const complete = isRulesComplete(doc);
  if (!complete) {
    const note = document.createElement('div');
    note.className = 'circle-rules__note';
    note.textContent = tr('circle.rules.required_note');
    container.appendChild(note);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-rules__save';
  save.textContent = tr('circle.rules.save');
  save.disabled = !complete;
  save.addEventListener('click', () => { if (complete && typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  // γ.4 — conflict resolver.  Opt-in via `incomingRules`.  When set, we
  // fetch the latest captured version (γ.2 versions adapter) through
  // `rulesStore` + `circleId`, run the 3-way diff, and — if anything
  // diverges — overlay the SAME modal used by the recipe editor with a
  // rules-namespaced heading.  Detection is async because
  // `rulesStore.listVersions(...)` may need IO.
  if (incomingRules != null) {
    maybeRenderRulesConflict(container, {
      doc, incomingRules, rulesStore, circleId, tr,
      onIncomingApplied, onIncomingDiscarded,
    });
  }
  return container;
}

/**
 * γ.4 — kick off the async dance of "fetch base → detect → maybe modal".
 * Appends a separate overlay element on the editor; the regular form
 * stays mounted underneath.  Cancel removes the overlay (local stays
 * as-is); Apply persists the merged doc via `rulesStore.set` and
 * notifies the host.
 */
async function maybeRenderRulesConflict(container, {
  doc, incomingRules, rulesStore, circleId, tr,
  onIncomingApplied, onIncomingDiscarded,
}) {
  // Fetch the last captured version as the 3-way merge base.  γ.2 stores
  // entries as { value: <doc> }; pull the value out for the diff.
  let base = null;
  try {
    if (rulesStore && typeof rulesStore.listVersions === 'function' && circleId) {
      const versions = await rulesStore.listVersions(circleId);
      const head = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
      base = head && typeof head === 'object' && head.value != null ? head.value : null;
    }
  } catch { /* best-effort — fall back to null base */ }

  const report = detectRulesConflicts(doc, incomingRules, base);
  // Identical or one-sided changes → no UI. Resolve each auto-merge to the side that ACTUALLY changed:
  // `apply` defaults unlisted paths to `theirs`, so passing `{}` here silently reverted a fresher LOCAL edit
  // whenever the divergence was ours — a stale replica (an offline second device coming back) overwrote the
  // newer document with no conflict and no prompt (story 6.2). `decisionsForMerges` keeps each side's change.
  if (report.identical
      || (report.blockConflicts.length === 0 && report.metaConflicts.length === 0)) {
    const merged = applyRulesResolution(doc, incomingRules, decisionsForMerges(report.toMerge));
    await persistMergedRules({ rulesStore, circleId, merged });
    if (typeof onIncomingApplied === 'function') onIncomingApplied(merged);
    return;
  }

  // Conflicts exist — overlay the (recipe-)conflict resolver with the
  // rules-namespaced heading.  The substrate produces an empty
  // `blockConflicts`, so the modal renders only the meta section.
  const overlay = document.createElement('div');
  overlay.className = 'circle-rules-editor__conflict-overlay';
  container.appendChild(overlay);

  renderRecipeConflictResolver(overlay, {
    conflicts: report,
    local: doc,
    incoming: incomingRules,
    t: tr,
    title: 'circle.rules.conflict.title',
    onResolve: async (decisions) => {
      try {
        const merged = applyRulesResolution(doc, incomingRules, decisions);
        await persistMergedRules({ rulesStore, circleId, merged });
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

async function persistMergedRules({ rulesStore, circleId, merged }) {
  if (!rulesStore || typeof rulesStore.set !== 'function' || !circleId) return;
  try { await rulesStore.set(circleId, merged); } catch { /* best-effort */ }
}
