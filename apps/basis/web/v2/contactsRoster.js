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
import { splitShownHidden, contactRowMeta } from '../../src/v2/contactsSource.js';
import { paintFace } from './faceView.js';

export function renderContactsRoster(container, { contacts = [], unread = {}, t, onOpen, onAdd, onAddPerson = null, resolvePictureFor = null, onBlocked = null, requests = [], onAccept = null, onIgnore = null, onBlock = null } = {}) {
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
  // the two ways in: a PERSON (the scanner — their card or link; Me's Scan, the same door) and a bot (its address)
  const acts = document.createElement('div');
  acts.className = 'cc-contacts__acts';
  const addButton = (labelKey, role, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cc-contacts__add';
    b.dataset.role = role;
    b.textContent = tr(labelKey);
    b.addEventListener('click', () => fn());
    acts.appendChild(b);
  };
  if (typeof onAddPerson === 'function') addButton('circle.contacts.add_person', 'add-person', onAddPerson);
  if (typeof onAdd === 'function') addButton('circle.contacts.add', 'add-bot', onAdd);
  if (acts.childElementCount) head.appendChild(acts);
  container.appendChild(head);

  // THE REQUESTS (first messages from people not chosen): at the top, only when there is one. Open ones first, each with
  // Accept · Ignore · Block on this device; ignored ones fold into one line and can still be accepted. The name is what
  // the sender's card SAYS (unverified); the rows come from the shared projection (`messageRequestRows`).
  const openRequests = (requests ?? []).filter((r) => !r.ignored);
  const ignoredRequests = (requests ?? []).filter((r) => r.ignored);
  if (openRequests.length || ignoredRequests.length) {
    const section = document.createElement('section');
    section.className = 'cc-requests';
    const title = document.createElement('h3');
    title.className = 'cc-requests__title';
    title.textContent = tr('circle.contacts.requests.title');
    section.appendChild(title);
    const requestRow = (r, { ignored }) => {
      const li = document.createElement('li');
      li.className = `cc-requests__row${ignored ? ' is-ignored' : ''}`;
      li.dataset.from = r.from;
      const name = document.createElement('span');
      name.className = 'cc-requests__name';
      name.textContent = r.name ? tr(r.label, { name: r.name }) : tr(r.label);   // the shared row decides which (messageRequestRows)
      li.appendChild(name);
      if (r.firstLine) {
        const line = document.createElement('span');
        line.className = 'cc-requests__line';
        line.textContent = r.firstLine;
        li.appendChild(line);
      }
      const btns = document.createElement('span');
      btns.className = 'cc-requests__acts';
      const act = (key, labelKey, fn) => {
        if (typeof fn !== 'function') return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `cc-btn ${key === 'block' ? 'cc-btn--danger' : 'cc-btn--quiet'} cc-requests__act cc-requests__act--${key}`;
        b.dataset.act = key;
        b.textContent = tr(labelKey);
        b.addEventListener('click', () => fn());
        btns.appendChild(b);
      };
      act('accept', 'circle.contacts.requests.accept', onAccept && (() => onAccept(r.from)));
      if (!ignored) act('ignore', 'circle.contacts.requests.ignore', onIgnore && (() => onIgnore(r.from)));
      act('block', 'circle.contacts.requests.block', onBlock && (() => onBlock(r.from, r.name)));
      li.appendChild(btns);
      return li;
    };
    if (openRequests.length) {
      const ul = document.createElement('ul');
      ul.className = 'cc-requests__list';
      for (const r of openRequests) ul.appendChild(requestRow(r, { ignored: false }));
      section.appendChild(ul);
    }
    if (ignoredRequests.length) {
      const fold = document.createElement('details');
      fold.className = 'cc-requests__ignored';
      const summary = document.createElement('summary');
      summary.textContent = tr('circle.contacts.requests.ignored_fold', { n: ignoredRequests.length });
      fold.appendChild(summary);
      const ul = document.createElement('ul');
      ul.className = 'cc-requests__list';
      for (const r of ignoredRequests) ul.appendChild(requestRow(r, { ignored: true }));
      fold.appendChild(ul);
      section.appendChild(fold);
    }
    container.appendChild(section);
  }

  // Hidden contacts (L106) fold away at the bottom: the row stays, out of sight, until they write again or
  // the person shows them. A list of only hidden contacts is not empty — the fold says what is there.
  // the people this device blocks, and the one place a block is undone: a door at the foot of Contacten (an empty
  // roster has one too — someone blocked is not a contact)
  const blockedDoor = () => {
    if (typeof onBlocked !== 'function') return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cc-settings__row cc-contacts__blocked';
    b.textContent = tr('circle.contacts.blocked');
    b.addEventListener('click', () => onBlocked());
    container.appendChild(b);
  };
  const { shown, hidden } = splitShownHidden(contacts);
  if (!contacts.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-contacts__empty';
    empty.textContent = tr('circle.contacts.empty');
    container.appendChild(empty);
    blockedDoor();
    return container;
  }

  const rowFor = (c) => {
    const li = document.createElement('li');
    li.className = `cc-contacts__row${c.isBot ? ' cc-contacts__row--bot' : ''}`;
    li.dataset.contactId = c.contactId;
    if (!c.reachable) li.classList.add('is-offline');
    if (c.hidden) li.classList.add('is-hidden');
    // the help bot's row (shared `withHelpContact`): no pair roster behind it, so no face to fetch and no thread —
    // its tap opens the help circle, the host decides that through the shared `contactOpenTarget`
    if (c.synthetic) li.dataset.synthetic = 'true';

    // THE FACE, or this person's own first letter. A bot keeps its glyph: it is not a person and has no face.
    const icon = document.createElement('span');
    icon.className = 'cc-contacts__icon';
    paintFace(icon, c, { fallbackGlyph: c.isBot ? '🤖' : null, resolvePicture: typeof resolvePictureFor === 'function' && !c.synthetic ? resolvePictureFor(c) : null });
    li.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'cc-contacts__body';
    const name = document.createElement('div');
    name.className = 'cc-contacts__name';
    name.textContent = c.label ?? (c.labelKey ? tr(c.labelKey) : c.name);   // stamped by the projection: never the key
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
    // the line under the name, worded once for both shells (trust as its word, never a raw level)
    meta.textContent = contactRowMeta(c, tr);
    if (meta.textContent) body.appendChild(meta);
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
  blockedDoor();
  return container;
}
