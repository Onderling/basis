/**
 * basis v2 — recipe conflict resolver modal (Plan γ.3, Phase 9).
 *
 * Modal UI rendered on top of the recipe editor when an incoming recipe
 * arrived and `detectRecipeConflicts(...)` returned non-empty groups.
 * Each conflicting block gets a row with three radio-style picker
 * buttons: [Keep yours] / [Take theirs] / [Keep both].  Meta-level
 * conflicts (recipe.name, etc.) get a separate section with [Keep yours]
 * / [Take theirs] only.
 *
 * The modal is purely controlled — it never touches the recipe store.
 * The host listens for `onResolve(decisions)` and applies them via
 * `applyResolution(...)` before persisting.
 *
 * There's no shared "Modal" abstraction in v2 web yet (verified during
 * γ.3 — `circleSettings.js` etc. are all route-style screens).  We
 * keep the overlay self-contained with inline styles + a single
 * `circle-recipe-conflict__*` class root so future styling can hang
 * off the css.
 *
 * γ.4 — the modal is reused for the rules doc and the circle policy:
 * those shapes have no `blocks` array, so detection produces an
 * empty `blockConflicts` and only `metaConflicts`.  The `title` opt
 * lets the host pick a namespace-appropriate heading
 * (`circle.rules.conflict.title` / `circle.settings.conflict.title`)
 * while every other locale key stays under `circle.recipe.conflict.*`
 * — the picker copy is identical across the three flows.
 */
import { BLOCK_REGISTRY } from '../../src/v2/circleRecipeBlocks.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

/**
 * @param {HTMLElement} container
 * @param {object} args
 * @param {{ blockConflicts, metaConflicts, identical, toMerge }} args.conflicts
 * @param {object} args.local     — local doc (for "yours" previews)
 * @param {object} args.incoming  — incoming doc (for "theirs" previews)
 * @param {Function} args.t
 * @param {Function} args.onResolve  (decisions) => void
 * @param {Function} args.onCancel   () => void
 * @param {string|null} [args.title=null]  γ.4 — override the modal heading
 *        translation key.  When null/omitted, defaults to
 *        `circle.recipe.conflict.title` for backwards compatibility with
 *        every γ.3 call site.
 */
export function renderRecipeConflictResolver(container, {
  conflicts,
  local,
  incoming,
  t,
  onResolve,
  onCancel,
  title = null,
} = {}) {
  const tr = translatorOr(t, 'recipeConflictResolver.js');
  container.innerHTML = '';
  container.classList.add('circle-recipe-conflict');
  // Self-contained backdrop — fixed positioning so the modal sits on
  // top of the recipe editor without needing a v2-wide CSS change.
  Object.assign(container.style, {
    position: 'fixed', inset: '0', zIndex: '200',
    background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  });

  const sheet = document.createElement('div');
  sheet.className = 'circle-recipe-conflict__sheet';
  Object.assign(sheet.style, {
    background: 'var(--card, #fff)',
    border: '1px solid var(--line, #ddd)',
    borderRadius: 'var(--radius, 10px)',
    padding: '18px 20px',
    maxWidth: '560px', width: '100%',
    maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 8px 28px rgba(0,0,0,.20)',
  });

  const titleEl = document.createElement('h2');
  titleEl.className = 'circle-recipe-conflict__title';
  titleEl.textContent = tr(typeof title === 'string' && title ? title : 'circle.recipe.conflict.title');
  titleEl.style.margin = '0 0 4px';
  sheet.appendChild(titleEl);

  const instr = document.createElement('p');
  instr.className = 'circle-recipe-conflict__instructions';
  instr.textContent = tr('circle.recipe.conflict.instructions');
  instr.style.cssText = 'margin: 0 0 14px; color: var(--ink-soft, #777); font-size: 13px;';
  sheet.appendChild(instr);

  /** @type {Record<string, string>} blockId → 'yours'|'theirs'|'both' */
  const blockDecisions = {};
  /** @type {Record<string, string>} pathKey → 'yours'|'theirs' */
  const metaDecisions = {};

  const safeBlockConflicts = Array.isArray(conflicts?.blockConflicts) ? conflicts.blockConflicts : [];
  const safeMetaConflicts  = Array.isArray(conflicts?.metaConflicts)  ? conflicts.metaConflicts  : [];

  const localBlocks    = Array.isArray(local?.blocks)    ? local.blocks    : [];
  const incomingBlocks = Array.isArray(incoming?.blocks) ? incoming.blocks : [];
  const lBlockMap = new Map(localBlocks.map((b)    => [b?.id, b]));
  const iBlockMap = new Map(incomingBlocks.map((b) => [b?.id, b]));

  /* Block conflicts section ------------------------------------------- */
  if (safeBlockConflicts.length > 0) {
    const list = document.createElement('ul');
    list.className = 'circle-recipe-conflict__block-list';
    list.style.cssText = 'list-style: none; padding: 0; margin: 0 0 12px;';
    for (const bc of safeBlockConflicts) {
      list.appendChild(renderBlockRow(bc, {
        tr,
        local: lBlockMap.get(bc.blockId),
        incoming: iBlockMap.get(bc.blockId),
        onPick: (pick) => {
          blockDecisions[bc.blockId] = pick;
          refreshApplyState();
        },
      }));
    }
    sheet.appendChild(list);
  }

  /* Meta conflicts section -------------------------------------------- */
  if (safeMetaConflicts.length > 0) {
    const metaHeader = document.createElement('div');
    metaHeader.className = 'circle-recipe-conflict__meta-header';
    metaHeader.textContent = tr('circle.recipe.conflict.meta_section');
    metaHeader.style.cssText = 'font-size: 11px; font-weight: 700; letter-spacing: 0.6px; '
      + 'text-transform: uppercase; color: var(--ink-soft, #777); margin: 12px 0 6px;';
    sheet.appendChild(metaHeader);

    const list = document.createElement('ul');
    list.className = 'circle-recipe-conflict__meta-list';
    list.style.cssText = 'list-style: none; padding: 0; margin: 0 0 12px;';
    for (const mc of safeMetaConflicts) {
      const pathKey = Array.isArray(mc.path) ? mc.path.join('.') : String(mc.path ?? '');
      list.appendChild(renderMetaRow(mc, pathKey, {
        tr,
        onPick: (pick) => {
          metaDecisions[pathKey] = pick;
          refreshApplyState();
        },
      }));
    }
    sheet.appendChild(list);
  }

  /* Footer: Apply / Cancel ------------------------------------------- */
  const footer = document.createElement('div');
  footer.className = 'circle-recipe-conflict__footer';
  footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; '
    + 'margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line, #eee);';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'circle-recipe-conflict__cancel cc-btn cc-btn--quiet';
  cancelBtn.textContent = tr('circle.recipe.conflict.cancel');
  cancelBtn.addEventListener('click', () => { if (typeof onCancel === 'function') onCancel(); });
  footer.appendChild(cancelBtn);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'circle-recipe-conflict__apply cc-btn cc-btn--primary';
  applyBtn.textContent = tr('circle.recipe.conflict.apply');
  applyBtn.disabled = true;
  applyBtn.addEventListener('click', () => {
    if (applyBtn.disabled) return;
    const merged = { ...blockDecisions, ...metaDecisions };
    if (typeof onResolve === 'function') onResolve(merged);
  });
  footer.appendChild(applyBtn);

  sheet.appendChild(footer);
  container.appendChild(sheet);

  function refreshApplyState() {
    const allBlocksPicked = safeBlockConflicts.every((bc) => !!blockDecisions[bc.blockId]);
    const allMetaPicked = safeMetaConflicts.every((mc) => {
      const k = Array.isArray(mc.path) ? mc.path.join('.') : String(mc.path ?? '');
      return !!metaDecisions[k];
    });
    applyBtn.disabled = !(allBlocksPicked && allMetaPicked);
  }

  return container;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Row renderers                                                          */
/* ─────────────────────────────────────────────────────────────────────── */

function renderBlockRow(bc, { tr, local, incoming, onPick }) {
  const li = document.createElement('li');
  li.className = 'circle-recipe-conflict__block-row';
  li.dataset.blockId = bc.blockId;
  li.style.cssText = 'padding: 10px 0; border-bottom: 1px solid var(--line, #eee);';

  // Pick a label from either side — incoming wins if the local side
  // deleted the block (yours undefined); otherwise mirror local.
  const refBlock = local ?? incoming;
  const meta = refBlock?.type ? BLOCK_REGISTRY[refBlock.type] : null;
  const typeKey = refBlock?.type ?? 'unknown';

  const labelRow = document.createElement('div');
  labelRow.className = 'circle-recipe-conflict__block-label';
  const emojiPrefix = meta?.emoji ? `${meta.emoji} ` : '';
  const typeLabel = tr(`circle.recipe.block.${typeKey}`);
  labelRow.textContent = tr('circle.recipe.conflict.block_label', { name: `${emojiPrefix}${typeLabel}` });
  labelRow.style.cssText = 'font-weight: 600; margin-bottom: 6px;';
  li.appendChild(labelRow);

  // Picker (three radios styled as buttons).
  const picker = document.createElement('div');
  picker.className = 'circle-recipe-conflict__picker';
  picker.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';
  for (const choice of ['yours', 'theirs', 'both']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `circle-recipe-conflict__choice circle-recipe-conflict__choice--${choice} cc-btn cc-btn--quiet`;
    btn.dataset.blockId = bc.blockId;
    btn.dataset.choice = choice;
    btn.textContent =
        choice === 'yours'  ? tr('circle.recipe.conflict.keep_yours')
      : choice === 'theirs' ? tr('circle.recipe.conflict.take_theirs')
      :                       tr('circle.recipe.conflict.keep_both');
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      onPick(choice);
      // Refresh visual state of siblings — chosen state is the `is-active`
      // class (.cc-btn.is-active, circle.css); `is-picked` stays as the
      // semantic marker existing tests/hosts key off.
      const siblings = picker.querySelectorAll('.circle-recipe-conflict__choice');
      siblings.forEach((sib) => {
        const isPicked = sib === btn;
        sib.classList.toggle('is-picked', isPicked);
        sib.classList.toggle('is-active', isPicked);
        sib.setAttribute('aria-pressed', isPicked ? 'true' : 'false');
      });
    });
    picker.appendChild(btn);
  }
  li.appendChild(picker);
  return li;
}

function renderMetaRow(mc, pathKey, { tr, onPick }) {
  const li = document.createElement('li');
  li.className = 'circle-recipe-conflict__meta-row';
  li.dataset.pathKey = pathKey;
  li.style.cssText = 'padding: 10px 0; border-bottom: 1px solid var(--line, #eee);';

  const labelRow = document.createElement('div');
  labelRow.className = 'circle-recipe-conflict__meta-label';
  labelRow.textContent = tr('circle.recipe.conflict.meta_label', { path: pathKey });
  labelRow.style.cssText = 'font-weight: 600; margin-bottom: 6px;';
  li.appendChild(labelRow);

  // Show the differing values briefly for context.
  const preview = document.createElement('div');
  preview.className = 'circle-recipe-conflict__meta-preview';
  preview.style.cssText = 'font-size: 12px; color: var(--ink-soft, #777); margin-bottom: 6px;';
  preview.textContent = `${tr('circle.recipe.conflict.keep_yours')}: ${formatPreview(mc.yours)} · `
    + `${tr('circle.recipe.conflict.take_theirs')}: ${formatPreview(mc.theirs)}`;
  li.appendChild(preview);

  const picker = document.createElement('div');
  picker.className = 'circle-recipe-conflict__picker';
  picker.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';
  for (const choice of ['yours', 'theirs']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `circle-recipe-conflict__choice circle-recipe-conflict__choice--${choice} cc-btn cc-btn--quiet`;
    btn.dataset.pathKey = pathKey;
    btn.dataset.choice = choice;
    btn.textContent = choice === 'yours'
      ? tr('circle.recipe.conflict.keep_yours')
      : tr('circle.recipe.conflict.take_theirs');
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      onPick(choice);
      const siblings = picker.querySelectorAll('.circle-recipe-conflict__choice');
      siblings.forEach((sib) => {
        const isPicked = sib === btn;
        sib.classList.toggle('is-picked', isPicked);
        sib.classList.toggle('is-active', isPicked);
        sib.setAttribute('aria-pressed', isPicked ? 'true' : 'false');
      });
    });
    picker.appendChild(btn);
  }
  li.appendChild(picker);
  return li;
}

function formatPreview(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  } catch { return String(v); }
}
