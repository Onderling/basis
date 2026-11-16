/**
 * The help bot is a contact (L435): Contacten shows ONE synthetic row for it — bot-only, never fanned, no card, no
 * address — whose tap opens the help circle's conversation (the onboarding thread), and the launcher no longer paints
 * the help circle as a tile. The data stays where it is: the cc-help circle store holds the thread.
 */
import { describe, it, expect } from 'vitest';
import { withHelpContact, contactOpenTarget, tileCircles, helpDoorTarget, HELP_CONTACT_ID } from '../../src/v2/helpContact.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import en from '../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };
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

describe('the Help door (Settings, the intro\'s "more")', () => {
  it('opens the Help circle when this device holds it', () => {
    expect(helpDoorTarget([{ id: 'c1' }, { id: HELP_CIRCLE_ID }])).toEqual({ kind: 'circle', circleId: HELP_CIRCLE_ID });
  });

  it('says why nothing opens when it does not (never a silent tap, never an empty circle)', () => {
    const r = helpDoorTarget([{ id: 'c1' }]);
    expect(r).toEqual({ kind: 'say', key: 'circle.settings_home.help_missing' });
    expect(en.settings_home.help_missing).toBeTruthy();
    expect(nl.settings_home.help_missing).toBeTruthy();
    expect(helpDoorTarget(null)).toEqual(r);
  });

  it('both shells ask it at the door', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    for (const src of [read('../../web/v2/circleApp.js'), read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js')]) {
      expect(src).toMatch(/d\.target\.to === 'help'\) \{ openHelpDoor\(\); return; \}/);
      expect(src).toMatch(/helpDoorTarget\(/);
    }
  });
});
