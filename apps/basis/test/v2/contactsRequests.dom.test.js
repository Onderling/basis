/**
 * THE REQUESTS SECTION AT THE TOP OF CONTACTEN (Frits 2026-11-12, step 6 of message requests): a first message from
 * someone the person did not choose waits there, with three acts: Accept, Ignore, Block on this device. Shown only
 * when there is one; ignored requests fold into one "Ignored (n)" line and can still be accepted. The sender's name is
 * what their card SAYS, marked as unverified. The rows come from the shared projection (`messageRequestRows`).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactsRoster } from '../../web/v2/contactsRoster.js';
import { messageRequestRows } from '../../src/v2/messageRequestAccept.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);
const req = (from, name, state = 'open', text = 'hoi') => ({ from, name, state, turns: [{ messageId: `${from}-1`, text, ts: 1 }, { messageId: `${from}-2`, text: 'nog een', ts: 2 }], lastAt: 2 });

describe('the requests section', () => {
  it('the projection: the name the card says (or none), the first line, the state', () => {
    const rows = messageRequestRows([req('k-ann', 'Ann', 'open', 'hallo daar'), req('k-x', null, 'ignored')]);
    expect(rows).toEqual([
      { from: 'k-ann', name: 'Ann', firstLine: 'hallo daar', count: 2, ignored: false },
      { from: 'k-x', name: null, firstLine: 'hoi', count: 2, ignored: true },
    ]);
  });

  it('is absent when there is no request', () => {
    const el = renderContactsRoster(document.createElement('div'), { contacts: [], t, requests: [] });
    expect(el.querySelector('.cc-requests')).toBeNull();
  });

  it('an open request: the unverified name, the first line, and the three acts', () => {
    const onAccept = vi.fn(); const onIgnore = vi.fn(); const onBlock = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [], t, requests: messageRequestRows([req('k-ann', 'Ann', 'open', 'hallo daar')]), onAccept, onIgnore, onBlock,
    });
    const section = el.querySelector('.cc-requests');
    expect(section).not.toBeNull();
    expect(section.querySelector('.cc-requests__title').textContent).toBe('circle.contacts.requests.title');
    const row = section.querySelector('.cc-requests__row[data-from="k-ann"]');
    expect(row.querySelector('.cc-requests__name').textContent).toBe('circle.contacts.requests.says:{"name":"Ann"}');
    expect(row.querySelector('.cc-requests__line').textContent).toBe('hallo daar');
    row.querySelector('[data-act="accept"]').click();
    row.querySelector('[data-act="ignore"]').click();
    row.querySelector('[data-act="block"]').click();
    expect(onAccept).toHaveBeenCalledWith('k-ann');
    expect(onIgnore).toHaveBeenCalledWith('k-ann');
    expect(onBlock).toHaveBeenCalledWith('k-ann', 'Ann');
    expect(row.querySelector('[data-act="block"]').textContent).toBe('circle.contacts.requests.block');
  });

  it('a request with no name says so; ignored ones fold under one line and can still be accepted', () => {
    const onAccept = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [], t, onAccept, onIgnore: vi.fn(), onBlock: vi.fn(),
      requests: messageRequestRows([req('k-1', null, 'open'), req('k-2', 'Bo', 'ignored'), req('k-3', 'Cas', 'ignored')]),
    });
    expect(el.querySelector('.cc-requests__row[data-from="k-1"] .cc-requests__name').textContent).toBe('circle.contacts.requests.no_name');
    const fold = el.querySelector('.cc-requests__ignored');
    expect(fold.querySelector('summary').textContent).toBe('circle.contacts.requests.ignored_fold:{"n":2}');
    const ignoredRow = fold.querySelector('.cc-requests__row[data-from="k-2"]');
    expect(ignoredRow.querySelector('[data-act="ignore"]')).toBeNull();
    ignoredRow.querySelector('[data-act="accept"]').click();
    expect(onAccept).toHaveBeenCalledWith('k-2');
  });

  it('the requests sit above the contacts', () => {
    const el = renderContactsRoster(document.createElement('div'), {
      contacts: [{ contactId: 'c1', name: 'Cor', reachable: true }], t,
      requests: messageRequestRows([req('k-ann', 'Ann')]), onAccept: vi.fn(), onIgnore: vi.fn(), onBlock: vi.fn(),
    });
    const order = [...el.children].map((c) => c.className);
    expect(order.indexOf('cc-requests')).toBeLessThan(order.findIndex((c) => /cc-contacts__list/.test(c)));
  });
});
