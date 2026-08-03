/**
 * basis v2 — circle-scoped Folio file browser (web DOM renderer,
 * ).
 *
 * A drive-like view onto a circle's shared pod: a filter strip (All /
 * Favourites / Recent) over `buildCircleFiles` rows, each row carrying a
 * file name.  Pure render: the host passes rows + handlers + `t`; tapping
 * a row opens that file (onOpen).  Mirrors the stream renderer so it
 * stays unit-testable under happy-dom.
 *
 * when the host wires `onNavigate`, the flat row list is projected
 * through Folio's source-agnostic `folioLevel` (folio/browser) into a
 * Drive-style level: a breadcrumb trail, the immediate subfolders (with
 * counts), and the files directly in the current folder.  Folder rows
 * descend; file rows still open.  Without `onNavigate` the legacy flat
 * list renders unchanged.  File rows are rich in both modes — a kind
 * glyph plus a human size when the row carries one.
 */

import { folioLevel, glyphForFile, formatFileSize } from '@onderling-app/folio/browser';
// resolve the file-OPEN row action's capability treatment
// (get × file) from the member's matrix. Shared logic lives in src/; this
// renderer stays a thin adapter that just applies the returned treatment.
import { folioFileOpenTreatment } from '../../src/v2/circleFolio.js';

const FILTERS = ['all', 'favourites', 'recent'];
// share-toggle row above the filter strip.
const SHARE_FILTERS = ['shared-by-me', 'shared-with-me'];

/**
 * Append a rich file row (glyph · name · size) to `list`.
 *
 * `openTreatment` (from `folioFileOpenTreatment`) gates the row's
 * OPEN affordance, matching the list surface's row buttons:
 *   'show' → clickable open row (unchanged for a granted member);
 *   'grey' → rendered disabled + greyed, click suppressed;
 *   'hide' → row omitted entirely (nothing appended).
 */
function appendFileRow(list, file, { tr, onOpen, openTreatment = 'show' }) {
  if (openTreatment === 'hide') return;   // gate: omit the open affordance (mirrors list surface's 'hidden' consequence)
  const denied = openTreatment === 'grey';
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'circle-folio__row';
  if (denied) { el.disabled = true; el.classList.add('circle-folio__row--denied'); }
  el.dataset.fileId = file.id;

  const glyph = document.createElement('span');
  glyph.className = 'circle-folio__glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = glyphForFile(file.name);
  el.appendChild(glyph);

  const name = document.createElement('span');
  name.className = 'circle-folio__name';
  name.textContent = file.name;
  el.appendChild(name);

  // `bytes` (folio index) or `size` (scan rows); omit when neither.
  const size = formatFileSize(typeof file.bytes === 'number' ? file.bytes : file.size);
  if (size) {
    const sz = document.createElement('span');
    sz.className = 'circle-folio__size';
    sz.textContent = size;
    el.appendChild(sz);
  }

  el.addEventListener('click', () => { if (!denied && typeof onOpen === 'function') onOpen(file); });
  list.appendChild(el);
}

export function renderCircleFolioBrowser(container, {
  files = [],
  t,
  onBack,
  onOpen,
  filter = 'all',
  onFilter,
  // when set, toggling cycles the share filter; null = neither
  // pill is active (the normal filter strip handles the list).
  shareFilter = null,
  onShareFilter,
  // when wired, the list becomes a folder tree: `currentPath` is the
  // folder being viewed ('' = root) and `onNavigate(path)` descends/climbs.
  currentPath = '',
  onNavigate,
  // file SOURCE toggle: 'index' (in-app) | 'pod' (the user's real pod).
  // `needsPod` = pod source picked but no pod connected yet.
  sourceMode = 'index',
  onSourceMode,
  needsPod = false,
  loading = false,
  // the acting member's capability matrix + folio app origin.
  // The file-OPEN row action (get × file) is greyed/hidden per this matrix,
  // matching the list surface. Absent/empty ⇒ 'show' ⇒ unchanged behaviour.
  capabilityMatrix = [],
  appOrigin = 'folio',
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const navigable = typeof onNavigate === 'function';
  const podMode = sourceMode === 'pod';
  // Uniform across all file rows (same get × file capability): resolve once.
  const openTreatment = folioFileOpenTreatment({ capabilityMatrix, appOrigin });
  container.innerHTML = '';
  container.classList.add('circle-folio');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-folio__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-folio__title';
  head.textContent = tr('circle.folio.title');
  container.appendChild(head);

  // source toggle (In-app / My pod).  Only appears when the host wires
  // `onSourceMode`.  Picking "My pod" reads the user's real signed-in pod.
  if (typeof onSourceMode === 'function') {
    const srcRow = document.createElement('div');
    srcRow.className = 'circle-folio__source-toggle';
    for (const mode of ['index', 'pod']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-folio__source';
      btn.dataset.source = mode;
      if (mode === sourceMode) btn.classList.add('is-active');
      btn.textContent = tr(`circle.folio.source_${mode}`);
      btn.addEventListener('click', () => onSourceMode(mode));
      srcRow.appendChild(btn);
    }
    container.appendChild(srcRow);
  }

  // share-toggle row (Shared-by-me / Shared-with-me). Only
  // appears when the host wires an `onShareFilter` callback.  The share
  // lens is index-only — the pod source shows the pod's own folders.
  if (typeof onShareFilter === 'function' && !podMode) {
    const shareRow = document.createElement('div');
    shareRow.className = 'circle-folio__share-toggle';
    for (const key of SHARE_FILTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'circle-folio__share-filter';
      btn.dataset.shareFilter = key;
      if (key === shareFilter) btn.classList.add('is-active');
      // Locale key uses underscore: shared_by_me / shared_with_me.
      btn.textContent = tr(`circle.folio.${key.replace(/-/g, '_')}`);
      // Click toggles: re-clicking an active pill clears it.
      btn.addEventListener('click', () => {
        onShareFilter(shareFilter === key ? null : key);
      });
      shareRow.appendChild(btn);
    }
    container.appendChild(shareRow);
  }

  // Favourites/Recent filters are index-only; the pod source browses the
  // pod's own folder tree.
  if (!podMode) {
    const strip = document.createElement('div');
    strip.className = 'circle-folio__filters';
    for (const key of FILTERS) {
      const fb = document.createElement('button');
      fb.type = 'button';
      fb.className = 'circle-folio__filter';
      fb.dataset.filter = key;
      if (key === filter) fb.classList.add('is-active');
      fb.textContent = tr(`circle.folio.${key}`);
      fb.addEventListener('click', () => { if (typeof onFilter === 'function') onFilter(key); });
      strip.appendChild(fb);
    }
    container.appendChild(strip);
  }

  if (loading) {
    const l = document.createElement('div');
    l.className = 'circle-folio__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  // pod source picked but no pod connected: prompt sign-in instead of
  // an empty list (the data is on the pod, not a defect).
  if (podMode && needsPod) {
    const hint = document.createElement('div');
    hint.className = 'circle-folio__connect-pod';
    hint.textContent = tr('circle.folio.connect_pod');
    container.appendChild(hint);
    return container;
  }

  // ── Drive-style folder navigation ──────────────────────────────
  if (navigable) {
    const level = folioLevel(files, currentPath);

    // Breadcrumb trail.  The root crumb gets a friendly label; the
    // current (last) crumb renders as static text, the rest as buttons.
    const crumbs = document.createElement('nav');
    crumbs.className = 'circle-folio__crumbs';
    crumbs.setAttribute('aria-label', tr('circle.folio.title'));
    level.crumbs.forEach((crumb, i) => {
      const label = crumb.name || tr('circle.folio.root');
      const isLast = i === level.crumbs.length - 1;
      if (isLast) {
        const here = document.createElement('span');
        here.className = 'circle-folio__crumb is-current';
        here.setAttribute('aria-current', 'true');
        here.textContent = label;
        crumbs.appendChild(here);
      } else {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'circle-folio__crumb';
        c.dataset.crumbPath = crumb.path;
        c.textContent = label;
        c.addEventListener('click', () => onNavigate(crumb.path));
        crumbs.appendChild(c);
        const sep = document.createElement('span');
        sep.className = 'circle-folio__crumb-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '/';
        crumbs.appendChild(sep);
      }
    });
    container.appendChild(crumbs);

    if (!level.folders.length && !level.files.length) {
      const empty = document.createElement('div');
      empty.className = 'circle-folio__empty';
      empty.textContent = tr('circle.folio.empty_folder');
      container.appendChild(empty);
      return container;
    }

    const list = document.createElement('div');
    list.className = 'circle-folio__list';

    for (const folder of level.folders) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'circle-folio__row circle-folio__row--folder';
      el.dataset.folderPath = folder.path;

      const glyph = document.createElement('span');
      glyph.className = 'circle-folio__glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = '📁';
      el.appendChild(glyph);

      const name = document.createElement('span');
      name.className = 'circle-folio__name';
      name.textContent = folder.name;
      el.appendChild(name);

      const count = document.createElement('span');
      count.className = 'circle-folio__count';
      count.textContent = tr('circle.folio.folder_count', { count: folder.count });
      el.appendChild(count);

      el.addEventListener('click', () => onNavigate(folder.path));
      list.appendChild(el);
    }

    for (const file of level.files) appendFileRow(list, file, { tr, onOpen, openTreatment });
    container.appendChild(list);
    return container;
  }

  // ── Legacy flat list (no folder navigation wired) ──────────────────
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-folio__empty';
    // share-filter-specific empty copy when one is active.
    const emptyKey = shareFilter === 'shared-by-me'
      ? 'circle.folio.shared_by_me_empty'
      : shareFilter === 'shared-with-me'
        ? 'circle.folio.shared_with_me_empty'
        : 'circle.folio.empty';
    empty.textContent = tr(emptyKey);
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'circle-folio__list';
  for (const file of files) appendFileRow(list, file, { tr, onOpen, openTreatment });
  container.appendChild(list);

  return container;
}
