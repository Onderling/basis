/**
 * basis v2 — contacts roster (web DOM renderer, feedback-extension).
 *
 * Pure render over the contact rows `listContacts` produces; the host injects
 * data + `t` + an `onOpen(contactId)` handler. Mirrors `renderCircleLauncher`'s
 * shape (no data fetching, no agent) so it stays unit-testable under happy-dom.
 * A bot row is tagged + shows its exposed-skill count (the commands available
 * in that thread); tapping a row opens its 1:1 DM thread.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderContactsRoster(container, { contacts = [], t, onOpen, onAdd } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'contactsRoster.js');
  container.innerHTML = '';
  container.className = 'cc-contacts';

  const head = document.createElement('div');
  head.className = 'cc-contacts__head';
  const heading = document.createElement('h2');
  heading.className = 'cc-contacts__title';
  heading.textContent = tr('circle.contacts.title');
  head.appendChild(heading);
  if (typeof onAdd === 'function') {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'cc-contacts__add';
    add.textContent = tr('circle.contacts.add');
    add.addEventListener('click', () => onAdd());
    head.appendChild(add);
  }
  container.appendChild(head);

  if (!contacts.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-contacts__empty';
    empty.textContent = tr('circle.contacts.empty');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('ul');
  list.className = 'cc-contacts__list';
  for (const c of contacts) {
    const li = document.createElement('li');
    li.className = `cc-contacts__row${c.isBot ? ' cc-contacts__row--bot' : ''}`;
    li.dataset.contactId = c.contactId;
    if (!c.reachable) li.classList.add('is-offline');

    const icon = document.createElement('span');
    icon.className = 'cc-contacts__icon';
    icon.textContent = c.isBot ? '🤖' : '👤';
    li.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'cc-contacts__body';
    const name = document.createElement('div');
    name.className = 'cc-contacts__name';
    name.textContent = c.name;
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'cc-contacts__meta';
    const bits = [];
    if (c.isBot) bits.push(tr('circle.contacts.bot'));
    if (c.isBot && c.skillCount > 0) bits.push(tr('circle.contacts.skills', { count: c.skillCount }));
    // S1 #2 — a ContactBook person's trust level + tags.
    if (!c.isBot && c.trustLevel) bits.push(tr(`circle.contacts.trust.${c.trustLevel}`));
    if (!c.isBot && Array.isArray(c.tags) && c.tags.length) bits.push(c.tags.join(', '));
    if (!c.reachable) bits.push(tr('circle.contacts.offline'));
    meta.textContent = bits.join(' · ');
    if (bits.length) body.appendChild(meta);
    li.appendChild(body);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'cc-contacts__open';
    open.textContent = tr('circle.contacts.open');
    const fire = () => { if (typeof onOpen === 'function') onOpen(c.contactId); };
    open.addEventListener('click', (e) => { e.stopPropagation(); fire(); });
    li.appendChild(open);
    li.addEventListener('click', fire);

    list.appendChild(li);
  }
  container.appendChild(list);
  return container;
}
