// @vitest-environment happy-dom
/**
 * Web Contacten paints the help bot as ONE synthetic row: marked, no face fetched (no pair roster behind it), and the
 * host's tap goes to the help circle through the shared `contactOpenTarget` — a real contact keeps its face and thread.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactsRoster } from '../../web/v2/contactsRoster.js';
import { withHelpContact, contactOpenTarget } from '../../src/v2/helpContact.js';
import { HELP_CIRCLE_ID, ONDERLING_BOT_WEBID } from '../../src/v2/helpCircle.js';

const t = (k) => `T:${k}`;
const real = { contactId: 'pk-anne', name: 'Anne', reachable: true, pairCircleId: 'pair-anne' };

describe('web Contacten: the help bot row', () => {
  it('exactly one synthetic row, named from the locale, no face resolved for it; the real contact has its face', () => {
    const el = document.createElement('div');
    const resolvePictureFor = vi.fn(() => null);
    renderContactsRoster(el, { contacts: withHelpContact([real], { t, available: true }), t, resolvePictureFor, onOpen: () => {} });
    const synthetic = el.querySelectorAll('.cc-contacts__row[data-synthetic="true"]');
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0].dataset.contactId).toBe(ONDERLING_BOT_WEBID);
    expect(synthetic[0].querySelector('.cc-contacts__name').textContent).toBe('T:circle.onboarding.help_name');
    expect(resolvePictureFor.mock.calls.map(([c]) => c.contactId)).toEqual(['pk-anne']);
  });

  it('the host routes the tap: the synthetic row to the help circle, a real contact to its thread', () => {
    const el = document.createElement('div');
    const contacts = withHelpContact([real], { t, available: true });
    const opened = [];
    renderContactsRoster(el, { contacts, t, onOpen: (id) => opened.push(contactOpenTarget(contacts.find((c) => c.contactId === id))) });
    for (const row of el.querySelectorAll('.cc-contacts__row')) row.click();
    expect(opened).toEqual([{ kind: 'circle', circleId: HELP_CIRCLE_ID }, { kind: 'thread', contact: real }]);
  });
});
