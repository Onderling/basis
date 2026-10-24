/**
 * The help bot is a contact (L435): Contacten shows ONE synthetic row for it — bot-only, never fanned, no card, no
 * address — whose tap opens the help circle's conversation (the onboarding thread), and the launcher no longer paints
 * the help circle as a tile. The data stays where it is: the cc-help circle store holds the thread.
 */
import { describe, it, expect } from 'vitest';
import { withHelpContact, contactOpenTarget, tileCircles, HELP_CONTACT_ID } from '../../src/v2/helpContact.js';
import { HELP_CIRCLE_ID, ONDERLING_BOT_WEBID } from '../../src/v2/helpCircle.js';

const t = (k) => `T:${k}`;
const real = { contactId: 'pk-anne', id: 'pk-anne', name: 'Anne' };

describe('the help bot as a contact', () => {
  it('one synthetic row, first, named from the bot\'s locale key — only when the help circle exists', () => {
    const rows = withHelpContact([real], { t, available: true });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: HELP_CONTACT_ID, contactId: ONDERLING_BOT_WEBID, name: 'T:circle.onboarding.help_name', synthetic: true, isBot: true, circleId: HELP_CIRCLE_ID });
    expect(rows[1]).toBe(real);
    expect(withHelpContact([real], { t, available: false })).toEqual([real]);
    expect(withHelpContact(withHelpContact([real], { t, available: true }), { t, available: true }).filter((r) => r.synthetic)).toHaveLength(1);
  });

  it('a tap on the synthetic row opens the help circle\'s conversation; a real contact opens its thread', () => {
    const [help] = withHelpContact([], { t, available: true });
    expect(contactOpenTarget(help)).toEqual({ kind: 'circle', circleId: HELP_CIRCLE_ID });
    expect(contactOpenTarget(real)).toEqual({ kind: 'thread', contact: real });
  });

  it('the launcher paints no help-circle tile; every other circle stays', () => {
    const circles = [{ id: HELP_CIRCLE_ID, name: 'Uitleg' }, { id: 'c1', name: 'Huis' }];
    expect(tileCircles(circles).map((c) => c.id)).toEqual(['c1']);
  });
});
