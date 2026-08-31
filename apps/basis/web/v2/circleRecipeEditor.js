/**
 * basis v2 — recipe editor (Plan α.1d.1, audit gap #1+#9).
 *
 * Admin-facing editor for the per-circle screen recipes (v2 PDF §2
 * "RECEPT · SCREEN-WEERGAVE INRICHTEN").  Two render modes:
 *
 *   - 'book'   — list every recipe, mark active, add/rename/delete/setActive
 *   - 'recipe' — edit a single recipe's block list (add/remove/move/edit)
 *
 * Controlled render: host owns the RecipeBook + the editing-recipe id
 * + ephemeral input state, passes everything in, merges patches on
 * the callbacks, re-renders.  All persistence happens host-side
 * through `createCircleRecipeStore`.
 *
 * Pure DOM.  No drag-reorder yet (use ↑/↓ buttons); image picker on
 * the photo block is a follow-up (free-text src for now).
 */
import { BLOCK_TYPES } from '../../src/v2/circleRecipe.js';
import { BLOCK_REGISTRY } from '../../src/v2/circleRecipeBlocks.js';
import { detectRecipeConflicts, applyResolution } from '../../src/v2/recipeConflict.js';
import { renderRecipeConflictResolver } from './recipeConflictResolver.js';
import { translatorOr } from '../../src/locales/translatorOr.js';

/**
 * @param {HTMLElement} container
 * @param {object}   args
 * @param {object}   args.book               RecipeBook { recipes, activeId }
 * @param {'book'|'recipe'} [args.mode='book']
 * @param {string|null} [args.editingRecipeId]   active recipe in 'recipe' mode
 * @param {Function} args.t
 * @param {Function} [args.onOpenRecipe]     (recipeId) → void; book → recipe
 * @param {Function} [args.onBackToBook]     void; recipe → book
 * @param {Function} [args.onBack]           void; close the editor entirely
 * @param {Function} [args.onAddRecipe]      (name) → void
 * @param {Function} [args.onRenameRecipe]   (recipeId, name) → void
 * @param {Function} [args.onRemoveRecipe]   (recipeId) → void
 * @param {Function} [args.onSetActive]      (recipeId) → void
 * @param {Function} [args.onAddBlock]       (recipeId, blockType) → void
 * @param {Function} [args.onRemoveBlock]    (recipeId, blockId) → void
 * @param {Function} [args.onMoveBlock]      (recipeId, blockId, newIndex) → void
 * @param {Function} [args.onUpdateBlock]    (recipeId, blockId, configPatch) → void
 *
 * γ.3 — per-block conflict resolution (Phase 9, sync-engine absorption).
 *   The opts below are PURELY ADDITIVE.  When `incomingRecipe` is null
 *   (the default + every existing call site) the editor behaves exactly
 *   as before γ.3.  When non-null, the editor runs a 3-way diff against
 *   the last captured version (γ.2) and — if conflicts surface —
 *   overlays the modal resolver on top of the regular editor.
 *
 * @param {object|null} [args.incomingRecipe]   Recipe arriving from a peer
 *        broadcast / pod-sync.  Optional; null disables γ.3 entirely.
 * @param {object} [args.recipeStore]   The circle recipe store (γ.2).  Used
 *        for `listVersions(circleId)` and `update(...)` after resolution.
 * @param {string} [args.circleId]      Required when `incomingRecipe` is
 *        non-null (so we can fetch the version history slot for this circle).
 * @param {Function} [args.onIncomingApplied]   (mergedRecipe) => void;
 *        called after the user resolved + the merged recipe was saved.
 * @param {Function} [args.onIncomingDiscarded] () => void; called after
 *        the user hit Cancel.
 */
export function renderRecipeEditor(container, {
  book = { recipes: [], activeId: null },
  mode = 'book',
  editingRecipeId = null,
  t,
  onOpenRecipe, onBackToBook, onBack,
  onAddRecipe, onRenameRecipe, onRemoveRecipe, onSetActive,
  onAddBlock, onRemoveBlock, onMoveBlock, onUpdateBlock,
  // γ.3 — incoming-recipe / conflict-resolver opts (optional).
  incomingRecipe = null,
  recipeStore,
  circleId,
  onIncomingApplied,
  onIncomingDiscarded,
} = {}) {
  const tr = translatorOr(t, 'circleRecipeEditor.js');
  container.innerHTML = '';
  container.classList.add('circle-recipe-editor');
  container.dataset.mode = mode;

  if (mode === 'recipe') {
    renderRecipeMode(container, {
      book, recipeId: editingRecipeId, tr,
      onBackToBook, onAddBlock, onRemoveBlock, onMoveBlock, onUpdateBlock,
    });
  } else {
    renderBookMode(container, {
      book, tr,
      onBack, onOpenRecipe, onAddRecipe, onRenameRecipe, onRemoveRecipe, onSetActive,
    });
  }

  // γ.3 — conflict resolver.  Opt-in via `incomingRecipe`.  We only run
  // when there's a "local recipe" to compare against (i.e. mode==='recipe'
  // OR the book has a single matching id); otherwise the substrate has
  // no anchor and we silently no-op.  The detection + modal rendering are
  // async because `recipeStore.listVersions(...)` may need IO.
  if (incomingRecipe != null) {
    maybeRenderConflictResolver(container, {
      book, editingRecipeId, incomingRecipe, recipeStore, circleId, tr,
      onIncomingApplied, onIncomingDiscarded,
    });
  }
  return container;
}

/**
 * γ.3 — kick off the async dance of "fetch base → detect → maybe modal".
 * Appends a separate overlay element so the regular editor underneath
 * stays mounted.  When the user picks Cancel, we just remove the overlay;
 * the local recipe stays as-is.  When the user picks Apply, we save the
 * merged recipe via the store and notify the host.
 */
async function maybeRenderConflictResolver(container, {
  book, editingRecipeId, incomingRecipe, recipeStore, circleId, tr,
  onIncomingApplied, onIncomingDiscarded,
}) {
  // Find the local-side recipe to compare against.  Prefer the
  // currently-editing recipe; fall back to the active one; finally,
  // match by incoming.id.
  const localRecipe =
       (editingRecipeId && book?.recipes?.find?.((r) => r.id === editingRecipeId))
    || (book?.activeId  && book?.recipes?.find?.((r) => r.id === book.activeId))
    || (incomingRecipe?.id && book?.recipes?.find?.((r) => r.id === incomingRecipe.id))
    || null;

  if (!localRecipe) return;  // nothing to compare against — silently skip

  // Fetch the last captured version as the 3-way merge base.  Pod sync
  // captures the FULL book; pull the matching recipe out for the diff.
  let base = null;
  try {
    if (recipeStore && typeof recipeStore.listVersions === 'function' && circleId) {
      const versions = await recipeStore.listVersions(circleId);
      const head = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
      const headBook = head && typeof head === 'object' && head.value != null ? head.value : null;
      base = headBook?.recipes?.find?.((r) => r.id === localRecipe.id) ?? null;
    }
  } catch { /* best-effort — fall back to null base */ }

  const report = detectRecipeConflicts(localRecipe, incomingRecipe, base);
  // Identical or only one-sided changes → no UI needed; apply the
  // incoming recipe cleanly via `applyResolution` with no decisions
  // (defaults preserve local, but with no conflicts the result equals
  // the merged book either way; we still hand it back so the host can
  // persist).
  if (report.identical || (report.blockConflicts.length === 0 && report.metaConflicts.length === 0)) {
    const merged = applyResolution(localRecipe, incomingRecipe, {});
    await persistMerged({ recipeStore, circleId, book, merged });
    if (typeof onIncomingApplied === 'function') onIncomingApplied(merged);
    return;
  }

  // Conflicts exist — overlay the modal.
  const overlay = document.createElement('div');
  overlay.className = 'circle-recipe-editor__conflict-overlay';
  container.appendChild(overlay);

  renderRecipeConflictResolver(overlay, {
    conflicts: report,
    local: localRecipe,
    incoming: incomingRecipe,
    t: tr,
    onResolve: async (decisions) => {
      try {
        const merged = applyResolution(localRecipe, incomingRecipe, decisions);
        await persistMerged({ recipeStore, circleId, book, merged });
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

/**
 * γ.3 — persist a merged recipe back through the store.  The store is
 * book-shaped, so splice the merged recipe into the existing book by id.
 * When the recipe didn't exist locally (incoming-only id), append.
 */
async function persistMerged({ recipeStore, circleId, book, merged }) {
  if (!recipeStore || typeof recipeStore.update !== 'function' || !circleId || !merged?.id) return;
  await recipeStore.update(circleId, (cur) => {
    const recipes = Array.isArray(cur?.recipes) ? cur.recipes.slice() : [];
    const idx = recipes.findIndex((r) => r.id === merged.id);
    if (idx >= 0) recipes[idx] = merged;
    else recipes.push(merged);
    return { ...cur, recipes };
  });
}

/* ─────────────────────────────────────────────────────────────────────── */
/* BOOK mode                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

function renderBookMode(container, {
  book, tr,
  onBack, onOpenRecipe, onAddRecipe, onRenameRecipe, onRemoveRecipe, onSetActive,
}) {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-recipe-editor__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const title = document.createElement('h2');
  title.className = 'circle-recipe-editor__title';
  title.textContent = tr('circle.recipe.editor.book_title');
  container.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'circle-recipe-editor__recipe-list';
  if (book.recipes.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'circle-recipe-editor__recipe-empty';
    empty.textContent = tr('circle.recipe.editor.no_recipes');
    list.appendChild(empty);
  } else {
    for (const recipe of book.recipes) {
      list.appendChild(renderRecipeRow(recipe, {
        isActive: recipe.id === book.activeId, tr,
        onOpenRecipe, onRenameRecipe, onRemoveRecipe, onSetActive,
      }));
    }
  }
  container.appendChild(list);

  // Add-recipe row at the bottom (always visible; admins curate here).
  const addRow = document.createElement('div');
  addRow.className = 'circle-recipe-editor__add-recipe';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'circle-recipe-editor__add-recipe-input';
  addInput.placeholder = tr('circle.recipe.editor.add_recipe_placeholder');
  addRow.appendChild(addInput);
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'circle-recipe-editor__add-recipe-btn';
  addBtn.textContent = tr('circle.recipe.editor.add_recipe');
  addBtn.addEventListener('click', () => {
    const name = addInput.value.trim();
    if (!name) return;
    onAddRecipe?.(name);
    addInput.value = '';
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
}

function renderRecipeRow(recipe, {
  isActive, tr,
  onOpenRecipe, onRenameRecipe, onRemoveRecipe, onSetActive,
}) {
  const li = document.createElement('li');
  li.className = 'circle-recipe-editor__recipe-row';
  li.dataset.recipeId = recipe.id;
  if (isActive) li.classList.add('is-active');

  // Name (rendered as a button so tapping the name opens the recipe).
  const nameBtn = document.createElement('button');
  nameBtn.type = 'button';
  nameBtn.className = 'circle-recipe-editor__recipe-name';
  nameBtn.textContent = recipe.name || tr('circle.recipe.editor.untitled');
  nameBtn.addEventListener('click', () => onOpenRecipe?.(recipe.id));
  li.appendChild(nameBtn);

  // Active badge.
  if (isActive) {
    const badge = document.createElement('span');
    badge.className = 'circle-recipe-editor__active-badge';
    badge.textContent = tr('circle.recipe.editor.active');
    li.appendChild(badge);
  }

  // Action buttons (rename / setActive / remove).  Kept compact.
  const actions = document.createElement('div');
  actions.className = 'circle-recipe-editor__recipe-actions';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'circle-recipe-editor__recipe-rename';
  renameBtn.textContent = tr('circle.recipe.editor.rename');
  renameBtn.addEventListener('click', () => {
    const next = globalThis.prompt?.(tr('circle.recipe.editor.rename_prompt'), recipe.name) ?? null;
    if (next == null) return;
    const trimmed = next.trim();
    if (trimmed && trimmed !== recipe.name) onRenameRecipe?.(recipe.id, trimmed);
  });
  actions.appendChild(renameBtn);

  if (!isActive) {
    const activateBtn = document.createElement('button');
    activateBtn.type = 'button';
    activateBtn.className = 'circle-recipe-editor__recipe-activate';
    activateBtn.textContent = tr('circle.recipe.editor.set_active');
    activateBtn.addEventListener('click', () => onSetActive?.(recipe.id));
    actions.appendChild(activateBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'circle-recipe-editor__recipe-remove';
  removeBtn.textContent = tr('circle.recipe.editor.delete');
  removeBtn.addEventListener('click', () => {
    if (!globalThis.confirm?.(tr('circle.recipe.editor.delete_confirm', { name: recipe.name || '' }))) return;
    onRemoveRecipe?.(recipe.id);
  });
  actions.appendChild(removeBtn);

  li.appendChild(actions);
  return li;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* RECIPE mode                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

function renderRecipeMode(container, {
  book, recipeId, tr,
  onBackToBook, onAddBlock, onRemoveBlock, onMoveBlock, onUpdateBlock,
}) {
  const recipe = book.recipes.find((r) => r.id === recipeId);
  if (!recipe) {
    // Stale id; bail back to the book view.
    const msg = document.createElement('div');
    msg.className = 'circle-recipe-editor__missing';
    msg.textContent = tr('circle.recipe.editor.recipe_missing');
    container.appendChild(msg);
    return;
  }

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-recipe-editor__back';
  back.textContent = tr('circle.recipe.editor.back_to_book');
  back.addEventListener('click', () => onBackToBook?.());
  container.appendChild(back);

  const title = document.createElement('h2');
  title.className = 'circle-recipe-editor__recipe-title';
  title.textContent = recipe.name || tr('circle.recipe.editor.untitled');
  container.appendChild(title);

  // Block list (ordered).
  const list = document.createElement('ol');
  list.className = 'circle-recipe-editor__block-list';
  if (recipe.blocks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'circle-recipe-editor__block-empty';
    empty.textContent = tr('circle.recipe.editor.no_blocks');
    list.appendChild(empty);
  } else {
    for (let i = 0; i < recipe.blocks.length; i++) {
      list.appendChild(renderBlockRow(recipe.blocks[i], i, recipe.blocks.length, {
        recipeId, tr,
        onRemoveBlock, onMoveBlock, onUpdateBlock,
      }));
    }
  }
  container.appendChild(list);

  // Block palette at the bottom — one button per type, ordered by registry.
  const palette = document.createElement('div');
  palette.className = 'circle-recipe-editor__palette';
  const paletteTitle = document.createElement('div');
  paletteTitle.className = 'circle-recipe-editor__palette-title';
  paletteTitle.textContent = tr('circle.recipe.editor.add_block_title');
  palette.appendChild(paletteTitle);

  const sortedTypes = [...BLOCK_TYPES].sort(
    (a, b) => (BLOCK_REGISTRY[a]?.order ?? 99) - (BLOCK_REGISTRY[b]?.order ?? 99),
  );
  for (const type of sortedTypes) {
    const meta = BLOCK_REGISTRY[type];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'circle-recipe-editor__palette-btn';
    btn.dataset.blockType = type;
    btn.textContent = `${meta?.emoji ? meta.emoji + ' ' : ''}${tr(`circle.recipe.block.${type}`)}`;
    btn.addEventListener('click', () => onAddBlock?.(recipeId, type));
    palette.appendChild(btn);
  }
  container.appendChild(palette);
}

function renderBlockRow(block, index, total, {
  recipeId, tr, onRemoveBlock, onMoveBlock, onUpdateBlock,
}) {
  const li = document.createElement('li');
  li.className = `circle-recipe-editor__block-row circle-recipe-editor__block-row--${block.type}`;
  li.dataset.blockId = block.id;
  li.dataset.blockType = block.type;
  li.dataset.index = String(index);

  // Header — type label + move/remove buttons.
  const head = document.createElement('div');
  head.className = 'circle-recipe-editor__block-head';
  const meta = BLOCK_REGISTRY[block.type];
  const label = document.createElement('span');
  label.className = 'circle-recipe-editor__block-label';
  label.textContent = `${meta?.emoji ? meta.emoji + ' ' : ''}${tr(`circle.recipe.block.${block.type}`)}`;
  head.appendChild(label);

  const headActions = document.createElement('div');
  headActions.className = 'circle-recipe-editor__block-actions';

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'circle-recipe-editor__block-up';
  upBtn.textContent = '↑';
  upBtn.disabled = index === 0;
  upBtn.setAttribute('aria-label', tr('circle.recipe.editor.move_up'));
  upBtn.addEventListener('click', () => onMoveBlock?.(recipeId, block.id, index - 1));
  headActions.appendChild(upBtn);

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'circle-recipe-editor__block-down';
  downBtn.textContent = '↓';
  downBtn.disabled = index >= total - 1;
  downBtn.setAttribute('aria-label', tr('circle.recipe.editor.move_down'));
  downBtn.addEventListener('click', () => onMoveBlock?.(recipeId, block.id, index + 1));
  headActions.appendChild(downBtn);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'circle-recipe-editor__block-remove';
  removeBtn.textContent = '×';
  removeBtn.setAttribute('aria-label', tr('circle.recipe.editor.remove_block'));
  removeBtn.addEventListener('click', () => onRemoveBlock?.(recipeId, block.id));
  headActions.appendChild(removeBtn);

  head.appendChild(headActions);
  li.appendChild(head);

  // Per-type config form.
  const form = renderBlockConfigForm(block, {
    recipeId, tr, onUpdateBlock,
  });
  if (form) li.appendChild(form);

  return li;
}

// α.5c — list-shaped block types that expose a "Compact" toggle in
// their per-block config drawer (mirrors the renderer's COMPACTABLE_TYPES).
const COMPACTABLE_TYPES = new Set(['announcement', 'noticeboard', 'calendar', 'tasks']);

function renderBlockConfigForm(block, { recipeId, tr, onUpdateBlock }) {
  const wrap = document.createElement('div');
  wrap.className = 'circle-recipe-editor__block-config';

  const emit = (patch) => onUpdateBlock?.(recipeId, block.id, patch);

  switch (block.type) {
    case 'announcement': {
      const area = document.createElement('textarea');
      area.className = 'circle-recipe-editor__block-textarea';
      area.placeholder = tr('circle.recipe.editor.announcement_placeholder');
      area.value = block.config?.text ?? '';
      area.addEventListener('input', () => emit({ text: area.value }));
      wrap.appendChild(area);
      break;
    }
    case 'text': {
      const area = document.createElement('textarea');
      area.className = 'circle-recipe-editor__block-textarea';
      area.placeholder = tr('circle.recipe.editor.text_placeholder');
      area.value = block.config?.text ?? '';
      area.addEventListener('input', () => emit({ text: area.value }));
      wrap.appendChild(area);
      break;
    }
    case 'photo': {
      const src = document.createElement('input');
      src.type = 'text';
      src.className = 'circle-recipe-editor__block-input';
      src.placeholder = tr('circle.recipe.editor.photo_src_placeholder');
      src.value = block.config?.src ?? '';
      src.addEventListener('input', () => emit({ src: src.value }));
      wrap.appendChild(src);
      const cap = document.createElement('input');
      cap.type = 'text';
      cap.className = 'circle-recipe-editor__block-input';
      cap.placeholder = tr('circle.recipe.editor.photo_caption_placeholder');
      cap.value = block.config?.caption ?? '';
      cap.addEventListener('input', () => emit({ caption: cap.value }));
      wrap.appendChild(cap);
      break;
    }
    case 'noticeboard': {
      wrap.appendChild(renderLimitField(block, 'limit', 'noticeboard_limit_label', { tr, emit }));
      break;
    }
    case 'calendar': {
      wrap.appendChild(renderLimitField(block, 'limit', 'agenda_limit_label', { tr, emit }));
      wrap.appendChild(renderLimitField(block, 'horizonDays', 'agenda_horizon_label', { tr, emit }));
      break;
    }
    case 'tasks': {
      // α.5c — tasks-block scope/limit editor is a follow-up; for now
      // only the compact toggle (rendered below) lives in this drawer.
      break;
    }
    case 'rules': {
      // No config — rules block always renders the circle's current
      // houseRules doc.  Show a hint instead.
      const hint = document.createElement('div');
      hint.className = 'circle-recipe-editor__block-hint';
      hint.textContent = tr('circle.recipe.editor.rules_hint');
      wrap.appendChild(hint);
      break;
    }
    default: {
      return null;   // unknown type — skip the config form
    }
  }

  // α.5c — Compact toggle on the four list-shaped block types.  Patches
  // {compact:boolean} onto the block's config via the same emit() path.
  if (COMPACTABLE_TYPES.has(block.type)) {
    wrap.appendChild(renderCompactToggle(block, { tr, emit }));
  }
  return wrap;
}

function renderCompactToggle(block, { tr, emit }) {
  const row = document.createElement('label');
  row.className = 'circle-recipe-editor__compact-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'circle-recipe-editor__compact-checkbox';
  cb.checked = block.config?.compact === true;
  cb.addEventListener('change', () => emit({ compact: cb.checked }));
  row.appendChild(cb);
  const lbl = document.createElement('span');
  lbl.className = 'circle-recipe-editor__compact-label';
  lbl.textContent = tr('circle.recipe.compact_label.label');
  row.appendChild(lbl);
  const hint = document.createElement('span');
  hint.className = 'circle-recipe-editor__compact-hint';
  hint.textContent = tr('circle.recipe.compact_label.hint');
  row.appendChild(hint);
  return row;
}

function renderLimitField(block, configKey, labelKeySuffix, { tr, emit }) {
  const row = document.createElement('label');
  row.className = 'circle-recipe-editor__limit-row';
  const lbl = document.createElement('span');
  lbl.className = 'circle-recipe-editor__limit-label';
  lbl.textContent = tr(`circle.recipe.editor.${labelKeySuffix}`);
  row.appendChild(lbl);
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'circle-recipe-editor__limit-input';
  input.min = '1';
  input.value = String(block.config?.[configKey] ?? '');
  input.dataset.configKey = configKey;
  input.addEventListener('input', () => {
    const n = parseInt(input.value, 10);
    if (Number.isFinite(n) && n > 0) emit({ [configKey]: n });
  });
  row.appendChild(input);
  return row;
}
