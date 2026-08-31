/**
 * basis v2 — "Shared with me" list (web DOM renderer, SILENT out-of-circle delivery).
 *
 * The surface for sealed copies a peer pushed to us over the relay. It is a THIN projector: all logic lives in
 * the shared selector (`buildSharedWithMe` / `openSharedCopy` in src/v2/sharedWithMe.js) — this file only turns
 * the already-projected rows into DOM. The mobile shell renders the SAME rows over the SAME selector
 * (SharedWithMeScreen.js), so web ≡ mobile by construction (invariant #2). The host passes the projected
 * `entries`, `t`, and an `onOpen(entry)` that opens the copy with the user's own network-derived sealing key.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderSharedWithMe(container, {
  entries = [],
  t,
  onBack,
  onOpen,
  loading = false,
} = {}) {
  const tr = translatorOr(t, 'sharedWithMe.js');
  container.innerHTML = '';
  container.classList.add('shared-with-me');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'shared-with-me__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'shared-with-me__title';
  head.textContent = tr('circle.sharedWithMe.title');
  container.appendChild(head);

  if (loading) {
    const l = document.createElement('div');
    l.className = 'shared-with-me__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'shared-with-me__empty';
    empty.textContent = tr('circle.sharedWithMe.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'shared-with-me__list';
  for (const entry of entries) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'shared-with-me__row';
    el.dataset.copyId = entry.id;

    const label = document.createElement('span');
    label.className = 'shared-with-me__label';
    label.textContent = entry.sourceType
      ? tr('circle.sharedWithMe.row', { type: entry.sourceType, from: entry.from ?? '?' })
      : (entry.from ?? entry.id);
    el.appendChild(label);

    el.addEventListener('click', () => { if (typeof onOpen === 'function') onOpen(entry); });
    list.appendChild(el);
  }
  container.appendChild(list);

  return container;
}
