// @vitest-environment happy-dom
/**
 * Contacts and Me, as the interface sweep left them (phone twin: apps/basis-mobile/test/contactsMijParity.test.js):
 * Contacts offers "Persoon toevoegen" (the scanner, Me's Scan) beside "Bot toevoegen"; a contact's trust reads as its
 * word whichever enum it came in; Me without a handle says "Nog geen naam", not "Mij"; a count of nothing is not said;
 * and "this device" carries the device's own name when the person never gave it one.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderContactsRoster } from '../../web/v2/contactsRoster.js';
import { contactRowMeta, trustWordKey } from '../../src/v2/contactsSource.js';
import { identityLineWords } from '../../src/v2/mijWords.js';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';
import { browserDeviceName } from '../../src/v2/deviceName.js';
import { mijScreenBlocks } from '../../src/v2/mijScreen.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('Contacts', () => {
  it('two ways in: a person (the scanner) and a bot', () => {
    const onAddPerson = vi.fn();
    const el = renderContactsRoster(document.createElement('div'), { contacts: [], t, onOpen: () => {}, onAdd: () => {}, onAddPerson });
    const person = el.querySelector('[data-role=add-person]');
    expect(person?.textContent).toBe('circle.contacts.add_person');
    expect(el.querySelector('[data-role=add-bot]')?.textContent).toBe('circle.contacts.add');
    person.click();
    expect(onAddPerson).toHaveBeenCalledOnce();
  });
  it('trust is its word, from either enum — never the raw level', () => {
    expect(trustWordKey('known')).toBe('circle.contacts.trust.bekend');
    expect(trustWordKey('bekend')).toBe('circle.contacts.trust.bekend');
    expect(trustWordKey('trusted')).toBe('circle.contacts.trust.vertrouwd');
    expect(trustWordKey('unknown')).toBeNull();
    expect(contactRowMeta({ trustLevel: 'known', reachable: true }, t)).toBe('circle.contacts.trust.bekend');
    expect(contactRowMeta({ isBot: true, skillCount: 2, reachable: false }, t))
      .toBe('circle.contacts.bot · circle.contacts.skills:{"count":2} · circle.contacts.offline');
  });
});

describe('Me', () => {
  it('no handle: "Nog geen naam", not the tab\'s word', () => {
    const el = renderCircleScreen(document.createElement('div'), {
      blocks: [{ blockId: 'i', type: 'identityLine', status: 'ok', content: { name: null, readings: [] } }], t,
    });
    expect(el.querySelector('.cc-profile__title')?.textContent).toBe('circle.profile.no_name_yet');
  });
  it('a count of nothing is not said', () => {
    const words = identityLineWords({ readings: [{ key: 'online', on: true }, { key: 'unread', count: 0 }, { key: 'open', count: 0 }, { key: 'unread', count: 3 }] }, { t });
    expect(words).toEqual(['circle.profile.reading_online', 'circle.profile.reading_unread:{"count":3}']);
  });
  it('"this device" by its own name when the person never gave it one', async () => {
    const callSkill = async (app, op) => (op === 'getProfileProperties' ? { properties: {} } : op === 'listContacts' ? { contacts: [] } : {});
    const blocks = await mijScreenBlocks({ hostOps: { callSkill, deviceId: 'd1', deviceName: 'Firefox · Linux' } });
    const agents = blocks.find((b) => b.type === 'agents');
    expect(agents?.content?.items?.[0]).toMatchObject({ kind: 'device', here: true, label: 'Firefox · Linux' });
  });
  it('a browser names itself from its user agent', () => {
    expect(browserDeviceName('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox · Linux');
    expect(browserDeviceName('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe('Chrome · Android');
    expect(browserDeviceName('')).toBeNull();
  });
});
