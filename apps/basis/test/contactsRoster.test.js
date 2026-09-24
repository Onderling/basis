/**
 * contactsRoster — the Contacten roster DOM render (feedback-extension).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactsRoster } from '../web/v2/contactsRoster.js';

const ctx = (over = {}) => ({ doc: document, t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k), ...over });

describe('renderContactsRoster', () => {
  it('renders a bot row with the 🤖 icon + skill count + an open button', () => {
    const onOpen = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'https://bot.example', name: 'Feedback bot', isBot: true, skillCount: 2, reachable: true }],
      t: (k, v) => (v ? `${k}:${v.count}` : k), onOpen,
    });
    const row = el.querySelector('.cc-contacts__row--bot');
    expect(row).not.toBeNull();
    expect(row.dataset.contactId).toBe('https://bot.example');
    expect(row.querySelector('.cc-contacts__icon').textContent).toBe('🤖');
    expect(row.querySelector('.cc-contacts__name').textContent).toBe('Feedback bot');
    expect(row.querySelector('.cc-contacts__meta').textContent).toContain('circle.contacts.skills:2');

    row.querySelector('.cc-contacts__open').click();
    expect(onOpen).toHaveBeenCalledWith('https://bot.example');
  });

  // Was 👤 for everyone until 2026-09-23. A generic glyph tells you nothing about WHICH person the row is;
  // the initial is theirs, stable across devices, and becomes their picture the moment they disclose one to
  // this pair circle. A bot keeps its glyph: it is not a person and has no face.
  it('a person row shows their FACE — their own initial until a picture is disclosed — and opens the thread', () => {
    const onOpen = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'PK', name: 'Alice', isBot: false, skillCount: 0, reachable: true }],
      ...ctx(), onOpen,
    });
    const row = el.querySelector('.cc-contacts__row');
    expect(row.querySelector('.cc-contacts__icon').textContent, "Alice's own letter, not a generic person glyph").toBe('A');
    expect(row.className).not.toContain('--bot');
    row.click();
    expect(onOpen).toHaveBeenCalledWith('PK');
  });

  it('shows a ContactBook person’s trust level + tags in the meta (S1 #2)', () => {
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'w', name: 'Alice', isBot: false, reachable: true, trustLevel: 'vertrouwd', tags: ['buur', 'klusser'] }],
      t: (k) => k,
    });
    const meta = el.querySelector('.cc-contacts__meta').textContent;
    expect(meta).toContain('circle.contacts.trust.vertrouwd');
    expect(meta).toContain('buur, klusser');
  });

  it('marks an unreachable contact offline', () => {
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'PK', name: 'Bob', isBot: false, reachable: false }], ...ctx(),
    });
    const row = el.querySelector('.cc-contacts__row');
    expect(row.classList.contains('is-offline')).toBe(true);
    expect(row.querySelector('.cc-contacts__meta').textContent).toContain('circle.contacts.offline');
  });

  it('shows the empty state when there are no contacts', () => {
    const el = renderContactsRoster(document.createElement('div'), { contacts: [], ...ctx() });
    expect(el.querySelector('.cc-contacts__empty').textContent).toBe('circle.contacts.empty');
    expect(el.querySelector('.cc-contacts__list')).toBeNull();
  });

  it('renders an "Add a bot" button only when onAdd is supplied, and fires it', () => {
    const onAdd = vi.fn();
    const without = renderContactsRoster(document.createElement('div'), { contacts: [], ...ctx() });
    expect(without.querySelector('.cc-contacts__add')).toBeNull();

    const withAdd = renderContactsRoster(document.createElement('div'), { contacts: [], ...ctx(), onAdd });
    const btn = withAdd.querySelector('.cc-contacts__add');
    expect(btn.textContent).toBe('circle.contacts.add');
    btn.click();
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('hidden contacts fold away (L106)', () => {
  const rows = [
    { contactId: 'W', name: 'Wilfred', isBot: false, skillCount: 0, reachable: true, hidden: true },
    { contactId: 'A', name: 'Alice', isBot: false, skillCount: 0, reachable: true, hidden: false },
    { contactId: 'B', name: 'Bot', isBot: true, skillCount: 1, reachable: true },
  ];
  it('the list shows the shown rows only; the fold names how many are hidden and opens them on tap', () => {
    const onOpen = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), { contacts: rows, ...ctx(), onOpen });
    const shown = [...el.querySelectorAll('.cc-contacts__list:not(.cc-contacts__hidden) > .cc-contacts__row')].map((r) => r.dataset.contactId);
    expect(shown, 'Wilfred is not in the list').toEqual(['A', 'B']);
    const fold = el.querySelector('.cc-contacts__fold');
    expect(fold, 'a fold for the hidden').toBeTruthy();
    expect(fold.textContent).toContain('circle.contacts.hidden_fold:{"count":1}');
    expect(el.querySelector('.cc-contacts__hidden').hidden, 'folded away until tapped').toBe(true);
    fold.click();
    expect(el.querySelector('.cc-contacts__hidden').hidden).toBe(false);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    const hidden = [...el.querySelectorAll('.cc-contacts__hidden .cc-contacts__row')];
    expect(hidden.map((r) => r.dataset.contactId)).toEqual(['W']);
    expect(hidden[0].classList.contains('is-hidden')).toBe(true);
    hidden[0].click();
    expect(onOpen, 'a hidden row opens its thread like any other — opening does not unhide').toHaveBeenCalledWith('W');
  });
  it('no hidden rows → no fold; every row hidden → the empty state is NOT shown, the fold is', () => {
    const none = renderContactsRoster(document.createElement('div'), { contacts: rows.filter((r) => !r.hidden), ...ctx() });
    expect(none.querySelector('.cc-contacts__fold')).toBeNull();
    const all = renderContactsRoster(document.createElement('div'), { contacts: [rows[0]], ...ctx() });
    expect(all.querySelector('.cc-contacts__empty')).toBeNull();
    expect(all.querySelector('.cc-contacts__fold')).toBeTruthy();
  });
});

describe('unread on Contacten (2026-09-21)', () => {
  it('a row with unread shows the count with its label; a read row shows nothing', () => {
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'bea', name: 'Bea', reachable: true }, { contactId: 'cas', name: 'Cas', reachable: true }],
      unread: { bea: { unread: 2, lastTs: 200 } }, t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k), onOpen: () => {},
    });
    const bea = el.querySelector('.cc-contacts__row[data-contact-id="bea"]');
    expect(bea.classList.contains('is-unread')).toBe(true);
    expect(bea.querySelector('.cc-contacts__unread').textContent).toBe('2');
    expect(bea.querySelector('.cc-contacts__unread').getAttribute('aria-label')).toBe('circle.contacts.unread:{"count":2}');
    expect(el.querySelector('.cc-contacts__row[data-contact-id="cas"] .cc-contacts__unread')).toBeNull();
  });
});
