/**
 * basis v2 — "My things" notes-list (web DOM renderer).
 *
 * The Folio screen scoped to the private circle: my owned, un-shared
 * items.  Reuses the row shape `buildMyThings` returns; the host
 * passes the rendered list + `t` + handlers.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleMyThings(container, {
  files = [],
  t,
  onBack,
  onOpen,
  loading = false,
} = {}) {
  const tr = translatorOr(t, 'circleMyThings.js');
  container.innerHTML = '';
  container.classList.add('circle-my-things');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-my-things__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-my-things__title';
  head.textContent = tr('circle.folio.my_things_title');
  container.appendChild(head);

  if (loading) {
    const l = document.createElement('div');
    l.className = 'circle-my-things__loading';
    l.textContent = tr('circle.loading');
    container.appendChild(l);
    return container;
  }

  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-my-things__empty';
    empty.textContent = tr('circle.folio.my_things_empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'circle-my-things__list';
  for (const file of files) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'circle-my-things__row';
    el.dataset.fileId = file.id;
    const name = document.createElement('span');
    name.className = 'circle-my-things__name';
    name.textContent = file.name;
    el.appendChild(name);
    el.addEventListener('click', () => {
      if (typeof onOpen === 'function') onOpen(file);
    });
    list.appendChild(el);
  }
  container.appendChild(list);

  return container;
}
