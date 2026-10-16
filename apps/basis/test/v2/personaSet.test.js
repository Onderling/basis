/**
 * The persona SET (the header switcher): which of this device's selves the app shows now. Kept on the screens book
 * (per device), changed only through the `screen-set-personas` op, so it is logged and undoable like a page change.
 * No set = all; the set never goes empty; a self not held here is dropped. Vandaag, Kringen and Contacten show the
 * circles of the selves in the set; the "+" writes as the one self ticked, else it asks.
 */
import { describe, it, expect } from 'vitest';
import { createUserScreenStore, addScreen, removeScreen } from '../../src/v2/userScreens.js';
import { createScreenOps } from '../../src/v2/screenOps.js';
import { activeSelves, circlesInSet, writeAs, switcherModel, contactsInSet } from '../../src/v2/personaSet.js';
import { createObjectVersionsAdapter } from '@onderling/kring-host/objectVersionsStorage';
import { createMemoryBackend } from '@onderling/pseudo-pod';

const held = [{ id: 'default', name: null, webid: 'w-d' }, { id: 'p-werk', name: 'Werk', webid: 'w-w' }, { id: 'p-buurt', name: 'Buurt', webid: 'w-b' }];
let clock = 1_000;
const memStore = () => { let book = null; return createUserScreenStore({ io: { load: async () => book, save: async (b) => { book = b; } },
  versions: createObjectVersionsAdapter({ storeName: 'screens', backend: createMemoryBackend(), now: () => (clock += 10) }) }); };

describe('the persona set', () => {
  it('no set = every self here; a self not held is dropped; never empty', () => {
    expect(activeSelves({}, held)).toEqual(['default', 'p-werk', 'p-buurt']);
    expect(activeSelves({ personaSet: ['p-werk', 'p-gone'] }, held)).toEqual(['p-werk']);
    expect(activeSelves({ personaSet: ['p-gone'] }, held)).toEqual(['default', 'p-werk', 'p-buurt']);
  });

  it('the book keeps the set through page changes', () => {
    let book = { screens: [], activeId: null, personaSet: ['p-werk'] };
    book = addScreen(book, 'Vandaag');
    book = removeScreen(addScreen(book, 'Twee'), book.screens[0].id);
    expect(book.personaSet).toEqual(['p-werk']);
  });

  it('circles follow the set: a circle is its self\'s; an own-scope row (no circle) is the default\'s', () => {
    const circles = [{ id: 'thuis' }, { id: 'kantoor' }, { id: 'straat' }];
    const profileIdOf = (c) => ({ kantoor: 'p-werk', straat: 'p-buurt' }[c] ?? 'default');
    expect(circlesInSet(circles, ['p-werk'], profileIdOf).map((c) => c.id)).toEqual(['kantoor']);
    expect(circlesInSet(circles, ['default', 'p-buurt'], profileIdOf).map((c) => c.id)).toEqual(['thuis', 'straat']);
  });

  it('contacts follow the set: a contact is its pair circle\'s self; one without a pair circle is the default\'s', () => {
    const profileIdOf = (c) => (c === 'pair-w' ? 'p-werk' : 'default');
    const contacts = [{ contactId: 'a', pairCircleId: 'pair-w' }, { contactId: 'b', pairCircleId: 'pair-d' }, { contactId: 'bot' }];
    expect(contactsInSet(contacts, ['p-werk'], profileIdOf).map((c) => c.contactId)).toEqual(['a']);
    expect(contactsInSet(contacts, ['default'], profileIdOf).map((c) => c.contactId)).toEqual(['b', 'bot']);
  });

  it('the "+" writes as the one ticked self — with several, it asks', () => {
    expect(writeAs(['p-werk'])).toBe('p-werk');
    expect(writeAs(['default', 'p-werk'])).toBe(null);
  });

  it('the switcher: one row per self (on/off), "alle", and the last one on cannot be turned off', () => {
    const m = switcherModel({ book: { personaSet: ['p-werk'] }, held });
    expect(m.rows.map((r) => [r.id, r.on, r.canToggle])).toEqual([['default', false, true], ['p-werk', true, false], ['p-buurt', false, true]]);
    expect(m.allOn).toBe(false);
    expect(m.toggle('p-buurt')).toEqual({ opId: 'screen-set-personas', args: { ids: ['p-werk', 'p-buurt'] } });
    expect(m.toggle('p-werk')).toBe(null);
    expect(m.all()).toEqual({ opId: 'screen-set-personas', args: { ids: null } });
  });

  it('the op keeps it on the book, logged, and undo steps it back', async () => {
    const store = memStore();
    const ops = createScreenOps({ store, log: null });
    expect((await ops['screen-set-personas']({ ids: ['p-werk'] })).ok).toBe(true);
    expect((await store.get()).personaSet).toEqual(['p-werk']);
    expect((await ops['screen-set-personas']({ ids: null })).ok).toBe(true);
    expect((await store.get()).personaSet).toBeUndefined();
    await ops['screen-undo']();
    expect((await store.get()).personaSet).toEqual(['p-werk']);
  });
});

describe('the persona set — what follows it', () => {
  it('the avatar of a persona carries its own name, not the person\'s', async () => {
    const { loadPersonaAvatar } = await import('../../src/v2/personaAvatar.js');
    const callSkill = async (app, op) => (op === 'getMyProfile' ? { entry: { displayName: 'Frits' } } : { properties: {} });
    expect((await loadPersonaAvatar({ callSkill, profileId: 'p-werk', name: 'Werk' })).initials).toBe('W');
    expect((await loadPersonaAvatar({ callSkill })).initials).toBe('F');
  });
});

describe('the persona set — Vandaag', () => {
  it('own items show when the self that made them is in the set; circles follow the set through the host', async () => {
    const { materializeScreen } = await import('../../src/v2/userScreenBlocks.js');
    const own = [{ id: 'n1', type: 'note', body: 'mijn', createdBy: 'w-d' }, { id: 'n2', type: 'note', body: 'werk', createdBy: 'w-w' }];
    const callSkill = async (app, op) => (app === 'household' ? { items: own.map((n) => ({ id: n.id, label: n.body, text: n.body, type: 'note', createdBy: n.createdBy })) } : null);
    const heldHere = [{ id: 'default', webid: 'w-d' }, { id: 'p-werk', webid: 'w-w' }];
    const notes = async (on) => (await materializeScreen({
      screen: { id: 's', name: 'V', circleFilter: null, blocks: [{ id: 'b', type: 'notes', config: {} }] },
      hostOps: { callSkill, circles: [], ...(on ? { selfSet: { on, held: heldHere } } : {}) },
    }))[0].content.items.map((r) => r.label);
    expect(await notes(null)).toEqual(expect.arrayContaining(['mijn', 'werk']));
    expect(await notes(['p-werk'])).toEqual(['werk']);
    expect(await notes(['default'])).toEqual(['mijn']);
  });
});
