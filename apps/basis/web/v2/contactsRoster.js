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
import { splitShownHidden } from '../../src/v2/contactsSource.js';
import { paintFace } from './faceView.js';

export function renderContactsRoster(container, { contacts = [], unread = {}, t, onOpen, onAdd, resolvePictureFor = null } = {}) {
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

  // Hidden contacts (L106) fold away at the bottom: the row stays, out of sight, until they write again or
  // the person shows them. A list of only hidden contacts is not empty — the fold says what is there.
  const { shown, hidden } = splitShownHidden(contacts);
  if (!contacts.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-contacts__empty';
    empty.textContent = tr('circle.contacts.empty');
    container.appendChild(empty);
    return container;
  }

  const rowFor = (c) => {
    const li = document.createElement('li');
    li.className = `cc-contacts__row${c.isBot ? ' cc-contacts__row--bot' : ''}`;
    li.dataset.contactId = c.contactId;
    if (!c.reachable) li.classList.add('is-offline');
    if (c.hidden) li.classList.add('is-hidden');

    // THE FACE, or this person's own first letter. A bot keeps its glyph: it is not a person and has no face.
    const icon = document.createElement('span');
    icon.className = 'cc-contacts__icon';
    paintFace(icon, c, { fallbackGlyph: c.isBot ? '🤖' : null, resolvePicture: typeof resolvePictureFor === 'function' ? resolvePictureFor(c) : null });
    li.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'cc-contacts__body';
    const name = document.createElement('div');
    name.className = 'cc-contacts__name';
    name.textContent = c.name;
    // TWO PEOPLE, ONE NAME: a contact is named by what THEY say on the pair roster, so one can take
    // another's name. Every row of a colliding set says which one it is — the handle, else the key's tail.
    if (c.lookalike) {
      const tell = document.createElement('span');
      tell.className = 'cc-contacts__lookalike';
      tell.textContent = c.lookalike;
      tell.title = tr('circle.contacts.lookalike_hint');
      name.appendChild(tell);
    }
    body.appendChild(name);
    // …and a contact who RENAMED themselves says what they were, until you open the thread.
    if (c.wasName) {
      const was = document.createElement('div');
      was.className = 'cc-contacts__was';
      was.textContent = tr('circle.contacts.was_named', { name: c.wasName });
      body.appendChild(was);
    }

    const meta = document.createElement('div');
    meta.className = 'cc-contacts__meta';
    const bits = [];
    if (c.isBot) bits.push(tr('circle.contacts.bot'));
    if (c.isBot && c.skillCount > 0) bits.push(tr('circle.contacts.skills', { count: c.skillCount }));
    // S1 #2 — a ContactBook person's trust level + tags.
    if (!c.isBot && c.trustLevel) bits.push(tr(`circle.contacts.trust.${c.trustLevel}`));
    if (c.pairCircleId) bits.push(tr('circle.contacts.connected'));   // the pair roster exists (L105)
    if (!c.isBot && Array.isArray(c.tags) && c.tags.length) bits.push(c.tags.join(', '));
    if (!c.reachable) bits.push(tr('circle.contacts.offline'));
    meta.textContent = bits.join(' · ');
    if (bits.length) body.appendChild(meta);
    li.appendChild(body);

    // What is NEW here (2026-09-21): inbound messages newer than the moment this thread was last opened — the host
    // computes it (`contactUnread.js`), the row shows the count. Frits: "I have to check each contact all the time".
    const n = Number(unread?.[c.contactId]?.unread) || 0;
    if (n > 0) {
      li.classList.add('is-unread');
      const badge = document.createElement('span');
      badge.className = 'cc-contacts__unread';
      badge.textContent = String(n);
      badge.setAttribute('aria-label', tr('circle.contacts.unread', { count: n }));
      li.appendChild(badge);
    }

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'cc-contacts__open';
    open.textContent = tr('circle.contacts.open');
    const fire = () => { if (typeof onOpen === 'function') onOpen(c.contactId); };
    open.addEventListener('click', (e) => { e.stopPropagation(); fire(); });
    li.appendChild(open);
    li.addEventListener('click', fire);
    return li;
  };

  const list = document.createElement('ul');
  list.className = 'cc-contacts__list';
  for (const c of shown) list.appendChild(rowFor(c));
  container.appendChild(list);

  if (hidden.length) {
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'cc-contacts__fold';
    fold.textContent = tr('circle.contacts.hidden_fold', { count: hidden.length });
    fold.setAttribute('aria-expanded', 'false');
    const folded = document.createElement('ul');
    folded.className = 'cc-contacts__list cc-contacts__hidden';
    folded.hidden = true;
    for (const c of hidden) folded.appendChild(rowFor(c));
    fold.addEventListener('click', () => { folded.hidden = !folded.hidden; fold.setAttribute('aria-expanded', String(!folded.hidden)); });
    container.appendChild(fold);
    container.appendChild(folded);
  }
  return container;
}
