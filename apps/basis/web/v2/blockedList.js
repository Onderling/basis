/**
 * basis v2 — the "Blocked" list (web DOM renderer).
 *
 * A thin projector, like `sharedWithMe.js`: every decision about what a row SAYS lives in the shared
 * selector (`buildBlockedList` in src/v2/blockedList.js), which the mobile shell renders too, so the
 * two shells cannot drift on who is on the list or what they are called.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderBlockedList(container, { rows = [], t, onBack, onUnblock, loading = false } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'blockedList.js');
  container.innerHTML = '';
  container.classList.add('cc-blocked');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cc-blocked__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'cc-blocked__title';
  head.textContent = tr('circle.blocked.title');
  container.appendChild(head);

  const note = document.createElement('p');
  note.className = 'cc-blocked__note';
  note.textContent = tr('circle.blocked.note');
  container.appendChild(note);

  if (loading) {
    const l = document.createElement('div');
    l.className = 'cc-blocked__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'cc-blocked__empty';
    empty.textContent = tr('circle.blocked.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'cc-blocked__list';
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'cc-blocked__row';
    el.dataset.peerKey = row.key;

    const label = document.createElement('span');
    label.className = row.resolved ? 'cc-blocked__label' : 'cc-blocked__label cc-blocked__label--key';
    label.textContent = row.label;
    el.appendChild(label);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-blocked__unblock';
    btn.textContent = tr('circle.blocked.unblock');
    // The row's ORIGINAL key, not its label — unblocking by a display name removes nothing.
    btn.addEventListener('click', () => { if (typeof onUnblock === 'function') onUnblock(row.key); });
    el.appendChild(btn);

    list.appendChild(el);
  }
  container.appendChild(list);
  return container;
}
